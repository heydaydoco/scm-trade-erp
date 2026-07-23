import { createSupabaseServerClient } from "@/lib/supabase/server";
import { periodKst } from "@/lib/date";
import type {
  Milestone,
  PurchaseOrder,
  SalesOrder,
  Shipment,
  ShipmentInput,
  ShipmentOrderLink,
} from "./types";

/* ---------- 물리 테이블 행 모양 (이 파일 바깥으로 노출 안 함) ---------- */

interface ShipmentOrderRow {
  order_type: string | null;
  order_id: string | null;
  order_number: string | null;
}
interface MilestoneRow {
  type: string | null;
  planned_date: string | null;
  actual_date: string | null;
  memo: string | null;
  sort_order: number | null;
}
interface ShipmentRow {
  id: string;
  ship_number: string | null;
  direction: string | null;
  partner_id: string | null;
  forwarder: string | null;
  carrier: string | null;
  transport: string | null;
  vessel_voyage: string | null;
  pol: string | null;
  pod: string | null;
  booking_no: string | null;
  bl_no: string | null;
  incoterms: string | null;
  status: string | null;
  notes: string | null;
  companies?: { company_name: string | null; country: string | null } | null;
  shipment_orders?: ShipmentOrderRow[] | null;
  milestones?: MilestoneRow[] | null;
}

// 주문연결·마일스톤을 FK 임베드로 한 쿼리에 가져온다(so_lines처럼 별도 조회 불필요).
// ⚠️ container_no 는 읽지 않는다(P5.2 사장) — 아래 headerPayload 주석 참조.
const SHIPMENT_COLUMNS =
  "id, ship_number, direction, partner_id, forwarder, carrier, transport, vessel_voyage, pol, pod, booking_no, bl_no, incoterms, status, notes, companies(company_name, country), shipment_orders(order_type, order_id, order_number), milestones(type, planned_date, actual_date, memo, sort_order)";

/* ---------- 순수 매핑 (I/O 없음 → 단위 테스트 가능) ---------- */

