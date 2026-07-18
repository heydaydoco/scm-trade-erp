import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveShipmentCargoUoms } from "./uomResolution";
import { resolveOpenLineUoms } from "./items";
import { openQtyOf } from "./docFlow";
import type {
  ShipmentCargoLine,
  ShipmentParty,
  ShippableOrderLine,
} from "./types";

/**
 * 선적 화물·당사자 서비스 (P4.4) — SPEC E 계열, 원칙 1(잔량은 계산)·5(소비 가드)·7·8.
 *
 * ⚠️ 쓰기는 SECURITY DEFINER RPC `save_shipment_cargo` 하나뿐이다(diff-upsert).
 *    앱에는 shipment_lines/shipment_parties 의 INSERT 권한조차 없다(DB REVOKE).
 *    구 save_shipment(헤더·주문연결·마일스톤)와 저장 경계가 분리돼 있다 —
 *    구 폼 저장은 화물·당사자·마킹을 건드리지 않는다.
 *
 * ⚠️ 선적은 **물류 전표** — 재고 원장 전기 없음(그건 GR/DLV), 금액·환율 없음(P4 수량 전용).
 */

/* ---------- 순수 로직 재수출 — 단일 진실은 cargoLogic(선적 고유) · docFlow(공용) ---------- */
export {
  planCargoLineDiff,
  defaultShipmentParties,
  qtyTotalsByUom,
  packageTotalsByType,
  sumFinite,
  type CargoDiffPlan,
  type ShipmentPartyDraft,
  type ShipmentPartyRole,
  type SellerLike,
  type PartnerLike,
  type CargoQtyLike,
  type CargoPackageLike,
} from "./cargoLogic";
export {
  openQtyOf,
  prefillQty,
  consumedQtyOf as shippedQtyOf,
  isOverConsume as isOverShipment,
  resolveUom,
  resolveUomOrThrow,
  resolveDocLineUom,
  uomConflict,
} from "./docFlow";
export type { DocQtyLike as ShipmentQtyLike } from "./docFlow";

/* ---------- 물리 행 모양 ---------- */

interface CargoLineRow {
  id: string;
  order_type: "SO" | "PO";
  order_line_id: string | null;
  item_id: string | null;
  item_name: string;
  qty: number | string;
  uom: string; // DB not null — 저장 시 해석 실패는 거부되므로 폴백이 없다(P4.3f)
  package_count: number | string | null;
  package_type: string | null;
  gross_weight_kg: number | string | null;
  cbm: number | string | null;
  memo: string | null;
}

interface PartyRow {
  role: "shipper" | "consignee" | "notify";
  company_id: string | null;
  name: string;
  address: string | null;
  contact: string | null;
}

function num(v: number | string | null): number {
  if (v === null) return 0;
  return typeof v === "number" ? v : Number(v);
}

/** PostgREST 기본 상한(1000행)은 **경고 없이 자른다**(P4.1f 확증 함정) — 페이지 크기. */
const PAGE = 1000;
/** .in() id 목록은 URL 로 나간다 — 길면 요청 자체가 깨지므로 잘라 보낸다. */
const IN_CHUNK = 150;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function numOrNull(v: number | string | null): number | null {
  if (v === null) return null;
  return typeof v === "number" ? v : Number(v);
}

function mapLine(row: CargoLineRow): ShipmentCargoLine {
  return {
    id: row.id,
    orderType: row.order_type,
    orderLineId: row.order_line_id,
    itemId: row.item_id,
    itemName: row.item_name,
    qty: num(row.qty),
    uom: row.uom,
    packageCount: numOrNull(row.package_count),
    packageType: row.package_type,
    grossWeightKg: numOrNull(row.gross_weight_kg),
    cbm: numOrNull(row.cbm),
    memo: row.memo,
  };
}

/* ---------- I/O ---------- */

