import { createSupabaseServerClient } from "@/lib/supabase/server";
import { todayKst } from "@/lib/date";
import { MOVEMENT_TYPES, ADJUSTMENT_TYPES, type MovementType } from "./codes";
import type { StockMovement, StockOnHand } from "./types";

// 코드테이블은 codes.ts가 단일 진실(원칙 4). 원장을 다루는 쪽이 한 곳만 import 하도록 재수출.
export { MOVEMENT_TYPES, ADJUSTMENT_TYPES, type MovementType };

/**
 * 재고 원장 서비스 — SPEC D1·D2·D3, 원칙 1(원장)·원칙 7(로직/화면 분리)·원칙 8(마이너스 경고).
 *
 * ⚠️ 현재고라는 숫자는 어디에도 저장하지 않는다. 원장(stock_movements)에 부호 있는 행만
 *    쌓고, 현재고 = SUM(qty) 를 뷰(stock_on_hand)가 매번 계산한다.
 *
 * ⚠️ 이 서비스에는 update/delete 함수가 없다 — 만들 수 없다.
 *    앱에는 원장 INSERT 권한조차 없고(DB에서 REVOKE), 쓰기는 SECURITY DEFINER RPC
 *    2개(save_stock_adjustment · reverse_stock_movement)로만 통과한다.
 *    정정은 수정이 아니라 **역분개**(반대부호 행 추가)다.
 *
 * ⚠️ 기존 save_* 의 "라인 전량 DELETE 후 재INSERT" 패턴을 여기에 절대 쓰지 않는다(원칙 1).
 *
 * 이번 원장은 **수량 원장**이다. 금액·평가(원가)는 없다(P8 Landed Cost 대상).
 */

/* ---------- 순수 로직 (I/O 없음 → 단위 테스트 대상: stock.test.ts) ---------- */

const UNKNOWN_TYPE: MovementType = {
  code: "",
  label: "",
  sign: 0,
  tone: "reversal",
};

/** 코드 → 이동 유형. 모르는 코드는 원본 코드를 라벨로 돌려준다(화면이 죽지 않게). */
export function movementTypeOf(code: string): MovementType {
  return (
    MOVEMENT_TYPES.find((m) => m.code === code) ?? {
      ...UNKNOWN_TYPE,
      code,
      label: code,
    }
  );
}

/** 재고가 늘어나는 유형인가. */
export function isInbound(code: string): boolean {
  return movementTypeOf(code).sign === 1;
}

/**
 * ★ 부호 결정 — 이 시스템에서 원장 부호를 정하는 유일한 곳(화면이 아니라 유형이 정한다).
 *
 * 화면은 항상 양수를 보낸다. 음수가 오더라도 유형이 이긴다(모순 입력 방어).
 * REVERSAL은 여기서 만들지 않는다 — 역분개는 원행을 읽어 반대부호를 내는 RPC 전용이다.
 */
export function signedQty(movementType: string, qty: number): number {
  const t = movementTypeOf(movementType);

  if (t.code === "REVERSAL") {
    throw new Error(
      "역분개 행은 이 경로로 만들 수 없습니다. reverseStockMovement()를 쓰세요.",
    );
  }
  if (t.sign === 0) {
    throw new Error(`알 수 없는 이동 유형입니다: ${movementType}`);
  }
  const abs = Math.abs(qty);
  if (!Number.isFinite(abs) || abs === 0) {
    throw new Error("수량은 0보다 큰 값이어야 합니다.");
  }
  return t.sign * abs;
}

/**
 * 역분개 가능 판정.
 *  · 역분개 행은 다시 역분개하지 않는다 — 사슬이 생기면 무엇이 무엇을 상쇄했는지 못 읽는다.
 *    되돌린 걸 또 되돌리려면 조정을 새로 등록한다.
 *  · 이미 역분개된 행은 두 번 못 한다(DB의 UNIQUE 부분 인덱스가 최후 방어선).
 */
export function isReversible(row: {
  movementType: string;
  reversedById: string | null;
}): boolean {
  if (row.movementType === "REVERSAL") return false;
  return row.reversedById === null;
}

/**
 * 저장 전 예상재고 — 원칙 8(마이너스는 차단이 아니라 **경고 후 허용**)의 근거.
 * 제조·무역은 입고 전기가 늦는 게 현실이라 막으면 업무가 선다. 대신 화면이 경고한다.
 */
export function projectedOnHand(
  currentOnHand: number,
  movementType: string,
  qty: number,
): number {
  const delta = signedQty(movementType, qty);
  // 수량은 소수(0.1+0.2=0.30000000000000004)가 가능하므로 부동소수 오차를 정리한다.
  return Math.round((currentOnHand + delta) * 1e6) / 1e6;
}