function assembleShipment(row: ShipmentRow): Shipment {
  const orders: ShipmentOrderLink[] = (row.shipment_orders ?? []).map((o) => ({
    orderType: o.order_type ?? "",
    orderId: o.order_id,
    orderNumber: o.order_number,
  }));
  const milestones: Milestone[] = (row.milestones ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((m) => ({
      type: m.type ?? "",
      plannedDate: m.planned_date,
      actualDate: m.actual_date,
      memo: m.memo,
    }));

  return {
    id: row.id,
    shipNumber: row.ship_number ?? "",
    direction: row.direction,
    partnerId: row.partner_id,
    partnerName: row.companies?.company_name ?? null,
    partnerCountry: row.companies?.country ?? null,
    forwarder: row.forwarder,
    carrier: row.carrier,
    transport: row.transport,
    vesselVoyage: row.vessel_voyage,
    pol: row.pol,
    pod: row.pod,
    bookingNo: row.booking_no,
    blNo: row.bl_no,
    incoterms: row.incoterms,
    status: row.status ?? "draft",
    notes: row.notes,
    orders,
    milestones,
  };
}

/**
 * 발번 기간(YYYYMM) — 선적은 헤더 날짜가 없어 오늘 기준.
 * ⚠️ 반드시 KST: 구 코드는 UTC라 한국 8/1 08:00 부킹이 SHP-202607로 한 달 밀렸다(P4.0-a).
 */
function currentPeriod(): string {
  return periodKst();
}

/**
 * save_shipment(잠긴 RPC — 무수정) 의 p_header.
 *
 * ⚠️ **container_no 를 싣지 않는다**(P5.2 사장). 컨테이너 정본은 shipment_containers
 *    이고 저장 경로는 save_shipment_containers 다. RPC 는 잠겨 있어 시그니처를 고칠 수
 *    없으므로 `p_header->>'container_no'` 는 NULL 로 해석된다 → **이 폼을 다시 저장하는
 *    순간 남아 있던 레거시 헤더 컨테이너 번호는 NULL 이 된다**(의도된 사장 동작).
 *    컬럼 자체는 존치하고, 이미 발행된 trade_documents 의 container_no 스냅샷은
 *    불변이다(과거 서류의 사실은 소급 변경되지 않는다).
 */
function headerPayload(input: ShipmentInput): Record<string, unknown> {
  return {
    direction: input.direction,
    partner_id: input.partnerId,
    forwarder: input.forwarder,
    carrier: input.carrier,
    transport: input.transport,
    vessel_voyage: input.vesselVoyage,
    pol: input.pol,
    pod: input.pod,
    booking_no: input.bookingNo,
    bl_no: input.blNo,
    incoterms: input.incoterms,
    status: input.status,
    notes: input.notes,
  };
}

function ordersPayload(orders: ShipmentOrderLink[]): Record<string, unknown>[] {
  return orders.map((o) => ({
    order_type: o.orderType,
    order_id: o.orderId,
    order_number: o.orderNumber,
  }));
}

function milestonesPayload(milestones: Milestone[]): Record<string, unknown>[] {
  return milestones.map((m, i) => ({
    type: m.type,
    planned_date: m.plannedDate,
    actual_date: m.actualDate,
    memo: m.memo,
    sort_order: i,
  }));
}

/**
 * 수주 → 선적 드래프트 (원칙 3 — 참조). direction=export, 그 SO를 자동 연결.
 * 승계: 거래처·인코텀즈·운송(선적 부킹의 자연 기본값). 주문은 폼에서 더 추가/삭제 가능(합짐·직송).
 */
export function buildShipmentDraftFromSalesOrder(so: SalesOrder): ShipmentInput {
  return {
    direction: "export",
    partnerId: so.partnerId,
    forwarder: null,
    carrier: null,
    transport: so.transport,
    vesselVoyage: null,
    pol: null,
    pod: null,
    bookingNo: null,
    blNo: null,
    incoterms: so.incoterms,
    status: "draft",
    notes: null,
    orders: [{ orderType: "SO", orderId: so.id, orderNumber: so.soNumber }],
    milestones: [],
  };
}

/** 발주 → 선적 드래프트 (원칙 3). direction=import, 그 PO를 자동 연결. */
export function buildShipmentDraftFromPurchaseOrder(
  po: PurchaseOrder,
): ShipmentInput {
  return {
    direction: "import",
    partnerId: po.partnerId,
    forwarder: null,
    carrier: null,
    transport: po.transport,
    vesselVoyage: null,
    pol: null,
    pod: null,
    bookingNo: null,
    blNo: null,
    incoterms: po.incoterms,
    status: "draft",
    notes: null,
    orders: [{ orderType: "PO", orderId: po.id, orderNumber: po.poNumber }],
    milestones: [],
  };
}

/* ---------- I/O (서비스). 화면은 이 함수들만 호출한다. ---------- */

/**
 * 선적 저장 — 번호발번 + 헤더 + 주문연결 + 마일스톤을 단일 트랜잭션(save_shipment)으로 원자 처리.
 * 참조: db/migrations/p3.2_shipments.sql. p_id=null이면 등록(발번), 있으면 수정(번호 불변).
 */
async function saveViaRpc(
  id: string | null,
  input: ShipmentInput,
): Promise<string> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("save_shipment", {
    p_id: id,
    p_header: headerPayload(input),
    p_orders: ordersPayload(input.orders),
    p_milestones: milestonesPayload(input.milestones),
    p_period: id ? null : currentPeriod(),
  });
  if (error) {
    // 중복 연결(unique 제약) → 친절 메시지
    if (/shipment_orders_uniq|duplicate key/i.test(error.message)) {
      throw new Error("같은 주문이 한 선적에 이미 연결되어 있습니다.");
    }
    throw new Error(`선적 저장 실패: ${error.message}`);
  }
  const result = data as { id?: string } | null;
  if (!result?.id) throw new Error("선적 저장 결과가 올바르지 않습니다.");
  return result.id;
}

/** 선적 목록 (최신순). 주문연결·마일스톤 임베드 포함. */
export async function listShipments(): Promise<Shipment[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("shipments")
    .select(SHIPMENT_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`선적 목록 조회 실패: ${error.message}`);
  const rows = (data ?? []) as unknown as ShipmentRow[];
  return rows.map(assembleShipment);
}

/** 선적 1건 조회 (주문연결·마일스톤 포함). 없으면 null. */
export async function getShipment(id: string): Promise<Shipment | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("shipments")
    .select(SHIPMENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`선적 조회 실패: ${error.message}`);
  if (!data) return null;
  return assembleShipment(data as unknown as ShipmentRow);
}

/** 선적 등록 — save_shipment 트랜잭션으로 번호+헤더+주문연결+마일스톤 원자 저장. */
export async function createShipment(input: ShipmentInput): Promise<Shipment> {
  const id = await saveViaRpc(null, input);
  const created = await getShipment(id);
  if (!created) throw new Error("선적 등록 후 조회에 실패했습니다.");
  return created;
}

/**
 * 선적 수정 (정정). 번호 불변(원칙 6). 헤더+주문연결+마일스톤 교체를 단일 트랜잭션으로(원자성).
 * 삭제 기능은 없다 — 종결은 상태(cancelled)로 (원칙 5).
 */
export async function updateShipment(
  id: string,
  input: ShipmentInput,
): Promise<Shipment> {
  await saveViaRpc(id, input);
  const updated = await getShipment(id);
  if (!updated) throw new Error("선적 수정 후 조회에 실패했습니다.");
  return updated;
}
