/**
 * 문서 흐름 추적 — 순수 로직 (P4.6, 조회 전용). **I/O 없음 → 단위 테스트 대상.**
 *
 * 두 부분:
 *   1) 어휘 사전(DOC_TYPES) — 전표타입별 slug·실테이블명·라벨·상세href·판별자 실값.
 *      홉마다 다른 판별자 어휘(order_type / ref_doc_type / stock의 ref_doc_type)를
 *      **단일 진실**로 모은다. 조회·분기·href 생성은 전부 이 사전을 경유한다
 *      (홉별 하드코딩 금지 — 사전을 우회하면 P4.4h 관례가 깨진다).
 *   2) DAG 조립(assembleChain) — docChain.ts 가 배치 조회한 원자료를 받아
 *      노드·엣지·컬럼·경계·스텁·초점·원장리프를 순수하게 구성한다.
 *
 * ⚠️ 사전 판별자 실값(조사 확정 — file:line 근거는 스펙 §2):
 *      deliveries.ref_doc_type = 'sales_order'
 *      goods_receipts.ref_doc_type = 'purchase_order'
 *      stock_movements.ref_doc_type = 'delivery' | 'goods_receipt'
 *      shipment_orders / shipment_lines.order_type = 'SO' | 'PO'
 *    p4.1:50 컬럼 주석의 'GR'|'DLV' 는 오기 — 실값 기준으로만 작성한다.
 *
 * ⚠️ docFlow.ts 와 파일·역할 분리: docFlow = 잔량·단위 산술(입고/출고 공용),
 *    chainLogic = 사슬 어휘·DAG 조립. 이름이 비슷하다고 섞지 않는다.
 */

import type { BadgeVariant } from "@/components/Badge";
import {
  labelOf,
  INQUIRY_STATUS,
  QUOTATION_STATUS,
  SO_STATUS_ALL,
  PO_STATUS_ALL,
  SHIPMENT_STATUS,
  GR_STATUS,
  DELIVERY_STATUS,
  TRADE_DOC_STATUS,
  CUSTOMS_DECL_STATUS,
  type Code,
} from "./codes";

/* ============================================================================
 * 1) 어휘 사전
 * ========================================================================== */

export type DocTypeKey =
  | "inquiry"
  | "quotation"
  | "salesOrder"
  | "purchaseOrder"
  | "shipment"
  | "goodsReceipt"
  | "delivery"
  | "tradeDocument"
  | "customsDeclaration";

export type OrderType = "SO" | "PO";

/** 렌더 컬럼 그룹 순서(스펙 §5): 상류 → 주문 → 이행 → 종단. */
export type ColumnGroup = "upstream" | "orders" | "fulfillment" | "terminal";

export const COLUMN_ORDER: ColumnGroup[] = [
  "upstream",
  "orders",
  "fulfillment",
  "terminal",
];

export const COLUMN_LABEL: Record<ColumnGroup, string> = {
  upstream: "상류 (문의·견적)",
  orders: "주문 (수주·발주)",
  fulfillment: "이행 (선적·출고·입고)",
  terminal: "종단 (무역서류·원장)",
};

export interface DocTypeDef {
  key: DocTypeKey;
  /** URL 세그먼트 = 상세 라우트 세그먼트 = /flow/[slug] 의 slug. */
  slug: string;
  /** 물리 테이블 실명 (= audit_log.table_name 과 동일). */
  table: string;
  /** 한글 라벨. */
  label: string;
  /** 주문 전표의 order_type 실값(SO/PO). 주문이 아니면 null. */
  orderType: OrderType | null;
  /** 이 전표 자신의 ref_doc_type 실값(상류를 가리킴). 예: delivery→'sales_order'. */
  ownRefDocType: string | null;
  /** 재고 원장(stock_movements)이 이 전표를 가리킬 때의 ref_doc_type 실값. */
  stockRefDocType: string | null;
  column: ColumnGroup;
  /** 상태 배지 라벨 원천(codes.ts). */
  statusCodes: Code[];
}