/** 선적 1건의 화물 내역·당사자·마킹. */
export async function getShipmentCargo(shipmentId: string): Promise<{
  lines: ShipmentCargoLine[];
  parties: ShipmentParty[];
  shippingMarks: string | null;
}> {
  const supabase = createSupabaseServerClient();
  const [linesRes, partiesRes, shpRes] = await Promise.all([
    supabase
      .from("shipment_lines")
      .select(
        "id, order_type, order_line_id, item_id, item_name, qty, uom, " +
          "package_count, package_type, gross_weight_kg, cbm, memo",
      )
      .eq("shipment_id", shipmentId)
      // 테이블에 정렬 컬럼이 없다(스펙 확정 컬럼) — 결정적 표시를 위해 이름·id 순.
      .order("item_name", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("shipment_parties")
      .select("role, company_id, name, address, contact")
      .eq("shipment_id", shipmentId),
    supabase
      .from("shipments")
      .select("shipping_marks")
      .eq("id", shipmentId)
      .maybeSingle(),
  ]);

  if (linesRes.error)
    throw new Error(`선적 화물 조회 실패: ${linesRes.error.message}`);
  if (partiesRes.error)
    throw new Error(`선적 당사자 조회 실패: ${partiesRes.error.message}`);
  if (shpRes.error) throw new Error(`선적 조회 실패: ${shpRes.error.message}`);

  const roleOrder = { shipper: 0, consignee: 1, notify: 2 } as const;
  const parties = ((partiesRes.data ?? []) as unknown as PartyRow[])
    .map((r) => ({
      role: r.role,
      companyId: r.company_id,
      name: r.name,
      address: r.address,
      contact: r.contact,
    }))
    .sort((a, b) => roleOrder[a.role] - roleOrder[b.role]);

  return {
    lines: ((linesRes.data ?? []) as unknown as CargoLineRow[]).map(mapLine),
    parties,
    shippingMarks:
      (shpRes.data as { shipping_marks: string | null } | null)
        ?.shipping_marks ?? null,
  };
}

/**
 * "라인 불러오기" 원천 — 이 선적에 연결된 주문들의 라인별 선적잔량.
 * 잔량 = 주문라인 수량 − Σ(살아있는 선적 라인, 전 선적 대상) — 뷰가 계산(원칙 1).
 * uom 은 표시·저장이 같은 체인으로 해석된다(P4.3f 불변식: 폼 표시 == 원장 기록).
 */
export async function listShippableOrderLines(
  shipmentId: string,
): Promise<ShippableOrderLine[]> {
  const supabase = createSupabaseServerClient();
  const { data: links, error: linkErr } = await supabase
    .from("shipment_orders")
    .select("order_type, order_id, order_number")
    .eq("shipment_id", shipmentId);
  if (linkErr) throw new Error(`선적 주문연결 조회 실패: ${linkErr.message}`);

  const linkRows = (links ?? []) as unknown as {
    order_type: "SO" | "PO";
    order_id: string;
    order_number: string | null;
  }[];
  if (linkRows.length === 0) return [];

  const orderNumber = new Map(
    linkRows.map((l) => [`${l.order_type}|${l.order_id}`, l.order_number]),
  );

  interface OrderLineRow {
    id: string;
    doc_id: string;
    product_id: string | null;
    product_name: string | null;
    unit: string | null;
    quantity: number | string | null;
    sort_order: number | null;
  }
  const rows: (OrderLineRow & { orderType: "SO" | "PO" })[] = [];

  async function loadOrderLines(
    table: "so_lines" | "po_lines",
    docColumn: "so_id" | "po_id",
    orderType: "SO" | "PO",
  ) {
    const ids = linkRows
      .filter((l) => l.order_type === orderType)
      .map((l) => l.order_id);
    if (ids.length === 0) return;
    // ⚠️ 상한 없이 부르면 1000행에서 말없이 잘린다 — 잘린 잔량은 초과 경고를 죽이고
    //    lockedOrderKeys 를 빈약하게 만든다(가드 구멍). 전량 페이징(P4.1f 규칙).
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select(`id, ${docColumn}, product_id, product_name, unit, quantity, sort_order`)
        .in(docColumn, ids)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true }) // 전순서 타이브레이커 — 경계 중복·누락 방지
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`주문 라인 조회 실패: ${error.message}`);
      const batch = (data ?? []) as unknown as Record<string, unknown>[];
      for (const r of batch) {
        rows.push({
          id: r.id as string,
          doc_id: r[docColumn] as string,
          product_id: (r.product_id as string | null) ?? null,
          product_name: (r.product_name as string | null) ?? null,
          unit: (r.unit as string | null) ?? null,
          quantity: (r.quantity as number | string | null) ?? null,
          sort_order: (r.sort_order as number | null) ?? null,
          orderType,
        });
      }
      if (batch.length < PAGE) break;
    }
  }
  await loadOrderLines("so_lines", "so_id", "SO");
  await loadOrderLines("po_lines", "po_id", "PO");
  if (rows.length === 0) return [];

  // 기선적 수량 — 뷰(살아있는 선적만). 이 선적뿐 아니라 **전 선적**의 소비가 잔량을 줄인다.
  const shipped = new Map<string, number>();
  for (const idChunk of chunks(rows.map((r) => r.id), IN_CHUNK)) {
    const { data: totals, error: totErr } = await supabase
      .from("shipment_line_totals")
      .select("order_type, order_line_id, shipped_qty")
      .in("order_line_id", idChunk);
    if (totErr) throw new Error(`선적 잔량 조회 실패: ${totErr.message}`);
    for (const t of (totals ?? []) as unknown as {
      order_type: string;
      order_line_id: string;
      shipped_qty: number | string;
    }[]) {
      shipped.set(`${t.order_type}|${t.order_line_id}`, num(t.shipped_qty));
    }
  }

  // 표시 단위 해석 — 저장 경로와 같은 순수 규칙(P4.3f)이라 폼 표시 == 저장 결과.
  const uoms = await resolveOpenLineUoms(
    rows.map((r) => ({ unit: r.unit, productId: r.product_id })),
  );

  return rows.map((r, i) => {
    const shippedQty = shipped.get(`${r.orderType}|${r.id}`) ?? 0;
    const ordered = num(r.quantity);
    return {
      orderType: r.orderType,
      orderId: r.doc_id,
      orderNumber: orderNumber.get(`${r.orderType}|${r.doc_id}`) ?? null,
      orderLineId: r.id,
      productId: r.product_id,
      itemName: r.product_name,
      uom: uoms[i],
      orderedQty: ordered,
      shippedQty,
      openQty: openQtyOf(ordered, [{ qty: shippedQty, cancelled: false }]),
    };
  });
}

