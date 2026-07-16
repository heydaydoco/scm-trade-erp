import { createSupabaseServerClient } from "@/lib/supabase/server";
import { todayKst, periodOfYmd } from "@/lib/date";
import type { GoodsReceipt, GrLine, PoOpenQty } from "./types";

/**
 * 입고(GR) 서비스 — SPEC C5, 원칙 1(잔량은 계산)·5(잔량 소비 가드)·7(로직/화면 분리)·8(경고 후 허용).
 *
 * ⚠️ 수정 함수가 없다. 입고는 저장 아니면 **취소(=원장 역분개)** 뿐이다.
 *    앱에는 goods_receipts/gr_lines 의 INSERT 권한조차 없고(DB REVOKE),
 *    쓰기는 SECURITY DEFINER RPC 2개(save_goods_receipt·cancel_goods_receipt)로만 통과한다.
 *
 * ⚠️ 발주 상태 전이(partial/completed/복귀)는 **RPC 내부에서만** 일어난다.
 *    여기서 status 를 직접 쓰지 않는다 — 사람 손이 닿으면 잔량과 상태가 어긋난다.
 */

/* ---------- 순수 로직 — 공용(docFlow)에 발주→입고 이름을 붙여 재수출 ---------- */
/*  발주→입고와 수주→출고는 같은 규칙이다. 두 벌로 복붙하면 한쪽만 고쳐져 드리프트하므로
    단일 진실은 docFlow.ts 에 두고 여기선 도메인 이름만 입힌다.
    (단위 테스트는 receipts.test.ts 가 이 이름들로 계속 검증한다) */
export {
  openQtyOf,
  prefillQty,
  consumedQtyOf as receivedQtyOf,
  isOverConsume as isOverReceipt,
  nextStatusFrom as poStatusFrom,
} from "./docFlow";
export type { DocQtyLike as ReceiptQtyLike } from "./docFlow";

/* ---------- 물리 행 모양 ---------- */

interface OpenQtyRow {
  po_line_id: string;
  po_id: string;
  sort_order: number | null;
  product_id: string | null;
  product_name: string | null;
  unit: string | null;
  ordered_qty: number | string | null;
  received_qty: number | string | null;
  open_qty: number | string | null;
}

interface GrLineRow {
  id: string;
  line_no: number;
  po_line_id: string | null;
  item_id: string;
  item_name: string | null;
  qty: number | string;
  uom: string | null;
  lot_no: string | null;
  memo: string | null;
}

interface GrRow {
  id: string;
  gr_no: string;
  receipt_date: string;
  status: string;
  warehouse_code: string;
  ref_doc_type: string;
  ref_doc_id: string;
  memo: string | null;
  created_at: string;
  gr_lines?: GrLineRow[] | null;
}

const GR_COLUMNS =
  "id, gr_no, receipt_date, status, warehouse_code, ref_doc_type, ref_doc_id, memo, created_at, " +
  "gr_lines(id, line_no, po_line_id, item_id, item_name, qty, uom, lot_no, memo)";

function num(v: number | string | null): number {
  if (v === null) return 0;
  return typeof v === "number" ? v : Number(v);
}

function mapOpenQty(row: OpenQtyRow): PoOpenQty {
  return {
    poLineId: row.po_line_id,
    poId: row.po_id,
    sortOrder: row.sort_order,
    productId: row.product_id,
    productName: row.product_name,
    unit: row.unit,
    orderedQty: num(row.ordered_qty),
    receivedQty: num(row.received_qty),
    openQty: num(row.open_qty),
  };
}

function mapGrLine(row: GrLineRow): GrLine {
  return {
    id: row.id,
    lineNo: row.line_no,
    poLineId: row.po_line_id,
    itemId: row.item_id,
    itemName: row.item_name,
    qty: num(row.qty),
    uom: row.uom ?? "PCS",
    lotNo: row.lot_no,
    memo: row.memo,
  };
}

function mapGr(
  row: GrRow,
  po?: { po_number: string | null; partner_name: string | null },
): GoodsReceipt {
  return {
    id: row.id,
    grNo: row.gr_no,
    receiptDate: row.receipt_date,
    status: row.status,
    warehouseCode: row.warehouse_code,
    refDocType: row.ref_doc_type,
    refDocId: row.ref_doc_id,
    poNumber: po?.po_number ?? null,
    partnerName: po?.partner_name ?? null,
    memo: row.memo,
    createdAt: row.created_at,
    lines: (row.gr_lines ?? [])
      .map(mapGrLine)
      .sort((a, b) => a.lineNo - b.lineNo),
  };
}

/* ---------- I/O ---------- */

/** 발주 라인별 잔량 (뷰 — 저장된 숫자가 아니다). */
export async function listPoOpenQty(poId: string): Promise<PoOpenQty[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("po_open_qty")
    .select(
      "po_line_id, po_id, sort_order, product_id, product_name, unit, ordered_qty, received_qty, open_qty",
    )
    .eq("po_id", poId)
    .order("sort_order", { ascending: true, nullsFirst: false });

  if (error) throw new Error(`발주 잔량 조회 실패: ${error.message}`);
  return ((data ?? []) as unknown as OpenQtyRow[]).map(mapOpenQty);
}

/**
 * 이 발주를 참조하는 살아있는 입고 건수 — **잔량 소비 가드**(원칙 5)의 서비스 층.
 * 0보다 크면 발주를 수정·취소할 수 없다(DB 트리거가 최종 방어선, 여기선 친절한 안내용).
 */
