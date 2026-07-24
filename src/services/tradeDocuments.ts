import { createSupabaseServerClient } from "@/lib/supabase/server";
import { todayKst } from "@/lib/date";
import { SELLER } from "@/config/company";
// 재수출(아래 export {…} from "./tradeDocLogic")과 별개로 로컬 사용을 위해 import 한다.
import { documentContainerNoLabel } from "./tradeDocLogic";
import type {
  IssuableLine,
  TradeDocument,
  TradeDocumentContainer,
  TradeDocumentContainerAllocation,
  TradeDocumentContainersSnapshot,
  TradeDocumentIssueInput,
  TradeDocumentLine,
  TradeDocumentListItem,
  TradeDocumentPackage,
} from "./types";

/**
 * 무역서류(P4.5 CI/PL) 서비스 — SPEC D1~D8 + 증보 판정(R1~R4·R-정정).
 *
 * ⚠️ 수정 함수가 없다. 무역서류는 발행 아니면 **취소(사유 필수)** 뿐이다(D1).
 *    앱에는 trade_documents/trade_document_lines 의 쓰기 권한이 없고(출생 봉인),
 *    쓰기는 SECURITY DEFINER RPC 2개(save_trade_document·cancel_trade_document)로만.
 *
 * ⚠️ qty·uom·단가·금액은 RPC 가 원천(shipment_lines→so_lines→products)에서
 *    재해석·재계산한다(클라 값 불신) — 이 서비스는 보충 필드만 실어 보낸다.
 *
 * ⚠️ 인쇄(CI·PL)는 여기의 스냅샷 반환값만 소비한다 — 라이브 마스터 재조회 0(D2).
 */

/* ---------- 순수 로직 재수출 (발행 폼이 브라우저에서 쓴다) ---------- */
export {
  allocateDiscounts,
  discountEntriesOf,
  documentContainerNoLabel,
  issuableCombos,
  lineAmount,
  linesForCombo,
  packingFillMode,
  subtotalOf,
  totalOf,
  weightFillMode,
  weightTotal,
  zeroPriceCount,
} from "./tradeDocLogic";
export type {
  AllOrNothing,
  ComboSourceLine,
  DiscountAllocEntry,
  DiscountSourceLine,
  IssuableCombo,
  PackingLike,
} from "./tradeDocLogic";
export { packageTotalsByType, qtyTotalsByUom } from "./cargoLogic";

/* ---------- 물리 행 모양 ---------- */

interface TdLineRow {
  id: string;
  line_no: number;
  shipment_line_id: string | null;
  order_line_id: string | null;
  product_code: string | null;
  product_name: string;
  description: string | null;
  hs_code: string | null;
  origin_country: string | null;
  qty: number | string;
  uom: string;
  unit_price: number | string;
  amount: number | string;
  net_weight: number | string | null;
  gross_weight: number | string | null;
}

interface TdRow {
  id: string;
  doc_type: string;
  doc_number: string;
  shipment_id: string;
  customer_id: string;
  currency: string;
  issue_date: string;
  incoterm: string | null;
  incoterm_place: string | null;
  payment_terms: string | null;
  remarks: string | null;
  seller_name: string;
  seller_address: string;
  seller_country: string;
  seller_tel: string | null;
  seller_email: string | null;
  seller_biz_reg_no: string;
  seller_bank_name: string | null;
  seller_account_no: string | null;
  seller_swift: string | null;
  seller_signatory_name: string | null;
  seller_signatory_title: string | null;
  buyer_name: string;
  buyer_address: string | null;
  buyer_city: string | null;
  buyer_country: string | null;
  buyer_contact_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  consignee_name: string | null;
  consignee_address: string | null;
  consignee_contact: string | null;
  notify_name: string | null;
  notify_address: string | null;
  notify_contact: string | null;
  shipping_marks: string | null;
  shipment_no: string | null;
  transport: string | null;
  vessel_voyage: string | null;
  pol: string | null;
  pod: string | null;
  carrier: string | null;
  bl_no: string | null;
  booking_no: string | null;
  container_no: string | null;
  packages_snapshot: unknown;
  containers_snapshot: unknown;
  subtotal_amount: number | string;
  discount_amount: number | string;
  total_amount: number | string;
  status: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  trade_document_lines?: TdLineRow[] | null;
}