export const DOC_TYPES: Record<DocTypeKey, DocTypeDef> = {
  inquiry: {
    key: "inquiry",
    slug: "inquiries",
    table: "inquiries",
    label: "문의",
    orderType: null,
    ownRefDocType: null,
    stockRefDocType: null,
    column: "upstream",
    statusCodes: INQUIRY_STATUS,
  },
  quotation: {
    key: "quotation",
    slug: "quotations",
    table: "quotations",
    label: "견적",
    orderType: null,
    ownRefDocType: null,
    stockRefDocType: null,
    column: "upstream",
    statusCodes: QUOTATION_STATUS,
  },
  salesOrder: {
    key: "salesOrder",
    slug: "sales-orders",
    table: "sales_orders",
    label: "수주",
    orderType: "SO",
    ownRefDocType: null,
    stockRefDocType: null,
    column: "orders",
    statusCodes: SO_STATUS_ALL,
  },
  purchaseOrder: {
    key: "purchaseOrder",
    slug: "purchase-orders",
    table: "purchase_orders",
    label: "발주",
    orderType: "PO",
    ownRefDocType: null,
    stockRefDocType: null,
    column: "orders",
    statusCodes: PO_STATUS_ALL,
  },
  shipment: {
    key: "shipment",
    slug: "shipments",
    table: "shipments",
    label: "선적",
    orderType: null,
    ownRefDocType: null,
    stockRefDocType: null,
    column: "fulfillment",
    statusCodes: SHIPMENT_STATUS,
  },
  goodsReceipt: {
    key: "goodsReceipt",
    slug: "receipts", // ⚠️ 상세 라우트는 /receipts, 테이블은 goods_receipts
    table: "goods_receipts",
    label: "입고",
    orderType: null,
    ownRefDocType: "purchase_order", // goods_receipts.ref_doc_id → purchase_orders
    stockRefDocType: "goods_receipt", // stock_movements.ref_doc_type
    column: "fulfillment",
    statusCodes: GR_STATUS,
  },
  delivery: {
    key: "delivery",
    slug: "deliveries",
    table: "deliveries",
    label: "출고",
    orderType: null,
    ownRefDocType: "sales_order", // deliveries.ref_doc_id → sales_orders
    stockRefDocType: "delivery", // stock_movements.ref_doc_type
    column: "fulfillment",
    statusCodes: DELIVERY_STATUS,
  },
  tradeDocument: {
    key: "tradeDocument",
    slug: "documents", // ⚠️ 상세 라우트는 /documents, 테이블은 trade_documents
    table: "trade_documents",
    label: "무역서류",
    orderType: null,
    ownRefDocType: null,
    stockRefDocType: null,
    column: "terminal",
    statusCodes: TRADE_DOC_STATUS,
  },
  customsDeclaration: {
    key: "customsDeclaration",
    slug: "customs",
    table: "customs_declarations",
    label: "통관신고",
    orderType: null,
    ownRefDocType: null,
    stockRefDocType: null,
    column: "terminal",
    statusCodes: CUSTOMS_DECL_STATUS,
  },
};

const BY_SLUG: Record<string, DocTypeKey> = Object.fromEntries(
  (Object.values(DOC_TYPES) as DocTypeDef[]).map((d) => [d.slug, d.key]),
);

/** /flow/[slug] 의 slug → 전표타입. 미지 slug 은 null(화면이 '찾을 수 없음' 처리). */
export function docTypeBySlug(slug: string): DocTypeDef | null {
  const key = BY_SLUG[slug];
  return key ? DOC_TYPES[key] : null;
}

/** 상세 페이지 href — 실제 앱 라우트 세그먼트(테이블명과 다를 수 있음). */
export function detailHref(type: DocTypeKey, id: string): string {
  return `/${DOC_TYPES[type].slug}/${id}`;
}

/** 흐름뷰 href — 9개 전표 상세의 진입 링크가 이걸 쓴다(P5.1: 통관신고 포함). */
export function flowHref(type: DocTypeKey, id: string): string {
  return `/flow/${DOC_TYPES[type].slug}/${id}`;
}

/** order_type('SO'/'PO') → 주문 전표타입. 미지 값은 null(엣지 미기여). */
export function orderTypeToDocKey(orderType: string | null): DocTypeKey | null {
  if (orderType === "SO") return "salesOrder";
  if (orderType === "PO") return "purchaseOrder";
  return null;
}