export async function countLiveReceiptsForPo(poId: string): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { count, error } = await supabase
    .from("goods_receipts")
    .select("id", { count: "exact", head: true })
    .eq("ref_doc_id", poId)
    .neq("status", "cancelled");

  if (error) throw new Error(`입고 참조 조회 실패: ${error.message}`);
  return count ?? 0;
}

/** 특정 발주의 입고 이력 (취소 포함 — 이력은 지우지 않는다). */
export async function listReceiptsForPo(poId: string): Promise<GoodsReceipt[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("goods_receipts")
    .select(GR_COLUMNS)
    .eq("ref_doc_id", poId)
    .order("receipt_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`입고 이력 조회 실패: ${error.message}`);
  return ((data ?? []) as unknown as GrRow[]).map((r) => mapGr(r));
}

/** 입고 목록 (상태 필터). */
export async function listReceipts(opts?: {
  status?: string;
  limit?: number;
}): Promise<GoodsReceipt[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase.from("goods_receipts").select(GR_COLUMNS);
  if (opts?.status) query = query.eq("status", opts.status);

  const { data, error } = await query
    .order("receipt_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);

  if (error) throw new Error(`입고 목록 조회 실패: ${error.message}`);
  const rows = (data ?? []) as unknown as GrRow[];
  if (rows.length === 0) return [];

  // 발주번호·공급사명은 표시용 — 소프트 포인터라 PostgREST 임베드가 안 된다(FK 아님).
  // 한 번에 모아 붙인다(N+1 방지).
  const poIds = Array.from(new Set(rows.map((r) => r.ref_doc_id)));
  const { data: poData, error: poError } = await supabase
    .from("purchase_orders")
    .select("id, po_number, companies(company_name)")
    .in("id", poIds);

  if (poError) throw new Error(`발주 조회 실패: ${poError.message}`);
  const poMap = new Map<
    string,
    { po_number: string | null; partner_name: string | null }
  >();
  for (const p of (poData ?? []) as unknown as {
    id: string;
    po_number: string | null;
    companies?: { company_name: string | null } | null;
  }[]) {
    poMap.set(p.id, {
      po_number: p.po_number,
      partner_name: p.companies?.company_name ?? null,
    });
  }

  return rows.map((r) => mapGr(r, poMap.get(r.ref_doc_id)));
}

/** 입고 1건. */
export async function getReceipt(id: string): Promise<GoodsReceipt | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("goods_receipts")
    .select(GR_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`입고 조회 실패: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as GrRow;

  const { data: poData } = await supabase
    .from("purchase_orders")
    .select("id, po_number, companies(company_name)")
    .eq("id", row.ref_doc_id)
    .maybeSingle();

  const po = poData as unknown as {
    po_number: string | null;
    companies?: { company_name: string | null } | null;
  } | null;

  return mapGr(
    row,
    po
      ? { po_number: po.po_number, partner_name: po.companies?.company_name ?? null }
      : undefined,
  );
}

export interface ReceiptLineInput {
  poLineId: string | null;
  itemId: string;
  itemName: string | null;
  qty: number;
  uom: string | null;
  lotNo: string | null;
  memo: string | null;
}

/**
 * 입고 저장 — 헤더 + 라인 + 원장 전기(GR_IN)가 **한 트랜잭션**(RPC).
 * 중간에 실패하면 전부 롤백된다: 원장만 남거나 입고만 남는 상태가 존재할 수 없다.
 */
export async function saveGoodsReceipt(input: {
  poId: string;
  lines: ReceiptLineInput[];
  receiptDate: string | null;
  warehouseCode: string;
  memo: string | null;
}): Promise<{ id: string; grNo: string }> {
  if (input.lines.length === 0) {
    throw new Error("입고 품목이 최소 1건 필요합니다.");
  }

  const date = input.receiptDate ?? todayKst();
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("save_goods_receipt", {
    p_po_id: input.poId,
    p_lines: input.lines.map((l) => ({
      poLineId: l.poLineId,
      itemId: l.itemId,
      itemName: l.itemName,
      qty: Math.abs(l.qty), // 원장 부호는 유형(GR_IN)이 정한다
      uom: l.uom,
      lotNo: l.lotNo,
      memo: l.memo,
    })),
    p_receipt_date: date,
    p_warehouse_code: input.warehouseCode || "MAIN",
    p_memo: input.memo,
    p_period: periodOfYmd(date), // 발번 기간 — 증빙일 기준(KST)
  });

  if (error) throw new Error(`입고 저장 실패: ${error.message}`);
  const r = data as { id: string; grNo: string };
  return { id: r.id, grNo: r.grNo };
}

/**
 * 입고 취소 — 삭제가 아니라 상태 + **원장 역분개**(원칙 1·5).
 * 이중 취소는 RPC 검사 + reversal_of_id UNIQUE 부분 인덱스가 차단한다.
 */
export async function cancelGoodsReceipt(
  id: string,
  memo: string,
): Promise<void> {
  if (!memo || memo.trim() === "") {
    throw new Error("입고 취소 사유는 필수입니다.");
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_goods_receipt", {
    p_gr_id: id,
    p_memo: memo.trim(),
  });
  if (error) throw new Error(`입고 취소 실패: ${error.message}`);
}