const TD_LIST_COLUMNS =
  "id, doc_number, shipment_id, shipment_no, customer_id, buyer_name, currency, " +
  "total_amount, status, issue_date, created_at";

const TD_COLUMNS =
  "id, doc_type, doc_number, shipment_id, customer_id, currency, issue_date, " +
  "incoterm, incoterm_place, payment_terms, remarks, " +
  "seller_name, seller_address, seller_country, seller_tel, seller_email, seller_biz_reg_no, " +
  "seller_bank_name, seller_account_no, seller_swift, seller_signatory_name, seller_signatory_title, " +
  "buyer_name, buyer_address, buyer_city, buyer_country, buyer_contact_name, buyer_email, buyer_phone, " +
  "consignee_name, consignee_address, consignee_contact, notify_name, notify_address, notify_contact, " +
  "shipping_marks, shipment_no, transport, vessel_voyage, pol, pod, carrier, bl_no, booking_no, container_no, " +
  "packages_snapshot, containers_snapshot, subtotal_amount, discount_amount, total_amount, status, cancelled_at, cancel_reason, created_at, " +
  "trade_document_lines(id, line_no, shipment_line_id, order_line_id, product_code, product_name, " +
  "description, hs_code, origin_country, qty, uom, unit_price, amount, net_weight, gross_weight)";

function num(v: number | string | null): number {
  if (v === null) return 0;
  return typeof v === "number" ? v : Number(v);
}

function numOrNull(v: number | string | null): number | null {
  if (v === null) return null;
  return typeof v === "number" ? v : Number(v);
}

function mapLine(row: TdLineRow): TradeDocumentLine {
  return {
    id: row.id,
    lineNo: row.line_no,
    shipmentLineId: row.shipment_line_id,
    orderLineId: row.order_line_id,
    productCode: row.product_code,
    productName: row.product_name,
    description: row.description,
    hsCode: row.hs_code,
    originCountry: row.origin_country,
    qty: num(row.qty),
    uom: row.uom,
    unitPrice: num(row.unit_price),
    amount: num(row.amount),
    netWeight: numOrNull(row.net_weight),
    grossWeight: numOrNull(row.gross_weight),
  };
}

function mapPackages(v: unknown): TradeDocumentPackage[] {
  if (!Array.isArray(v)) return [];
  return v.map((p) => {
    const r = p as Record<string, unknown>;
    return {
      shipmentLineId: (r.shipmentLineId as string | null) ?? null,
      itemName: (r.itemName as string | null) ?? null,
      packageCount: numOrNull((r.packageCount as number | string | null) ?? null),
      packageType: (r.packageType as string | null) ?? null,
      grossWeightKg: numOrNull((r.grossWeightKg as number | string | null) ?? null),
      cbm: numOrNull((r.cbm as number | string | null) ?? null),
    };
  });
}

/* ---------- 적입 스냅샷 매핑 (P5.3) ---------- */

function plainObjectOrNull(v: unknown): Record<string, unknown> | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** 숫자 아니면 null — NaN 을 인쇄에 흘리지 않는다(mapPackages 계보 + 방어 강화). */
function snapNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function snapStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * `containers_snapshot` → 타입 구조. **하위호환이 이 함수의 존재 이유다.**
 *
 *  · `null`/`undefined`/비객체 → `null` = **P5.3 이전 발행**.
 *    헤더는 `container_no` 스칼라로 폴백하고 섹션은 생략된다(판정 ②).
 *  · `{ containers: [] }` → 빈 구조 = **적입 스코프 0건으로 발행**. 폴백 금지.
 *  · 키 결손·타입 이상은 **던지지 않고** 안전한 기본값으로 접는다 —
 *    데이터 이상으로 인쇄물이 500 을 내면 안 된다(서류는 나와야 한다).
 */