/**
 * 이 주문(수주/발주)의 라인을 참조하는 **살아있는 선적 화물 라인** 존재 여부 —
 * 소비 가드(원칙 5)의 서비스 층. 0보다 크면 주문 수정·취소가 잠긴다(DB 트리거가
 * 최종 방어선, 여기선 배너·✕ 비활성 안내용). 기존 카운터 함수들은 무수정 — 별도 신설.
 * 뷰(shipment_line_totals)는 취소 선적을 이미 제외하므로 행 존재 = 살아있는 참조.
 */
export async function countLiveShipmentLinesForSo(soId: string): Promise<number> {
  return countLiveShipmentLines("so_lines", "so_id", soId, "SO");
}

export async function countLiveShipmentLinesForPo(poId: string): Promise<number> {
  return countLiveShipmentLines("po_lines", "po_id", poId, "PO");
}

async function countLiveShipmentLines(
  table: "so_lines" | "po_lines",
  docColumn: "so_id" | "po_id",
  docId: string,
  orderType: "SO" | "PO",
): Promise<number> {
  const supabase = createSupabaseServerClient();
  // ⚠️ 잠금 판정이 잘리면 **폼이 열렸다가 DB 트리거의 날 예외**를 맞는다 — 전량 페이징.
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq(docColumn, docId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`주문 라인 조회 실패: ${error.message}`);
    const batch = (data ?? []) as unknown as { id: string }[];
    ids.push(...batch.map((r) => r.id));
    if (batch.length < PAGE) break;
  }
  if (ids.length === 0) return 0;

  let total = 0;
  for (const idChunk of chunks(ids, IN_CHUNK)) {
    const { count, error } = await supabase
      .from("shipment_line_totals")
      .select("order_line_id", { count: "exact", head: true })
      .eq("order_type", orderType)
      .in("order_line_id", idChunk);
    if (error) throw new Error(`선적 참조 조회 실패: ${error.message}`);
    total += count ?? 0;
  }
  return total;
}

/* ---------- 저장 ---------- */

export interface CargoLineInput {
  id: string | null; // 기존 행이면 id (diff-upsert 의 UPDATE 키)
  orderType: "SO" | "PO";
  orderLineId: string;
  itemName: string | null;
  qty: number;
  packageCount: number | null;
  packageType: string | null;
  grossWeightKg: number | null;
  cbm: number | null;
  memo: string | null;
}

export interface ShipmentPartyInput {
  role: "shipper" | "consignee" | "notify";
  companyId: string | null;
  name: string;
  address: string | null;
  contact: string | null;
}

/**
 * 화물 내역·당사자·마킹 저장 — RPC 한 트랜잭션. 라인은 diff-upsert(전량교체 금지).
 *
 * ⚠️ uom 을 입력으로 받지 않는다 — 서비스가 주문 라인→품목 마스터에서 해석한다
 *    (P4.3f 체인 재사용, 'PCS' 발명 금지. 해석 불능이면 여기서 한국어로 거부).
 */