/** 증빙일 기본값 — 반드시 한국 달력 날짜(서버는 UTC로 돈다. P4.0-a와 같은 규칙). */
export function defaultMovedAt(now: Date = new Date()): string {
  return todayKst(now);
}

/* ---------- 물리 행 모양 (이 파일 바깥으로 노출 안 함) ---------- */

interface OnHandRow {
  item_id: string;
  item_code: string | null;
  item_name: string | null;
  uom: string | null;
  warehouse_code: string;
  on_hand: number | string | null;
}

interface MovementRow {
  id: string;
  movement_type: string;
  item_id: string;
  qty: number | string;
  uom: string | null;
  warehouse_code: string;
  lot_no: string | null;
  moved_at: string;
  ref_doc_type: string | null;
  ref_doc_id: string | null;
  reversal_of_id: string | null;
  memo: string | null;
  created_at: string;
  products?: { code: string | null; product_name: string | null } | null;
}

const ON_HAND_COLUMNS =
  "item_id, item_code, item_name, uom, warehouse_code, on_hand";
const MOVEMENT_COLUMNS =
  "id, movement_type, item_id, qty, uom, warehouse_code, lot_no, moved_at, " +
  "ref_doc_type, ref_doc_id, reversal_of_id, memo, created_at, " +
  "products!inner(code, product_name)";

/** numeric은 PostgREST가 문자열로 줄 수 있다(정밀도 보존) → 숫자로 정규화. */
function num(v: number | string | null): number {
  if (v === null) return 0;
  return typeof v === "number" ? v : Number(v);
}

/* ---------- 순수 매핑 ---------- */

function mapOnHand(row: OnHandRow): StockOnHand {
  return {
    itemId: row.item_id,
    itemCode: row.item_code,
    itemName: row.item_name,
    uom: row.uom ?? "PCS",
    warehouseCode: row.warehouse_code,
    onHand: num(row.on_hand),
  };
}

function mapMovement(
  row: MovementRow,
  reversedBy: Map<string, string>,
): StockMovement {
  return {
    id: row.id,
    movementType: row.movement_type,
    itemId: row.item_id,
    itemCode: row.products?.code ?? null,
    itemName: row.products?.product_name ?? null,
    qty: num(row.qty),
    uom: row.uom ?? "PCS",
    warehouseCode: row.warehouse_code,
    lotNo: row.lot_no,
    movedAt: row.moved_at,
    refDocType: row.ref_doc_type,
    refDocId: row.ref_doc_id,
    reversalOfId: row.reversal_of_id,
    // 이 행을 되돌린 REVERSAL 행의 id (없으면 null) → 화면의 [역분개] 버튼 노출 판정.
    reversedById: reversedBy.get(row.id) ?? null,
    memo: row.memo,
    createdAt: row.created_at,
  };
}

/* ---------- I/O (서비스). 화면은 이 함수들만 호출한다. ---------- */

/** 현재고 (품목×창고). 저장된 숫자가 아니라 원장 합산 뷰다. */
export async function listStockOnHand(opts?: {
  includeZero?: boolean;
}): Promise<StockOnHand[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("stock_on_hand")
    .select(ON_HAND_COLUMNS)
    .order("item_code", { ascending: true, nullsFirst: false })
    .order("warehouse_code", { ascending: true });

  if (error) throw new Error(`현재고 조회 실패: ${error.message}`);
  const rows = ((data ?? []) as unknown as OnHandRow[]).map(mapOnHand);

  // 재고 0 숨김은 뷰가 아니라 여기서 — 뷰는 사실을 그대로 두고 표시 정책만 서비스가 갖는다.
  const filtered = opts?.includeZero ? rows : rows.filter((r) => r.onHand !== 0);
  // 마이너스를 맨 위로(원칙 8 — 전기 누락 신호를 눈에 띄게).
  return filtered.sort((a, b) => {
    const an = a.onHand < 0 ? 0 : 1;
    const bn = b.onHand < 0 ? 0 : 1;
    if (an !== bn) return an - bn;
    return (a.itemCode ?? "").localeCompare(b.itemCode ?? "");
  });
}

/** 특정 품목·창고의 현재고 1건 (조정 폼의 예상재고 계산용). 없으면 0. */
export async function getOnHand(
  itemId: string,
  warehouseCode = "MAIN",
): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("stock_on_hand")
    .select("on_hand")
    .eq("item_id", itemId)
    .eq("warehouse_code", warehouseCode)
    .maybeSingle();

  if (error) throw new Error(`현재고 조회 실패: ${error.message}`);
  return data ? num((data as { on_hand: number | string | null }).on_hand) : 0;
}