export function mapContainers(
  v: unknown,
): TradeDocumentContainersSnapshot | null {
  const root = plainObjectOrNull(v);
  if (root === null) return null;

  const rawContainers = Array.isArray(root.containers) ? root.containers : [];
  const containers: TradeDocumentContainer[] = [];
  for (const rc of rawContainers) {
    const c = plainObjectOrNull(rc);
    if (c === null) continue; // 원소가 객체가 아니면 그 원소만 버린다
    const rawAllocs = Array.isArray(c.allocations) ? c.allocations : [];
    const allocations: TradeDocumentContainerAllocation[] = [];
    for (const ra of rawAllocs) {
      const a = plainObjectOrNull(ra);
      if (a === null) continue;
      allocations.push({
        shipmentLineId: snapStr(a.shipmentLineId),
        allocatedPackageCount: snapNum(a.allocatedPackageCount),
      });
    }
    containers.push({
      // VGM 은 매핑하지 않는다(P5.3 §4) — 스냅샷에 없어야 정상이고, 구(舊) 스냅샷에
      // vgmKg 키가 남아 있어도 여기서 조용히 버린다(여분 키 무시).
      containerNo: snapStr(c.containerNo),
      containerType: snapStr(c.containerType),
      sealNo: snapStr(c.sealNo),
      allocations,
      packageCount: snapNum(c.packageCount),
      grossWeightKg: snapNum(c.grossWeightKg),
      cbm: snapNum(c.cbm),
      // 진짜 true 일 때만 true — truthy 문자열("false")에 속지 않는다.
      gwIncomplete: c.gwIncomplete === true,
      cbmIncomplete: c.cbmIncomplete === true,
    });
  }

  const t = plainObjectOrNull(root.totals);
  return {
    containers,
    totals:
      t === null
        ? null
        : {
            packageCount: snapNum(t.packageCount),
            grossWeightKg: snapNum(t.grossWeightKg),
            cbm: snapNum(t.cbm),
            gwIncomplete: t.gwIncomplete === true,
            cbmIncomplete: t.cbmIncomplete === true,
          },
  };
}

function mapDoc(row: TdRow): TradeDocument {
  return {
    id: row.id,
    docType: row.doc_type,
    docNumber: row.doc_number,
    shipmentId: row.shipment_id,
    customerId: row.customer_id,
    currency: row.currency,
    issueDate: row.issue_date,
    incoterm: row.incoterm,
    incotermPlace: row.incoterm_place,
    paymentTerms: row.payment_terms,
    remarks: row.remarks,
    sellerName: row.seller_name,
    sellerAddress: row.seller_address,
    sellerCountry: row.seller_country,
    sellerTel: row.seller_tel,
    sellerEmail: row.seller_email,
    sellerBizRegNo: row.seller_biz_reg_no,
    sellerBankName: row.seller_bank_name,
    sellerAccountNo: row.seller_account_no,
    sellerSwift: row.seller_swift,
    sellerSignatoryName: row.seller_signatory_name,
    sellerSignatoryTitle: row.seller_signatory_title,
    buyerName: row.buyer_name,
    buyerAddress: row.buyer_address,
    buyerCity: row.buyer_city,
    buyerCountry: row.buyer_country,
    buyerContactName: row.buyer_contact_name,
    buyerEmail: row.buyer_email,
    buyerPhone: row.buyer_phone,
    consigneeName: row.consignee_name,
    consigneeAddress: row.consignee_address,
    consigneeContact: row.consignee_contact,
    notifyName: row.notify_name,
    notifyAddress: row.notify_address,
    notifyContact: row.notify_contact,
    shippingMarks: row.shipping_marks,
    shipmentNo: row.shipment_no,
    transport: row.transport,
    vesselVoyage: row.vessel_voyage,
    pol: row.pol,
    pod: row.pod,
    carrier: row.carrier,
    blNo: row.bl_no,
    bookingNo: row.booking_no,
    containerNo: row.container_no,
    packagesSnapshot: mapPackages(row.packages_snapshot),
    containersSnapshot: mapContainers(row.containers_snapshot),
    subtotalAmount: num(row.subtotal_amount),
    discountAmount: num(row.discount_amount),
    totalAmount: num(row.total_amount),
    status: row.status,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    lines: (row.trade_document_lines ?? [])
      .map(mapLine)
      .sort((a, b) => a.lineNo - b.lineNo),
  };
}

