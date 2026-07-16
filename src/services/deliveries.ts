import { createSupabaseServerClient } from "@/lib/supabase/server";
import { todayKst, periodOfYmd } from "@/lib/date";
import type { Delivery, DeliveryLine, SoOpenQty } from "./types";

/**
 * 출고(Delivery) 서비스 — SPEC B8, 원칙 1(잔량은 계산)·5(잔량 소비 가드)·7·8(경고 후 허용).
 *
 * ⚠️ 수정 함수가 없다. 출고는 저장 아니면 **취소(=원장 역분개)** 뿐이다.
 *    앱에는 deliveries/delivery_lines 의 INSERT 권한조차 없고, 쓰기는
 *    SECURITY DEFINER RPC 2개(save_delivery·cancel_delivery)로만 통과한다.
 *
 * ⚠️ 수주 상태 전이(partial/completed/복귀)는 **RPC 내부에서만** 일어난다.
 */

/* ---------- 순수 로직 — 공용(docFlow)에 수주→출고 이름을 붙여 재수출 ---------- */
/*  발주→입고와 같은 규칙이다. 단일 진실은 docFlow.ts (두 벌이면 드리프트한다). */
export {
  openQtyOf,
  prefillQty,
  consumedQtyOf as shippedQtyOf,
  isOverConsume as isOverDelivery,
  nextStatusFrom as soStatusFrom,
} from "./docFlow";
export type { DocQtyLike as DeliveryQtyLike } from "./docFlow";

/* ---------- ★ P4.3 고유 순수 로직: 마이너스 재고 예상 (원칙 8 경고의 근거) ---------- */
/*  실체는 stockProjection.ts — 출고 폼(브라우저)이 직접 부르려면 이 파일(서버 I/O 포함)을
    import 할 수 없어 순수 부분만 떼어 뒀다. 서버 쪽 호출부는 계속 여기서 가져다 쓴다. */
export { projectStockByItem, shortagesOf } from "./stockProjection";
export type { OutLineQty, StockProjection } from "./stockProjection";

/* ---------- 물리 행 모양 ---------- */

interface OpenQtyRow {
  so_line_id: string;
  so_id: string;
  sort_order: number | null;
  product_id: string | null;
  product_name: string | null;
  unit: string | null;
  unit_price: number | string | null;
  ordered_qty: number | string | null;
  shipped_qty: number | string | null;
  open_qty: number | string | null;
}

interface DlvLineRow {
  id: string;
  line_no: number;
  so_line_id: string | null;
  item_id: string;
  item_name: string | null;
  qty: number | string;
  uom: string | null;
  lot_no: string | null;
  memo: string | null;
}

interface DlvRow {
  id: string;
  delivery_no: string;
  delivery_date: string;
  status: string;
  warehouse_code: string;
  ref_doc_type: string;
  ref_doc_id: string;
  memo: string | null;
  created_at: string;
  delivery_lines?: DlvLineRow[] | null;
}

const DLV_COLUMNS =
  "id, delivery_no, delivery_date, status, warehouse_code, ref_doc_type, ref_doc_id, memo, created_at, " +
  "delivery_lines(id, line_no, so_line_id, item_id, item_name, qty, uom, lot_no, memo)";

function num(v: number | string | null): number {
  if (v === null) return 0;
  return typeof v === "number" ? v : Number(v);
}

function mapOpenQty(row: OpenQtyRow): SoOpenQty {
  return {
    soLineId: row.so_line_id,
    soId: row.so_id,
    sortOrder: row.sort_order,
    productId: row.product_id,
    productName: row.product_name,
    unit: row.unit,
    unitPrice: num(row.unit_price),
    orderedQty: num(row.ordered_qty),
    shippedQty: num(row.shipped_qty),
    openQty: num(row.open_qty),
  };
}

function mapLine(row: DlvLineRow): DeliveryLine {
  return {
    id: row.id,
    lineNo: row.line_no,
    soLineId: row.so_line_id,
    itemId: row.item_id,
    itemName: row.item_name,
    qty: num(row.qty),
    uom: row.uom ?? "PCS",
    lotNo: row.lot_no,
    memo: row.memo,
  };
}

function mapDlv(
  row: DlvRow,
  so?: { so_number: string | null; partner_name: string | null },
): Delivery {
  return {
    id: row.id,
    deliveryNo: row.delivery_no,
    deliveryDate: row.delivery_date,
    status: row.status,
    warehouseCode: row.warehouse_code,
    refDocType: row.ref_doc_type,
    refDocId: row.ref_doc_id,
    soNumber: so?.so_number ?? null,
    partnerName: so?.partner_name ?? null,
    memo: row.memo,
    createdAt: row.created_at,
    lines: (row.delivery_lines ?? []).map(mapLine).sort((a, b) => a.lineNo - b.lineNo),
  };
}

/* ---------- I/O ---------- */

/** 수주 라인별 잔량 (뷰 — 저장된 숫자가 아니다). */
export async function listSoOpenQty(soId: string): Promise<SoOpenQty[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("so_open_qty")
    .select(
      "so_line_id, so_id, sort_order, product_id, product_name, unit, unit_price, ordered_qty, shipped_qty, open_qty",
    )
    .eq("so_id", soId)
    .order("sort_order", { ascending: true, nullsFirst: false });

  if (error) throw new Error(`수주 잔량 조회 실패: ${error.message}`);
  return ((data ?? []) as unknown as OpenQtyRow[]).map(mapOpenQty);
}