/** stock_movements.ref_doc_type 실값 → 소비 전표타입(원장 리프가 매달릴 곳). */
export function docKeyByStockRefDocType(v: string | null): DocTypeKey | null {
  if (v === "delivery") return "delivery";
  if (v === "goods_receipt") return "goodsReceipt";
  return null;
}

/** 상태 배지 — 저장값(소문자) 기준. 라벨은 codes.ts, variant 는 공통 매핑. */
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  // 종결·긍정
  completed: "green",
  approved: "green",
  won: "green",
  issued: "green",
  arrived: "green",
  shipped: "green",
  accepted: "green", // 통관 수리(P5.1)
  // 취소·부정
  cancelled: "red",
  rejected: "red",
  expired: "red",
  lost: "red",
  // 진행·기계전용
  partial: "amber",
  sent: "amber",
  booked: "amber",
  quoted: "amber",
  reviewing: "amber",
  negotiating: "amber",
  confirmed: "blue",
  normal: "blue",
  filed: "blue", // 통관 신고(P5.1)
  // 초안
  draft: "zinc",
  received: "zinc",
};

export function statusBadge(
  type: DocTypeKey,
  status: string | null,
): { label: string; variant: BadgeVariant } {
  const code = status ?? "";
  return {
    label: labelOf(DOC_TYPES[type].statusCodes, code),
    variant: STATUS_VARIANT[code] ?? "zinc",
  };
}

/** 취소로 흐림 처리할지(스펙 §5 — 취소 전표는 항상 표시 + 흐림·취소 배지). */
export function isCancelledStatus(status: string | null): boolean {
  return status === "cancelled";
}

/* ============================================================================
 * 2) DAG 조립
 * ========================================================================== */

/** 원자료 노드 모양 — docChain.ts 가 물리 행에서 만들어 넘긴다. */
export interface RawDoc {
  id: string;
  docNumber: string | null; // 문의·원장은 번호 없음
  date: string | null;
  status: string | null;
}
export interface RawQuotation extends RawDoc {
  inquiryId: string | null;
}
export interface RawSalesOrder extends RawDoc {
  refQuotationId: string | null;
}
export interface RawPurchaseOrder extends RawDoc {
  refSalesOrderId: string | null;
}
export interface RawConsumptionDoc extends RawDoc {
  /** ref_doc_id — 출고면 SO id, 입고면 PO id. */
  refDocId: string;
}
export interface RawTradeDocument extends RawDoc {
  shipmentId: string;
  /** trade_document_lines.order_line_id → so_lines.so_id distinct 집계(엣지 아님·메타). */
  soNumbers: string[];
}
export interface RawCustomsDeclaration extends RawDoc {
  /** shipment_id — hard FK 앵커(값조인 아님). 한 선적에 수출+수입 0~N건 공존. */
  shipmentId: string;
}
export interface RawShipmentOrder {
  shipmentId: string;
  orderType: string | null; // 'SO'|'PO'|null(판별자 부재 → 엣지 미기여)
  orderId: string | null;
}
export interface RawLedgerRow {
  refDocType: string | null; // 'delivery'|'goods_receipt'|null
  refDocId: string | null;
  movementType: string; // REVERSAL 이면 역분개 집계 대상
}

/** 주문 키 — 폴리모픽 SO/PO 를 문자열로 통일(경계·초점 판정 키). */
export type OrderKey = string; // `${DocTypeKey}:${id}`  (salesOrder:.. | purchaseOrder:..)

export function orderKey(type: DocTypeKey, id: string): OrderKey {
  return `${type}:${id}`;
}

export interface ChainInput {
  focus: { type: DocTypeKey; id: string };
  /** 1차 주문 집합(docChain 이 순회 규칙으로 계산) — 이 밖의 주문은 경계 노드. */
  primaryOrders: OrderKey[];
  inquiries: RawDoc[];
  quotations: RawQuotation[];
  salesOrders: RawSalesOrder[];
  purchaseOrders: RawPurchaseOrder[];
  shipments: RawDoc[];
  shipmentOrders: RawShipmentOrder[];
  deliveries: RawConsumptionDoc[];
  goodsReceipts: RawConsumptionDoc[];
  tradeDocuments: RawTradeDocument[];
  customsDeclarations: RawCustomsDeclaration[];
  ledger: RawLedgerRow[];
}