interface TdListRow {
  id: string;
  doc_number: string;
  shipment_id: string;
  shipment_no: string | null;
  customer_id: string;
  buyer_name: string;
  currency: string;
  total_amount: number | string;
  status: string;
  issue_date: string;
  created_at: string;
}

function mapListItem(row: TdListRow): TradeDocumentListItem {
  return {
    id: row.id,
    docNumber: row.doc_number,
    shipmentId: row.shipment_id,
    shipmentNo: row.shipment_no,
    customerId: row.customer_id,
    buyerName: row.buyer_name,
    currency: row.currency,
    totalAmount: num(row.total_amount),
    status: row.status,
    issueDate: row.issue_date,
    createdAt: row.created_at,
  };
}

/* ---------- I/O — 조회 (전부 헤더 스냅샷이라 마스터 조인이 없다) ---------- */

/** 무역서류 목록 — CANCELLED 포함(이력은 지우지 않는다). */
export async function listTradeDocuments(opts?: {
  status?: string;
  limit?: number;
}): Promise<TradeDocumentListItem[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase.from("trade_documents").select(TD_LIST_COLUMNS);
  if (opts?.status) query = query.eq("status", opts.status);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);

  if (error) throw new Error(`무역서류 목록 조회 실패: ${error.message}`);
  return ((data ?? []) as unknown as TdListRow[]).map(mapListItem);
}

/** 특정 선적의 무역서류 (선적 상세 "무역서류" 섹션 — 취소 포함). */
export async function listTradeDocumentsForShipment(
  shipmentId: string,
): Promise<TradeDocumentListItem[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trade_documents")
    .select(TD_LIST_COLUMNS)
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`선적 무역서류 조회 실패: ${error.message}`);
  return ((data ?? []) as unknown as TdListRow[]).map(mapListItem);
}

/**
 * 무역서류 헤더의 `Container No.` 표시값 — **소비처(CI·PL 인쇄·무역서류 상세)의
 * 단일 진입점**이다. 스냅샷 3상태 → containerNo[] 어댑터를 여기 한 곳에 둔다
 * (`documentContainerNoLabel` 이 규칙, 이 함수가 doc→인자 접기). 적대검증 nit 반영.
 */
export function docContainerNoLabel(
  doc: Pick<TradeDocument, "containersSnapshot" | "containerNo">,
): string | null {
  return documentContainerNoLabel(
    doc.containersSnapshot === null
      ? null
      : doc.containersSnapshot.containers.map((c) => c.containerNo),
    doc.containerNo,
  );
}

/** 무역서류 1건 (헤더 스냅샷 + 라인 스냅샷) — CI·PL 인쇄는 이 반환값만 본다. */
export async function getTradeDocument(id: string): Promise<TradeDocument | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trade_documents")
    .select(TD_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`무역서류 조회 실패: ${error.message}`);
  if (!data) return null;
  return mapDoc(data as unknown as TdRow);
}

/* ---------- I/O — 발행 폼 파생 조회 ---------- */

const IN_CHUNK = 150; // PostgREST .in() URL 길이 함정 — shipmentCargo.ts 와 동일 관례

async function selectInChunks<T>(
  fetchChunk: (ids: string[]) => Promise<T[]>,
  ids: string[],
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    out.push(...(await fetchChunk(ids.slice(i, i + IN_CHUNK))));
  }
  return out;
}

interface SlRow {
  id: string;
  order_type: "SO" | "PO";
  order_line_id: string | null;
  item_name: string;
  qty: number | string;
  uom: string;
  package_count: number | string | null;
  package_type: string | null;
  gross_weight_kg: number | string | null;
}

interface OlRow {
  id: string;
  so_id: string;
  product_id: string | null;
  hs_code: string | null;
  description: string | null;
  quantity: number | string | null;
  unit_price: number | string | null;
  amount: number | string | null;
}

interface SoRow {
  id: string;
  so_number: string | null;
  partner_id: string | null;
  currency: string | null;
  discount: number | string | null;
  companies?: { company_name: string | null } | null;
}

interface ProdRow {
  id: string;
  code: string | null;
  hs_code: string | null;
  origin_country: string | null;
}