/**
 * 이 수주를 참조하는 살아있는 출고 건수 — **잔량 소비 가드**(원칙 5)의 서비스 층.
 * 0보다 크면 수주를 수정·취소할 수 없다(DB 트리거가 최종 방어선).
 */
export async function countLiveDeliveriesForSo(soId: string): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { count, error } = await supabase
    .from("deliveries")
    .select("id", { count: "exact", head: true })
    .eq("ref_doc_id", soId)
    .neq("status", "cancelled");

  if (error) throw new Error(`출고 참조 조회 실패: ${error.message}`);
  return count ?? 0;
}

/** 특정 수주의 출고 이력 (취소 포함 — 이력은 지우지 않는다). */
export async function listDeliveriesForSo(soId: string): Promise<Delivery[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("deliveries")
    .select(DLV_COLUMNS)
    .eq("ref_doc_id", soId)
    .order("delivery_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`출고 이력 조회 실패: ${error.message}`);
  return ((data ?? []) as unknown as DlvRow[]).map((r) => mapDlv(r));
}

/** 출고 목록 (상태 필터). */
export async function listDeliveries(opts?: {
  status?: string;
  limit?: number;
}): Promise<Delivery[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase.from("deliveries").select(DLV_COLUMNS);
  if (opts?.status) query = query.eq("status", opts.status);

  const { data, error } = await query
    .order("delivery_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);

  if (error) throw new Error(`출고 목록 조회 실패: ${error.message}`);
  const rows = (data ?? []) as unknown as DlvRow[];
  if (rows.length === 0) return [];

  // 수주번호·거래처명은 소프트 포인터라 임베드가 안 된다(FK 아님) → 한 번에 붙인다.
  const soIds = Array.from(new Set(rows.map((r) => r.ref_doc_id)));
  const { data: soData, error: soErr } = await supabase
    .from("sales_orders")
    .select("id, so_number, companies(company_name)")
    .in("id", soIds);

  if (soErr) throw new Error(`수주 조회 실패: ${soErr.message}`);
  const soMap = new Map<string, { so_number: string | null; partner_name: string | null }>();
  for (const s of (soData ?? []) as unknown as {
    id: string;
    so_number: string | null;
    companies?: { company_name: string | null } | null;
  }[]) {
    soMap.set(s.id, {
      so_number: s.so_number,
      partner_name: s.companies?.company_name ?? null,
    });
  }
  return rows.map((r) => mapDlv(r, soMap.get(r.ref_doc_id)));
}

/** 출고 1건. */
export async function getDelivery(id: string): Promise<Delivery | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("deliveries")
    .select(DLV_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`출고 조회 실패: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as DlvRow;

  const { data: soData } = await supabase
    .from("sales_orders")
    .select("id, so_number, companies(company_name)")
    .eq("id", row.ref_doc_id)
    .maybeSingle();

  const so = soData as unknown as {
    so_number: string | null;
    companies?: { company_name: string | null } | null;
  } | null;

  return mapDlv(
    row,
    so ? { so_number: so.so_number, partner_name: so.companies?.company_name ?? null } : undefined,
  );
}

export interface DeliveryLineInput {
  soLineId: string;
  itemName: string | null;
  qty: number;
  uom: string | null;
  lotNo: string | null;
}

/**
 * 출고 저장 — 헤더 + 라인 + 원장 전기(DLV_OUT, −)가 **한 트랜잭션**(RPC).
 * 마이너스 재고가 되더라도 막지 않는다(원칙 8) — 경고는 폼이 저장 전에 띄운다.
 *
 * ⚠️ itemId 를 보내지 않는다 — RPC 가 수주 라인의 품목을 쓴다(클라이언트 값 불신).
 */
export async function saveDelivery(input: {
  soId: string;
  lines: DeliveryLineInput[];
  deliveryDate: string | null;
  warehouseCode: string;
  memo: string | null;
}): Promise<{ id: string; deliveryNo: string }> {
  if (input.lines.length === 0) {
    throw new Error("출고 품목이 최소 1건 필요합니다.");
  }

  const date = input.deliveryDate ?? todayKst();
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("save_delivery", {
    p_so_id: input.soId,
    p_lines: input.lines.map((l) => ({
      soLineId: l.soLineId,
      itemName: l.itemName,
      qty: Math.abs(l.qty), // 원장 부호는 유형(DLV_OUT)이 정한다
      uom: l.uom,
      lotNo: l.lotNo,
    })),
    p_delivery_date: date,
    p_warehouse_code: input.warehouseCode || "MAIN",
    p_memo: input.memo,
    p_period: periodOfYmd(date), // 발번 기간 — 증빙일 기준(KST)
  });

  if (error) throw new Error(`출고 저장 실패: ${error.message}`);
  const r = data as { id: string; deliveryNo: string };
  return { id: r.id, deliveryNo: r.deliveryNo };
}

/**
 * 출고 취소 — 삭제가 아니라 상태 + **원장 역분개**(원칙 1·5).
 * 이중 취소는 RPC 검사 + reversal_of_id UNIQUE 부분 인덱스가 차단한다.
 */
export async function cancelDelivery(id: string, memo: string): Promise<void> {
  if (!memo || memo.trim() === "") {
    throw new Error("출고 취소 사유는 필수입니다.");
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_delivery", {
    p_delivery_id: id,
    p_memo: memo.trim(),
  });
  if (error) throw new Error(`출고 취소 실패: ${error.message}`);
}