export type EdgeKind =
  | "inquiry-quotation" // ①
  | "quotation-so" // ②
  | "so-po" // ③
  | "so-delivery" // ④
  | "po-receipt" // ⑤
  | "order-shipment" // ⑥
  | "shipment-tradedoc" // ⑦
  | "delivery-ledger" // ⑧
  | "receipt-ledger" // ⑨
  | "shipment-customs"; // ⑩ (P5.1 — 선적→통관신고, shipment_id hard FK)

export interface ChainNode {
  key: string; // 유일 키
  type: DocTypeKey | "ledger";
  id: string; // 원장 리프는 소비 전표 id
  docNumber: string | null;
  date: string | null;
  status: string | null;
  label: string; // 전표타입 라벨(문의/견적/…/원장)
  column: ColumnGroup;
  focus: boolean; // 진입 전표
  boundary: boolean; // 경계 노드(미확장 — 번호·상태·흐름링크만)
  stub: boolean; // 유실된 상류(삭제됨) 스텁
  meta?: {
    ledgerCount?: number; // 원장 리프: 총 원장 행수
    reversalCount?: number; // 원장 리프: 역분개 행수
    soNumbers?: string[]; // 무역서류: mono-SO 근거 번호
    lostReason?: string; // 스텁 사유
  };
}

export interface ChainEdge {
  from: string; // 상류(왼쪽) 노드 키
  to: string; // 하류(오른쪽) 노드 키
  kind: EdgeKind;
}

export interface AssembledChain {
  focusKey: string;
  nodes: ChainNode[];
  edges: ChainEdge[];
  /** 컬럼 그룹별 노드(렌더 편의) — COLUMN_ORDER 순. */
  columns: { group: ColumnGroup; label: string; nodes: ChainNode[] }[];
}

function nodeKey(type: DocTypeKey, id: string): string {
  return `${type}:${id}`;
}
function ledgerKey(consumerType: DocTypeKey, id: string): string {
  return `ledger:${consumerType}:${id}`;
}

/**
 * shipment_orders 폴리모픽 엣지 — order_type/order_id 가 null 인 행은
 * **조용히 통과**(엣지 미기여·크래시 금지, 스펙 §3⑥). SO/PO 는 order_type 로 분기.
 */
export function shipmentOrderEdges(
  rows: RawShipmentOrder[],
): { orderType: DocTypeKey; orderId: string; shipmentId: string }[] {
  const out: { orderType: DocTypeKey; orderId: string; shipmentId: string }[] =
    [];
  for (const r of rows) {
    const t = orderTypeToDocKey(r.orderType);
    if (!t || !r.orderId) continue; // null 판별자·null id → 미기여
    out.push({ orderType: t, orderId: r.orderId, shipmentId: r.shipmentId });
  }
  return out;
}

/**
 * 원장 리프 집계 — 소비 전표(출고/입고)별 "원장 N행 · 역분개 M행"(스펙 §5).
 * REVERSAL 포함. 행별 나열 없음. ref_doc_type 실값으로 소비 전표타입을 판별.
 */
export function ledgerLeaves(
  rows: RawLedgerRow[],
): Map<string, { consumerType: DocTypeKey; consumerId: string; count: number; reversalCount: number }> {
  const acc = new Map<
    string,
    { consumerType: DocTypeKey; consumerId: string; count: number; reversalCount: number }
  >();
  for (const r of rows) {
    const t = docKeyByStockRefDocType(r.refDocType);
    if (!t || !r.refDocId) continue; // 수동 조정(INIT/ADJ)·미연결 원장 → 리프 없음
    const k = ledgerKey(t, r.refDocId);
    const cur =
      acc.get(k) ?? { consumerType: t, consumerId: r.refDocId, count: 0, reversalCount: 0 };
    cur.count += 1;
    if (r.movementType === "REVERSAL") cur.reversalCount += 1;
    acc.set(k, cur);
  }
  return acc;
}

/**
 * DAG 조립 — 순수. 엣지는 canonical 10종만(그 외 금지). 미해석 헤더 포인터는
 * 스텁 노드, 경계 주문은 미확장 표시, 원장은 집계 리프.
 */