/**
 * 발행 폼용 파생 행 — 선적 라인 + so_lines + sales_orders(+고객명) + products 를
 * 서버에서 한 번에 붙인다. 조합 도출·할인 미리보기·프리필의 단일 원천.
 *
 * ⚠️ 미리보기일 뿐 진실이 아니다 — 발행 시 RPC 가 같은 체인을 다시 읽어 재계산한다.
 * ⚠️ soOrderTotal 은 서버 D3 분모 미러: amount null 라인은 round2(qty×단가)로 합산.
 */
export async function listIssuableLines(shipmentId: string): Promise<IssuableLine[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("shipment_lines")
    .select(
      "id, order_type, order_line_id, item_name, qty, uom, package_count, package_type, gross_weight_kg",
    )
    .eq("shipment_id", shipmentId)
    .order("id");

  if (error) throw new Error(`선적 화물 조회 실패: ${error.message}`);
  const slRows = (data ?? []) as unknown as SlRow[];
  if (slRows.length === 0) return [];

  // ① 연결 주문 라인 (SO만 필요하지만 폼은 PO 라인도 회색으로 보여준다)
  const olIds = Array.from(
    new Set(
      slRows
        .filter((r) => r.order_type === "SO" && r.order_line_id)
        .map((r) => r.order_line_id as string),
    ),
  );
  const olRows = await selectInChunks<OlRow>(async (ids) => {
    const { data: d, error: e } = await supabase
      .from("so_lines")
      .select("id, so_id, product_id, hs_code, description, quantity, unit_price, amount")
      .in("id", ids);
    if (e) throw new Error(`주문 라인 조회 실패: ${e.message}`);
    return (d ?? []) as unknown as OlRow[];
  }, olIds);
  const olMap = new Map(olRows.map((r) => [r.id, r]));

  // ② 주문 헤더 + 고객명 (+ D3 분모용 전체 라인)
  const soIds = Array.from(new Set(olRows.map((r) => r.so_id)));
  const soRows = await selectInChunks<SoRow>(async (ids) => {
    const { data: d, error: e } = await supabase
      .from("sales_orders")
      .select("id, so_number, partner_id, currency, discount, companies(company_name)")
      .in("id", ids);
    if (e) throw new Error(`주문 조회 실패: ${e.message}`);
    return (d ?? []) as unknown as SoRow[];
  }, soIds);
  const soMap = new Map(soRows.map((r) => [r.id, r]));

  interface SoTotalRow {
    so_id: string;
    quantity: number | string | null;
    unit_price: number | string | null;
    amount: number | string | null;
  }
  const totalRows = await selectInChunks<SoTotalRow>(async (ids) => {
    const { data: d, error: e } = await supabase
      .from("so_lines")
      .select("so_id, quantity, unit_price, amount")
      .in("so_id", ids);
    if (e) throw new Error(`주문 라인 합계 조회 실패: ${e.message}`);
    return (d ?? []) as unknown as SoTotalRow[];
  }, soIds);
  const soTotals = new Map<string, number>();
  for (const r of totalRows) {
    // 서버 D3 분모 미러 — amount null 은 round2(qty×단가)로 재계산해 합산
    const amount =
      r.amount !== null
        ? num(r.amount)
        : Math.round((num(r.quantity) * num(r.unit_price) + Number.EPSILON) * 100) / 100;
    soTotals.set(r.so_id, (soTotals.get(r.so_id) ?? 0) + amount);
  }

  // ③ 품목 마스터 (프리필 폴백 — 소프트 포인터라 없을 수 있다)
  const prodIds = Array.from(
    new Set(olRows.map((r) => r.product_id).filter((v): v is string => v !== null)),
  );
  const prodRows = await selectInChunks<ProdRow>(async (ids) => {
    const { data: d, error: e } = await supabase
      .from("products")
      .select("id, code, hs_code, origin_country")
      .in("id", ids);
    if (e) throw new Error(`품목 조회 실패: ${e.message}`);
    return (d ?? []) as unknown as ProdRow[];
  }, prodIds);
  const prodMap = new Map(prodRows.map((r) => [r.id, r]));

  const blank = (v: string | null | undefined): string | null => {
    const t = v?.trim();
    return t ? t : null;
  };

  return slRows.map((sl) => {
    const ol = sl.order_line_id ? olMap.get(sl.order_line_id) : undefined;
    const so = ol ? soMap.get(ol.so_id) : undefined;
    const prod = ol?.product_id ? prodMap.get(ol.product_id) : undefined;
    const unitPrice = ol ? numOrNull(ol.unit_price) : null;
    const qty = num(sl.qty);
    return {
      shipmentLineId: sl.id,
      orderType: sl.order_type,
      itemName: sl.item_name,
      qty,
      uom: sl.uom,
      orderLineId: sl.order_line_id,
      soId: ol?.so_id ?? null,
      soNumber: so?.so_number ?? null,
      customerId: so?.partner_id ?? null,
      customerName: so?.companies?.company_name ?? null,
      currency: blank(so?.currency ?? null),
      unitPrice,
      amount:
        unitPrice === null
          ? null
          : Math.round((qty * unitPrice + Number.EPSILON) * 100) / 100,
      soDiscount: so ? num(so.discount) : 0,
      soOrderTotal: ol ? soTotals.get(ol.so_id) ?? 0 : 0,
      hsPrefill: blank(ol?.hs_code) ?? blank(prod?.hs_code),
      originPrefill: blank(prod?.origin_country),
      descriptionPrefill: blank(ol?.description),
      grossWeightPrefill: numOrNull(sl.gross_weight_kg),
      packageCount: numOrNull(sl.package_count),
      packageType: sl.package_type,
    };
  });
}