export async function saveShipmentCargo(input: {
  shipmentId: string;
  lines: CargoLineInput[];
  parties: ShipmentPartyInput[];
  shippingMarks: string | null;
  /** 클라이언트가 화면에 갖고 있던 저장 라인 id — 동시성 베이스라인(아래 검사). */
  knownLineIds: string[];
}): Promise<{ lineCount: number; partyCount: number }> {
  const supabase = createSupabaseServerClient();

  // ★ 동시성 베이스라인 — diff-upsert 의 DELETE 는 "payload 에 없는 행"을 지운다.
  //   다른 화면(탭)이 그 사이 추가한 행은 이 화면의 payload 에 없으므로, 대조 없이
  //   저장하면 **경고 없이 삭제**된다. 화면이 알던 id 집합과 DB 를 대조해 어긋나면
  //   멈춘다 — 잃는 건 클릭 한 번, 지키는 건 다른 화면의 데이터.
  const { data: curRows, error: curErr } = await supabase
    .from("shipment_lines")
    .select("id")
    .eq("shipment_id", input.shipmentId);
  if (curErr) throw new Error(`화물 라인 조회 실패: ${curErr.message}`);
  const known = new Set(input.knownLineIds);
  const foreign = ((curRows ?? []) as unknown as { id: string }[]).filter(
    (r) => !known.has(r.id),
  );
  if (foreign.length > 0) {
    throw new Error(
      `다른 화면에서 화물 내역이 변경되었습니다(이 화면이 모르는 라인 ${foreign.length}건). ` +
        `화면을 새로고침해 최신 내역을 확인한 뒤 다시 저장하세요.`,
    );
  }

  const resolutions = await resolveShipmentCargoUoms({
    shipmentId: input.shipmentId,
    lineRefs: input.lines.map((l) => ({
      orderType: l.orderType,
      lineId: l.orderLineId,
      itemName: l.itemName,
    })),
  });

  // 연결 오류가 단위 오류보다 먼저다 — P4.4h 부터는 RPC 도 같은 순서다(연결 검사
  // 뒤에 서버 uom 재해석). 이 선검사는 우회책이 아니라 같은 순서의 빠른 가드로
  // 남긴다: DB 왕복 전에 정확한 원인을 한국어로 말한다(오진 방지 UX 유지).
  const notLinkedIdx = resolutions.findIndex((r) => !r.linked);
  if (notLinkedIdx >= 0) {
    throw new Error(
      `이 선적에 연결되지 않은 주문의 라인이 있습니다: ${
        input.lines[notLinkedIdx].itemName ?? "(이름 없음)"
      } — 위 폼에서 주문 연결을 확인하고 화면을 새로고침한 뒤 다시 시도하세요.`,
    );
  }
  const noUomIdx = resolutions.findIndex((r) => r.linked && r.uom === null);
  if (noUomIdx >= 0) {
    throw new Error(
      `단위를 알 수 없어 저장할 수 없습니다: ${
        input.lines[noUomIdx].itemName ?? "(이름 없음)"
      } — 주문 라인과 품목 마스터 어디에도 단위가 없습니다. 품목 마스터에서 단위를 입력한 뒤 다시 시도하세요.`,
    );
  }
  const uoms = resolutions.map((r) => r.uom);

  const { data, error } = await supabase.rpc("save_shipment_cargo", {
    p_shipment_id: input.shipmentId,
    p_lines: input.lines.map((l, i) => ({
      id: l.id,
      orderType: l.orderType,
      orderLineId: l.orderLineId,
      itemName: l.itemName,
      qty: Math.abs(l.qty),
      uom: uoms[i], // 해석 완료 단위 — null 이면 RPC 가 한국어로 거부(마지막 방어선)
      packageCount: l.packageCount,
      packageType: l.packageType,
      grossWeightKg: l.grossWeightKg,
      cbm: l.cbm,
      memo: l.memo,
    })),
    p_parties: input.parties.map((p) => ({
      role: p.role,
      companyId: p.companyId,
      name: p.name,
      address: p.address,
      contact: p.contact,
    })),
    p_shipping_marks: input.shippingMarks,
  });

  if (error) throw new Error(`화물 내역 저장 실패: ${error.message}`);
  const r = data as { lineCount: number; partyCount: number };
  return { lineCount: r.lineCount, partyCount: r.partyCount };
}

/**
 * 화인(Shipping Marks)만 저장 — P4.5(c0) 전용 RPC `update_shipment_marks`.
 *
 * ⚠️ 왜 별도 경로인가: save_shipment_cargo 는 라인 diff-upsert·당사자 전량교체를
 *    **항상** 수행하므로, 활성(issued) 무역서류가 있는 선적에서는 marks 만 고쳐도
 *    P4.5 잠금 가드에 걸려 저장 전체가 차단된다. marks 는 발행 시점에 문서로
 *    스냅샷되는 필드라(D2) 가드 비대상 — 이 전용 경로는 shipments 의
 *    shipping_marks(+updated_at)만 갱신한다(타 컬럼 불가촉).
 *    빈 값 허용 — 지우기는 정당한 조작(서버가 공백→NULL 정규화).
 */
export async function updateShipmentMarks(
  shipmentId: string,
  marks: string | null,
): Promise<{ shippingMarks: string | null }> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("update_shipment_marks", {
    p_shipment_id: shipmentId,
    p_marks: marks,
  });
  if (error) throw new Error(`화인(Shipping Marks) 저장 실패: ${error.message}`);
  const r = data as { shippingMarks: string | null };
  return { shippingMarks: r.shippingMarks ?? null };
}