export function assembleChain(input: ChainInput): AssembledChain {
  const focusKey = nodeKey(input.focus.type, input.focus.id);
  const primary = new Set(input.primaryOrders);
  const nodes = new Map<string, ChainNode>();
  const edges: ChainEdge[] = [];

  const baseNode = (
    type: DocTypeKey,
    d: RawDoc,
    opts?: { boundary?: boolean },
  ): ChainNode => {
    const key = nodeKey(type, d.id);
    return {
      key,
      type,
      id: d.id,
      docNumber: d.docNumber,
      date: d.date,
      status: d.status,
      label: DOC_TYPES[type].label,
      column: DOC_TYPES[type].column,
      focus: key === focusKey,
      boundary: opts?.boundary ?? false,
      stub: false,
    };
  };

  const addNode = (n: ChainNode) => {
    // 이미 있으면(경계로 먼저 들어온 뒤 실노드로) 실노드가 이긴다.
    const prev = nodes.get(n.key);
    if (!prev || (prev.boundary && !n.boundary)) nodes.set(n.key, n);
  };

  // ── 실노드 등록 ────────────────────────────────────────────────────────
  for (const d of input.inquiries) addNode(baseNode("inquiry", d));
  for (const d of input.quotations) addNode(baseNode("quotation", d));
  for (const d of input.salesOrders)
    addNode(baseNode("salesOrder", d, { boundary: !primary.has(orderKey("salesOrder", d.id)) }));
  for (const d of input.purchaseOrders)
    addNode(baseNode("purchaseOrder", d, { boundary: !primary.has(orderKey("purchaseOrder", d.id)) }));
  for (const d of input.shipments) addNode(baseNode("shipment", d));
  for (const d of input.deliveries) addNode(baseNode("delivery", d));
  for (const d of input.goodsReceipts) addNode(baseNode("goodsReceipt", d));
  for (const d of input.tradeDocuments) {
    const n = baseNode("tradeDocument", d);
    n.meta = { soNumbers: d.soNumbers };
    addNode(n);
  }
  for (const d of input.customsDeclarations) addNode(baseNode("customsDeclaration", d));

  // ── 스텁 헬퍼: 헤더 포인터 대상이 없으면 "유실된 상류(삭제됨)" ────────────
  const ensureParent = (type: DocTypeKey, id: string): string => {
    const key = nodeKey(type, id);
    if (!nodes.has(key)) {
      nodes.set(key, {
        key,
        type,
        id,
        docNumber: null,
        date: null,
        status: null,
        label: DOC_TYPES[type].label,
        column: DOC_TYPES[type].column,
        focus: key === focusKey,
        boundary: false,
        stub: true,
        meta: { lostReason: "유실된 상류(삭제됨)" },
      });
    }
    return key;
  };

  const addEdge = (from: string, to: string, kind: EdgeKind) => {
    if (edges.some((e) => e.from === from && e.to === to && e.kind === kind)) return;
    edges.push({ from, to, kind });
  };

  // ① inquiry → quotation
  for (const q of input.quotations) {
    if (!q.inquiryId) continue;
    addEdge(ensureParent("inquiry", q.inquiryId), nodeKey("quotation", q.id), "inquiry-quotation");
  }
  // ② quotation → sales_order (경계 SO 는 상류 미확장 — 스텁 생성 방지)
  for (const so of input.salesOrders) {
    if (!so.refQuotationId) continue;
    if (!primary.has(orderKey("salesOrder", so.id))) continue;
    addEdge(ensureParent("quotation", so.refQuotationId), nodeKey("salesOrder", so.id), "quotation-so");
  }
  // ③ sales_order → purchase_order (경계 PO 는 상류 미확장)
  for (const po of input.purchaseOrders) {
    if (!po.refSalesOrderId) continue;
    if (!primary.has(orderKey("purchaseOrder", po.id))) continue;
    addEdge(ensureParent("salesOrder", po.refSalesOrderId), nodeKey("purchaseOrder", po.id), "so-po");
  }
  // ④ sales_order → delivery
  for (const dlv of input.deliveries) {
    addEdge(ensureParent("salesOrder", dlv.refDocId), nodeKey("delivery", dlv.id), "so-delivery");
  }
  // ⑤ purchase_order → goods_receipt
  for (const gr of input.goodsReceipts) {
    addEdge(ensureParent("purchaseOrder", gr.refDocId), nodeKey("goodsReceipt", gr.id), "po-receipt");
  }
  // ⑥ order(SO|PO) → shipment (폴리모픽 · null 판별자 통과)
  for (const so of shipmentOrderEdges(input.shipmentOrders)) {
    // 선적 노드가 조립 대상에 있을 때만 엣지(선적 미포함이면 조용히 통과).
    if (!nodes.has(nodeKey("shipment", so.shipmentId))) continue;
    addEdge(ensureParent(so.orderType, so.orderId), nodeKey("shipment", so.shipmentId), "order-shipment");
  }
  // ⑦ shipment → trade_document
  for (const td of input.tradeDocuments) {
    addEdge(ensureParent("shipment", td.shipmentId), nodeKey("tradeDocument", td.id), "shipment-tradedoc");
  }
  // ⑩ shipment → customs_declaration (P5.1 — 엣지 ⑦ 동형, shipment_id hard FK)
  for (const cd of input.customsDeclarations) {
    addEdge(ensureParent("shipment", cd.shipmentId), nodeKey("customsDeclaration", cd.id), "shipment-customs");
  }
  // ⑧⑨ delivery/goods_receipt → 원장 리프 (집계)
  const leaves = ledgerLeaves(input.ledger);
  for (const [k, leaf] of leaves) {
    const consumerNodeKey = nodeKey(leaf.consumerType, leaf.consumerId);
    if (!nodes.has(consumerNodeKey)) continue; // 소비 전표가 사슬에 없으면 리프 생략
    nodes.set(k, {
      key: k,
      type: "ledger",
      id: leaf.consumerId,
      docNumber: null,
      date: null,
      status: null,
      label: "재고 원장",
      column: "terminal",
      focus: false,
      boundary: false,
      stub: false,
      meta: { ledgerCount: leaf.count, reversalCount: leaf.reversalCount },
    });
    addEdge(
      consumerNodeKey,
      k,
      leaf.consumerType === "delivery" ? "delivery-ledger" : "receipt-ledger",
    );
  }

  // ── 컬럼 그룹핑 ──────────────────────────────────────────────────────────
  const all = Array.from(nodes.values());
  const columns = COLUMN_ORDER.map((group) => ({
    group,
    label: COLUMN_LABEL[group],
    nodes: all.filter((n) => n.column === group),
  }));

  return { focusKey, nodes: all, edges, columns };
}