/* ---------- I/O — 쓰기 (RPC 단일 경로) ---------- */

/**
 * 발행 — 검증·재계산·발번·스냅샷 전량 기록이 **한 트랜잭션**(RPC).
 * Seller 는 config(SELLER) 원문을 실어 보내고, 플레이스홀더/공란 거부는 RPC 가 한다(D7).
 * 반환 warnings: 단가 0 라인 · 할인 미배분 등 — 화면이 발행 결과에 표시한다.
 */
export async function saveTradeDocument(
  input: TradeDocumentIssueInput,
): Promise<{ id: string; docNumber: string; warnings: string[] }> {
  if (input.lines.filter((l) => l.include).length === 0) {
    throw new Error("발행할 라인이 최소 1건 필요합니다.");
  }

  const date = input.issueDate ?? todayKst();
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("save_trade_document", {
    p_shipment_id: input.shipmentId,
    p_customer_id: input.customerId,
    p_currency: input.currency,
    p_issue_date: date, // 발번 기간(YYYYMM)은 RPC 가 이 날짜(KST)에서 도출
    p_header: {
      incoterm: input.incoterm,
      incotermPlace: input.incotermPlace,
      paymentTerms: input.paymentTerms,
      remarks: input.remarks,
      seller: {
        name: SELLER.name,
        addressLines: [...SELLER.addressLines],
        country: SELLER.country,
        tel: SELLER.tel,
        email: SELLER.email,
        bizRegNo: SELLER.bizRegNo,
        bankName: SELLER.bank.bankName,
        accountNo: SELLER.bank.accountNo,
        swift: SELLER.bank.swift,
        signatoryName: SELLER.signatory.name,
        signatoryTitle: SELLER.signatory.title,
      },
    },
    p_lines: input.lines.map((l) => ({
      shipmentLineId: l.shipmentLineId,
      include: l.include,
      hsCode: l.hsCode,
      originCountry: l.originCountry,
      netWeight: l.netWeight,
      grossWeight: l.grossWeight,
      description: l.description,
    })),
  });

  if (error) throw new Error(`무역서류 발행 실패: ${error.message}`);
  const r = data as { id: string; docNumber: string; warnings?: string[] };
  return { id: r.id, docNumber: r.docNumber, warnings: r.warnings ?? [] };
}

/** 취소 — 삭제가 아니라 상태 전환(issued→cancelled)뿐. 사유 필수(R4). */
export async function cancelTradeDocument(id: string, reason: string): Promise<void> {
  if (!reason || reason.trim() === "") {
    throw new Error("무역서류 취소 사유는 필수입니다.");
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_trade_document", {
    p_id: id,
    p_reason: reason.trim(),
  });
  if (error) throw new Error(`무역서류 취소 실패: ${error.message}`);
}