/** 마이너스 재고 품목 수 — 홈 대시보드 배지(원칙 8의 일일 신호). */
export async function getNegativeStockCount(): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("stock_on_hand")
    .select("item_id, on_hand");

  if (error) throw new Error(`마이너스 재고 조회 실패: ${error.message}`);
  const rows = (data ?? []) as unknown as { on_hand: number | string }[];
  return rows.filter((r) => num(r.on_hand) < 0).length;
}

/** 원장 조회 (최신순). 필터: 품목·유형·기간. */
export async function listStockMovements(opts?: {
  itemId?: string;
  movementType?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<StockMovement[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase.from("stock_movements").select(MOVEMENT_COLUMNS);

  if (opts?.itemId) query = query.eq("item_id", opts.itemId);
  if (opts?.movementType) query = query.eq("movement_type", opts.movementType);
  if (opts?.from) query = query.gte("moved_at", opts.from);
  if (opts?.to) query = query.lte("moved_at", opts.to);

  const { data, error } = await query
    .order("moved_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);

  if (error) throw new Error(`원장 조회 실패: ${error.message}`);
  const rows = (data ?? []) as unknown as MovementRow[];
  if (rows.length === 0) return [];

  // "이미 역분개된 행"을 알아야 [역분개] 버튼을 감출 수 있다.
  // ⚠️ 이 페이지 안에서만 찾으면 안 된다 — 필터(유형·기간)나 200건 상한 때문에
  //    REVERSAL 행이 조회 범위 밖일 수 있고, 그러면 이미 되돌린 행에 버튼이 다시 뜬다.
  //    (누르면 RPC가 거부하므로 데이터는 안전하지만 화면이 거짓말을 한다)
  //    → 조회된 id들을 가리키는 REVERSAL 을 범위와 무관하게 한 번에 확인한다(N+1 없음).
  const ids = rows.map((r) => r.id);
  const { data: revData, error: revError } = await supabase
    .from("stock_movements")
    .select("id, reversal_of_id")
    .in("reversal_of_id", ids);

  if (revError) throw new Error(`역분개 상태 조회 실패: ${revError.message}`);
  const reversedBy = new Map<string, string>();
  for (const r of (revData ?? []) as unknown as {
    id: string;
    reversal_of_id: string;
  }[]) {
    reversedBy.set(r.reversal_of_id, r.id);
  }

  return rows.map((r) => mapMovement(r, reversedBy));
}

/**
 * 재고 조정 저장 (기초재고·조정 증가·조정 감소).
 *
 * 부호는 보내지 않는다 — RPC가 유형으로 결정한다(서비스의 signedQty와 같은 규칙, 이중 방어).
 * 화면은 항상 양수를 넘긴다.
 */
export async function saveStockAdjustment(input: {
  itemId: string;
  movementType: string;
  qty: number;
  warehouseCode?: string;
  lotNo?: string | null;
  movedAt?: string | null;
  memo: string;
}): Promise<string> {
  // 화면을 신뢰하지 않고 서비스에서도 유형을 검증한다(RPC가 최종 방어선).
  if (!["INIT", "ADJ_IN", "ADJ_OUT"].includes(input.movementType)) {
    throw new Error(
      `재고 조정으로 만들 수 없는 유형입니다: ${input.movementType}`,
    );
  }
  if (!input.memo || input.memo.trim() === "") {
    throw new Error("사유(메모)는 필수입니다.");
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("save_stock_adjustment", {
    p_item_id: input.itemId,
    p_movement_type: input.movementType,
    p_qty: Math.abs(input.qty), // 항상 양수로 — 부호는 RPC가 정한다
    p_warehouse_code: input.warehouseCode ?? "MAIN",
    p_lot_no: input.lotNo ?? null,
    p_moved_at: input.movedAt ?? null, // null이면 RPC가 KST 오늘로
    p_memo: input.memo.trim(),
  });

  if (error) throw new Error(`재고 조정 저장 실패: ${error.message}`);
  return data as string;
}

/**
 * 역분개 — 정정의 유일한 수단(원칙 1: "수정이 아니라 역방향 이동 + 재입력").
 * 원행은 건드리지 않는다. 반대부호 행을 하나 더 쌓을 뿐이다.
 */
export async function reverseStockMovement(
  movementId: string,
  memo: string,
): Promise<string> {
  if (!memo || memo.trim() === "") {
    throw new Error("역분개 사유는 필수입니다.");
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("reverse_stock_movement", {
    p_movement_id: movementId,
    p_memo: memo.trim(),
  });

  if (error) throw new Error(`역분개 실패: ${error.message}`);
  return data as string;
}