/* ============================================================================
 * 3) 초점 라인 표 — stale 처리(스펙 §6). 잔량 산식은 docFlow/뷰가 담당하고,
 *    여기서는 상류 포인터 해석(연결 끊김 판정)만 순수하게 한다.
 * ========================================================================== */

/**
 * 라인 소프트 포인터 해석 — 대상 id 가 현재 존재 집합에 없으면 "연결 끊김".
 * 라이브 stale 6건(취소 전표의 delivery_lines.so_line_id·gr_lines.po_line_id)이
 * 여기로 떨어진다 — 크래시 없이 스냅샷명으로 식별하게 한다.
 */
export interface LineOriginInput {
  /** 하류 라인이 가리키는 상류 라인 id(so_line_id / po_line_id / order_line_id / ref_quotation_line_id). */
  pointerId: string | null;
  /** 하류 라인의 스냅샷 품목명(포인터 유실 시 내용 식별용). */
  snapshotName: string | null;
}
export interface LineOrigin {
  status: "ok" | "broken" | "none";
  /** ok 일 때 상류 라인 표시(전표번호·라인). */
  label: string | null;
  /** broken 일 때 스냅샷명. */
  snapshotName: string | null;
}

export function resolveLineOrigin(
  input: LineOriginInput,
  present: ReadonlySet<string>,
  labelFor: (pointerId: string) => string | null,
): LineOrigin {
  if (!input.pointerId) return { status: "none", label: null, snapshotName: input.snapshotName };
  if (!present.has(input.pointerId)) {
    return { status: "broken", label: null, snapshotName: input.snapshotName };
  }
  return { status: "ok", label: labelFor(input.pointerId), snapshotName: input.snapshotName };
}
