import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  assembleChain,
  orderKey,
  resolveLineOrigin,
  DOC_TYPES,
  type AssembledChain,
  type ChainInput,
  type DocTypeKey,
  type LineOrigin,
  type RawConsumptionDoc,
  type RawDoc,
  type RawLedgerRow,
  type RawPurchaseOrder,
  type RawQuotation,
  type RawSalesOrder,
  type RawShipmentOrder,
  type RawTradeDocument,
} from "./chainLogic";

/**
 * 문서 흐름 추적 — 조회 서비스 (P4.6, 조회 전용). **쓰기 0.**
 *
 * 홉별 배치(IN) 조회로 SO-허브 DAG 를 모아 chainLogic.assembleChain 으로 조립한다.
 * 노드별 개별 루프(N+1) 금지 — 각 홉은 한 번의 IN 쿼리.
 *
 * 순수 조립·판별자·stale 판정은 전부 chainLogic(테스트 완료). 이 파일은 I/O 만.
 *
 * ⚠️ 읽기 전용 계약: DocChainRepo 인터페이스에는 조회 메서드만 있다(rpc·insert·
 *    update·delete 없음). 실제 구현도 supabase `.from().select()` 만 쓴다.
 */

/* ============================================================================
 * 조회 레포 인터페이스 (읽기 전용) — 테스트는 인메모리 페이크로 주입한다.
 * ========================================================================== */

export interface DocChainRepo {
  // 헤더(초점 시드) — 포인터 포함
  inquiriesByIds(ids: string[]): Promise<RawDoc[]>;
  quotationsByIds(ids: string[]): Promise<RawQuotation[]>;
  quotationsByInquiryIds(ids: string[]): Promise<RawQuotation[]>;
  salesOrdersByIds(ids: string[]): Promise<RawSalesOrder[]>;
  salesOrdersByQuotationIds(ids: string[]): Promise<RawSalesOrder[]>;
  purchaseOrdersByIds(ids: string[]): Promise<RawPurchaseOrder[]>;
  purchaseOrdersBySalesOrderIds(ids: string[]): Promise<RawPurchaseOrder[]>;
  shipmentsByIds(ids: string[]): Promise<RawDoc[]>;
  deliveriesByIds(ids: string[]): Promise<RawConsumptionDoc[]>;
  deliveriesBySalesOrderIds(ids: string[]): Promise<RawConsumptionDoc[]>;
  goodsReceiptsByIds(ids: string[]): Promise<RawConsumptionDoc[]>;
  goodsReceiptsByPurchaseOrderIds(ids: string[]): Promise<RawConsumptionDoc[]>;
  tradeDocumentsByIds(ids: string[]): Promise<RawTradeDocHead[]>;
  tradeDocumentsByShipmentIds(ids: string[]): Promise<RawTradeDocHead[]>;

  // 연결·라인
  shipmentOrdersByOrderIds(soIds: string[], poIds: string[]): Promise<RawShipmentOrder[]>;
  shipmentOrdersByShipmentIds(ids: string[]): Promise<RawShipmentOrder[]>;
  ledgerByConsumers(deliveryIds: string[], grIds: string[]): Promise<RawLedgerRow[]>;
  tradeDocLinesByDocIds(ids: string[]): Promise<{ documentId: string; orderLineId: string | null }[]>;
  soLinesByIds(ids: string[]): Promise<{ id: string; soId: string }[]>;

  // 초점 라인 표
  soOpenQty(soId: string): Promise<OpenLine[]>;
  poOpenQty(poId: string): Promise<OpenLine[]>;
  shipmentLineTotals(rows: { orderType: "SO" | "PO"; orderLineId: string }[]): Promise<Map<string, number>>;
  quotationItemsByQuotationId(qid: string): Promise<LineRow[]>;
  quotationItemsByIds(ids: string[]): Promise<LineRow[]>; // 원천(견적) 라인 존재·라벨
  soLinesByIdsForOrigin(ids: string[]): Promise<LineRow[]>; // 원천(수주) 라인 존재·라벨
  poLinesByIdsForOrigin(ids: string[]): Promise<LineRow[]>; // 원천(발주) 라인 존재·라벨
  soLinesByRefQuotationLineIds(ids: string[]): Promise<DerivedLineRow[]>;
  deliveryLinesByDeliveryId(id: string): Promise<ConsumeLineRow[]>;
  grLinesByGrId(id: string): Promise<ConsumeLineRow[]>;
  shipmentLinesByShipmentId(id: string): Promise<ShipmentLineRow[]>;
  tradeDocLinesFull(docId: string): Promise<TradeDocLineRow[]>;
}

export interface RawTradeDocHead extends RawDoc {
  shipmentId: string;
}
export interface OpenLine {
  lineId: string;
  productName: string | null;
  unit: string | null;
  orderedQty: number;
  consumedQty: number; // so_open_qty.shipped_qty(=출고) / po_open_qty.received_qty(=입고)
  openQty: number;
  refPointerId: string | null; // ref_quotation_line_id / ref_so_line_id
}
export interface LineRow {
  id: string;
  docNumber: string | null; // 소속 전표 번호(라벨용)
  lineNo: number;
  productName: string | null;
}
export interface DerivedLineRow {
  refPointerId: string; // 원천 라인 id (역조회 키)
  soId: string;
  soNumber: string | null;
  lineNo: number;
  productName: string | null;
}
export interface ConsumeLineRow {
  lineNo: number;
  pointerId: string | null; // so_line_id / po_line_id
  itemName: string | null;
  qty: number;
  uom: string | null;
}
export interface ShipmentLineRow {
  lineNo: number;
  orderType: "SO" | "PO";
  orderLineId: string | null;
  itemName: string | null;
  qty: number;
  uom: string | null;
}
export interface TradeDocLineRow {
  lineNo: number;
  orderLineId: string | null;
  shipmentLineId: string | null;
  productName: string | null;
  qty: number;
  uom: string | null;
}

/* ============================================================================
 * 결과 타입
 * ========================================================================== */

export interface FocusLineRow {
  lineNo: number;
  itemName: string;
  qty: number;
  uom: string | null;
  origin: LineOrigin;
  ordered: number | null;
  consumed: number | null; // 출고/입고 집계
  shipped: number | null; // 선적 집계(shipment_line_totals)
  open: number | null;
  derived: { label: string; href: string }[] | null; // 견적 초점: 파생 수주라인
}
export interface FocusLineTable {
  kind: DocTypeKey;
  showConsumption: boolean; // SO/PO 만 잔량·소비 열
  originLabel: string;
  rows: FocusLineRow[];
  note: string | null;
}
export interface DocChainResult {
  found: boolean;
  focus: { type: DocTypeKey; id: string; docNumber: string | null } | null;
  chain: AssembledChain | null;
  focusLines: FocusLineTable | null;
}

/* ============================================================================
 * 순회 + 조립 (repo 주입 — 테스트 가능)
 * ========================================================================== */

const uniq = (xs: (string | null | undefined)[]): string[] =>
  Array.from(new Set(xs.filter((x): x is string => !!x)));

export async function buildDocChain(
  focus: { type: DocTypeKey; id: string },
  repo: DocChainRepo,
): Promise<DocChainResult> {
  // ── 시드: 초점 헤더 존재 확인 + 1차 주문 id 산출 ───────────────────────────
  const seed = await seedOrders(focus, repo);
  if (!seed.found) {
    return { found: false, focus: null, chain: null, focusLines: null };
  }

  // ── 1차 주문 트리(so-po 로만 확장) = primary ───────────────────────────────
  let primarySo = new Set(seed.soIds);
  let primaryPo = new Set(seed.poIds);
  // SO → 파생 PO
  const childPos = await repo.purchaseOrdersBySalesOrderIds([...primarySo]);
  for (const po of childPos) primaryPo.add(po.id);
  // PO → 부모 SO (back-to-back 상류)
  const parentSoIds = uniq(
    (await repo.purchaseOrdersByIds([...primaryPo])).map((p) => p.refSalesOrderId),
  );
  const parentSos = await repo.salesOrdersByIds(parentSoIds);
  for (const so of parentSos) primarySo.add(so.id);
  // 부모 SO 의 파생 PO 도 한 번 더(형제 발주 표시)
  const parentChildPos = await repo.purchaseOrdersBySalesOrderIds([...primarySo]);
  for (const po of parentChildPos) primaryPo.add(po.id);

  // ── 주문 헤더(primary) ─────────────────────────────────────────────────────
  const salesOrders = await repo.salesOrdersByIds([...primarySo]);
  const purchaseOrders = await repo.purchaseOrdersByIds([...primaryPo]);

  // ── 상류: 견적 → 문의 ──────────────────────────────────────────────────────
  const quotationIds = uniq(salesOrders.map((s) => s.refQuotationId));
  const quotations = await repo.quotationsByIds(quotationIds);
  const inquiryIds = uniq(quotations.map((q) => q.inquiryId));
  const inquiries = await repo.inquiriesByIds(inquiryIds);

  // ── 하류: 출고·입고 → 원장 ─────────────────────────────────────────────────
  const deliveries = await repo.deliveriesBySalesOrderIds([...primarySo]);
  const goodsReceipts = await repo.goodsReceiptsByPurchaseOrderIds([...primaryPo]);
  const ledger = await repo.ledgerByConsumers(
    deliveries.map((d) => d.id),
    goodsReceipts.map((g) => g.id),
  );

  // ── 선적(M:N) → 무역서류 + 경계 주문 발견 ──────────────────────────────────
  const shipOrderLinks = await repo.shipmentOrdersByOrderIds([...primarySo], [...primaryPo]);
  const shipmentIds = uniq(shipOrderLinks.map((l) => l.shipmentId));
  const shipments = await repo.shipmentsByIds(shipmentIds);
  const allShipOrders = await repo.shipmentOrdersByShipmentIds(shipmentIds); // 경계 포함 전 링크
  const tradeDocs = await repo.tradeDocumentsByShipmentIds(shipmentIds);

  // 경계 주문 헤더(미확장 — 번호·상태만, 포인터는 null 로 잘라 상류 확장 차단)
  const boundarySoIds = uniq(
    allShipOrders.filter((l) => l.orderType === "SO" && l.orderId && !primarySo.has(l.orderId)).map((l) => l.orderId),
  );
  const boundaryPoIds = uniq(
    allShipOrders.filter((l) => l.orderType === "PO" && l.orderId && !primaryPo.has(l.orderId)).map((l) => l.orderId),
  );
  const boundarySos = (await repo.salesOrdersByIds(boundarySoIds)).map((s) => ({ ...s, refQuotationId: null }));
  const boundaryPos = (await repo.purchaseOrdersByIds(boundaryPoIds)).map((p) => ({ ...p, refSalesOrderId: null }));

  // 무역서류 mono-SO 메타(라인 order_line_id → so_lines.so_id → so_number distinct)
  const soNumbersByDoc = await monoSoNumbers(tradeDocs, repo, salesOrders, boundarySos);
  const tradeDocuments: RawTradeDocument[] = tradeDocs.map((td) => ({
    id: td.id,
    docNumber: td.docNumber,
    date: td.date,
    status: td.status,
    shipmentId: td.shipmentId,
    soNumbers: soNumbersByDoc.get(td.id) ?? [],
  }));

  const primaryOrders = [
    ...[...primarySo].map((id) => orderKey("salesOrder", id)),
    ...[...primaryPo].map((id) => orderKey("purchaseOrder", id)),
  ];

  const input: ChainInput = {
    focus,
    primaryOrders,
    inquiries,
    quotations,
    salesOrders: [...salesOrders, ...boundarySos],
    purchaseOrders: [...purchaseOrders, ...boundaryPos],
    shipments,
    shipmentOrders: allShipOrders,
    deliveries,
    goodsReceipts,
    tradeDocuments,
    ledger,
  };
  const chain = assembleChain(input);
  const focusNode = chain.nodes.find((n) => n.key === chain.focusKey) ?? null;
  const focusLines = await buildFocusLines(focus, repo);

  return {
    found: true,
    focus: { type: focus.type, id: focus.id, docNumber: focusNode?.docNumber ?? null },
    chain,
    focusLines,
  };
}

/** 초점 유형별 1차 주문 id 산출(스펙 §4). 초점 헤더 부재면 found=false. */
async function seedOrders(
  focus: { type: DocTypeKey; id: string },
  repo: DocChainRepo,
): Promise<{ found: boolean; soIds: string[]; poIds: string[] }> {
  switch (focus.type) {
    case "salesOrder": {
      const rows = await repo.salesOrdersByIds([focus.id]);
      return { found: rows.length > 0, soIds: [focus.id], poIds: [] };
    }
    case "purchaseOrder": {
      const rows = await repo.purchaseOrdersByIds([focus.id]);
      if (rows.length === 0) return { found: false, soIds: [], poIds: [] };
      return { found: true, soIds: uniq([rows[0].refSalesOrderId]), poIds: [focus.id] };
    }
    case "delivery": {
      const rows = await repo.deliveriesByIds([focus.id]);
      if (rows.length === 0) return { found: false, soIds: [], poIds: [] };
      return { found: true, soIds: [rows[0].refDocId], poIds: [] };
    }
    case "goodsReceipt": {
      const rows = await repo.goodsReceiptsByIds([focus.id]);
      if (rows.length === 0) return { found: false, soIds: [], poIds: [] };
      return { found: true, soIds: [], poIds: [rows[0].refDocId] };
    }
    case "quotation": {
      const q = await repo.quotationsByIds([focus.id]);
      if (q.length === 0) return { found: false, soIds: [], poIds: [] };
      const sos = await repo.salesOrdersByQuotationIds([focus.id]);
      return { found: true, soIds: sos.map((s) => s.id), poIds: [] };
    }
    case "inquiry": {
      const inq = await repo.inquiriesByIds([focus.id]);
      if (inq.length === 0) return { found: false, soIds: [], poIds: [] };
      const qs = await repo.quotationsByInquiryIds([focus.id]);
      const sos = await repo.salesOrdersByQuotationIds(qs.map((q) => q.id));
      return { found: true, soIds: sos.map((s) => s.id), poIds: [] };
    }
    case "shipment": {
      const sh = await repo.shipmentsByIds([focus.id]);
      if (sh.length === 0) return { found: false, soIds: [], poIds: [] };
      const links = await repo.shipmentOrdersByShipmentIds([focus.id]);
      return {
        found: true,
        soIds: uniq(links.filter((l) => l.orderType === "SO").map((l) => l.orderId)),
        poIds: uniq(links.filter((l) => l.orderType === "PO").map((l) => l.orderId)),
      };
    }
    case "tradeDocument": {
      const td = await repo.tradeDocumentsByIds([focus.id]);
      if (td.length === 0) return { found: false, soIds: [], poIds: [] };
      const lines = await repo.tradeDocLinesByDocIds([focus.id]);
      const soLines = await repo.soLinesByIds(uniq(lines.map((l) => l.orderLineId)));
      return { found: true, soIds: uniq(soLines.map((l) => l.soId)), poIds: [] };
    }
  }
}

/** 무역서류별 근거 SO 번호(distinct) — order_line_id → so_lines.so_id → so_number. */
async function monoSoNumbers(
  tradeDocs: RawTradeDocHead[],
  repo: DocChainRepo,
  ...knownSoLists: RawSalesOrder[][]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (tradeDocs.length === 0) return out;
  const docLines = await repo.tradeDocLinesByDocIds(tradeDocs.map((d) => d.id));
  const orderLineIds = uniq(docLines.map((l) => l.orderLineId));
  const soLines = await repo.soLinesByIds(orderLineIds);
  const soIdByLine = new Map(soLines.map((l) => [l.id, l.soId]));
  // so_number: 이미 조회한 주문 목록에서 우선, 없으면 추가 조회
  const soNumberById = new Map<string, string | null>();
  for (const list of knownSoLists) for (const s of list) soNumberById.set(s.id, s.docNumber);
  const missing = uniq([...soIdByLine.values()].filter((id) => !soNumberById.has(id)));
  if (missing.length > 0) {
    for (const s of await repo.salesOrdersByIds(missing)) soNumberById.set(s.id, s.docNumber);
  }
  const byDoc = new Map<string, Set<string>>();
  for (const dl of docLines) {
    if (!dl.orderLineId) continue;
    const soId = soIdByLine.get(dl.orderLineId);
    if (!soId) continue;
    const num = soNumberById.get(soId);
    if (!num) continue;
    (byDoc.get(dl.documentId) ?? byDoc.set(dl.documentId, new Set()).get(dl.documentId)!).add(num);
  }
  for (const [docId, set] of byDoc) out.set(docId, [...set]);
  return out;
}

/* ---------- 초점 라인 표 (스펙 §6) ---------- */

async function buildFocusLines(
  focus: { type: DocTypeKey; id: string },
  repo: DocChainRepo,
): Promise<FocusLineTable | null> {
  switch (focus.type) {
    case "inquiry":
      return { kind: "inquiry", showConsumption: false, originLabel: "", rows: [], note: "문의는 라인이 없습니다." };

    case "quotation": {
      const items = await repo.quotationItemsByQuotationId(focus.id);
      const derived = await repo.soLinesByRefQuotationLineIds(items.map((i) => i.id));
      const byPointer = new Map<string, DerivedLineRow[]>();
      for (const d of derived) {
        (byPointer.get(d.refPointerId) ?? byPointer.set(d.refPointerId, []).get(d.refPointerId)!).push(d);
      }
      const rows: FocusLineRow[] = items.map((it) => ({
        lineNo: it.lineNo,
        itemName: it.productName ?? "(품목명 없음)",
        qty: 0,
        uom: null,
        origin: { status: "none", label: null, snapshotName: null },
        ordered: null,
        consumed: null,
        shipped: null,
        open: null,
        derived: (byPointer.get(it.id) ?? []).map((d) => ({
          label: `${d.soNumber ?? "수주"} · 라인 ${d.lineNo}`,
          href: `/sales-orders/${d.soId}`,
        })),
      }));
      return { kind: "quotation", showConsumption: false, originLabel: "파생 수주 라인", rows, note: null };
    }

    case "salesOrder":
    case "purchaseOrder": {
      const isSo = focus.type === "salesOrder";
      const open = isSo ? await repo.soOpenQty(focus.id) : await repo.poOpenQty(focus.id);
      // 선적 집계(shipment_line_totals) — 같은 주문 라인의 선적 소비
      const totals = await repo.shipmentLineTotals(
        open.map((o) => ({ orderType: isSo ? ("SO" as const) : ("PO" as const), orderLineId: o.lineId })),
      );
      // 원천 라인(견적라인/수주라인) 존재 집합 + 라벨
      const originIds = uniq(open.map((o) => o.refPointerId));
      const originRows = isSo
        ? await repo.quotationItemsByIds(originIds)
        : await repo.soLinesByIdsForOrigin(originIds);
      const present = new Set(originRows.map((r) => r.id));
      const labelById = new Map(originRows.map((r) => [r.id, `${r.docNumber ?? (isSo ? "견적" : "수주")} · 라인 ${r.lineNo}`]));
      const rows: FocusLineRow[] = open.map((o, i) => ({
        lineNo: i + 1,
        itemName: o.productName ?? "(품목명 없음)",
        qty: o.orderedQty,
        uom: o.unit,
        origin: resolveLineOrigin(
          { pointerId: o.refPointerId, snapshotName: o.productName },
          present,
          (id) => labelById.get(id) ?? null,
        ),
        ordered: o.orderedQty,
        consumed: o.consumedQty,
        shipped: totals.get(o.lineId) ?? 0,
        open: o.openQty,
        derived: null,
      }));
      return {
        kind: focus.type,
        showConsumption: true,
        originLabel: isSo ? "출처 견적 라인" : "출처 수주 라인",
        rows,
        note: null,
      };
    }

    case "delivery":
    case "goodsReceipt": {
      const isDlv = focus.type === "delivery";
      const lines = isDlv ? await repo.deliveryLinesByDeliveryId(focus.id) : await repo.grLinesByGrId(focus.id);
      // 원천 주문 라인 존재 집합(so_lines / po_lines) — 라이브 stale 6건이 여기서 broken 으로 표면화
      const parentLineIds = uniq(lines.map((l) => l.pointerId));
      const parentRows = isDlv
        ? await repo.soLinesByIdsForOrigin(parentLineIds)
        : await repo.poLinesByIdsForOrigin(parentLineIds);
      const present = new Set(parentRows.map((r) => r.id));
      const labelById = new Map(parentRows.map((r) => [r.id, `${r.docNumber ?? (isDlv ? "수주" : "발주")} · 라인 ${r.lineNo}`]));
      const rows: FocusLineRow[] = lines.map((l) => ({
        lineNo: l.lineNo,
        itemName: l.itemName ?? "(품목명 없음)",
        qty: l.qty,
        uom: l.uom,
        origin: resolveLineOrigin(
          { pointerId: l.pointerId, snapshotName: l.itemName },
          present,
          (id) => labelById.get(id) ?? null,
        ),
        ordered: null,
        consumed: null,
        shipped: null,
        open: null,
        derived: null,
      }));
      return {
        kind: focus.type,
        showConsumption: false,
        originLabel: isDlv ? "출처 수주 라인" : "출처 발주 라인",
        rows,
        note: null,
      };
    }

    case "shipment": {
      const lines = await repo.shipmentLinesByShipmentId(focus.id);
      const soLineIds = uniq(lines.filter((l) => l.orderType === "SO").map((l) => l.orderLineId));
      const poLineIds = uniq(lines.filter((l) => l.orderType === "PO").map((l) => l.orderLineId));
      const soRows = await repo.soLinesByIdsForOrigin(soLineIds);
      const poRows = await repo.poLinesByIdsForOrigin(poLineIds);
      const present = new Set([...soRows, ...poRows].map((r) => r.id));
      const labelById = new Map(
        [...soRows.map((r) => [r.id, `${r.docNumber ?? "수주"} · 라인 ${r.lineNo}`] as const),
         ...poRows.map((r) => [r.id, `${r.docNumber ?? "발주"} · 라인 ${r.lineNo}`] as const)],
      );
      const rows: FocusLineRow[] = lines.map((l) => ({
        lineNo: l.lineNo,
        itemName: l.itemName ?? "(품목명 없음)",
        qty: l.qty,
        uom: l.uom,
        origin: resolveLineOrigin(
          { pointerId: l.orderLineId, snapshotName: l.itemName },
          present,
          (id) => labelById.get(id) ?? null,
        ),
        ordered: null,
        consumed: null,
        shipped: null,
        open: null,
        derived: null,
      }));
      return { kind: "shipment", showConsumption: false, originLabel: "출처 주문 라인 (SO/PO)", rows, note: null };
    }

    case "tradeDocument": {
      const lines = await repo.tradeDocLinesFull(focus.id);
      const orderLineIds = uniq(lines.map((l) => l.orderLineId));
      const soRows = await repo.soLinesByIdsForOrigin(orderLineIds);
      const present = new Set(soRows.map((r) => r.id));
      const labelById = new Map(soRows.map((r) => [r.id, `${r.docNumber ?? "수주"} · 라인 ${r.lineNo}`]));
      const rows: FocusLineRow[] = lines.map((l) => ({
        lineNo: l.lineNo,
        itemName: l.productName ?? "(품목명 없음)",
        qty: l.qty,
        uom: l.uom,
        origin: resolveLineOrigin(
          { pointerId: l.orderLineId, snapshotName: l.productName },
          present,
          (id) => labelById.get(id) ?? null,
        ),
        ordered: null,
        consumed: null,
        shipped: null,
        open: null,
        derived: null,
      }));
      return { kind: "tradeDocument", showConsumption: false, originLabel: "출처 수주 라인", rows, note: null };
    }
  }
}

/* ============================================================================
 * 실제 레포 (supabase, 읽기 전용) + 공개 진입점
 * ========================================================================== */
//  잔량·소비 산식은 뷰(so_open_qty·po_open_qty·shipment_line_totals)가 이미
//  docFlow 규칙으로 계산해 준다 — 여기서 재계산하지 않는다(파생수량 저장 금지).

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

function makeRealRepo(): DocChainRepo {
  const sb = createSupabaseServerClient();
  const asDoc =
    (numberField: string, dateField: string) =>
    (r: Record<string, unknown>): RawDoc => ({
      id: r.id as string,
      docNumber: (r[numberField] as string | null) ?? null,
      date: (r[dateField] as string | null) ?? null,
      status: (r.status as string | null) ?? null,
    });

  async function sel<T>(table: string, cols: string, col: string, ids: string[]): Promise<T[]> {
    if (ids.length === 0) return [];
    const { data, error } = await sb.from(table).select(cols).in(col, ids);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    return (data ?? []) as unknown as T[];
  }

  const repo: DocChainRepo = {
    async inquiriesByIds(ids) {
      return (await sel<Record<string, unknown>>("inquiries", "id, inquiry_date, status", "id", ids)).map(
        (r) => ({ id: r.id as string, docNumber: null, date: (r.inquiry_date as string) ?? null, status: (r.status as string) ?? null }),
      );
    },
    async quotationsByIds(ids) {
      return (await sel<Record<string, unknown>>("quotations", "id, quotation_number, quotation_date, status, inquiry_id", "id", ids)).map(
        (r) => ({ ...asDoc("quotation_number", "quotation_date")(r), inquiryId: (r.inquiry_id as string | null) ?? null }),
      );
    },
    async quotationsByInquiryIds(ids) {
      return (await sel<Record<string, unknown>>("quotations", "id, quotation_number, quotation_date, status, inquiry_id", "inquiry_id", ids)).map(
        (r) => ({ ...asDoc("quotation_number", "quotation_date")(r), inquiryId: (r.inquiry_id as string | null) ?? null }),
      );
    },
    async salesOrdersByIds(ids) {
      return (await sel<Record<string, unknown>>("sales_orders", "id, so_number, order_date, status, ref_quotation_id", "id", ids)).map(
        (r) => ({ ...asDoc("so_number", "order_date")(r), refQuotationId: (r.ref_quotation_id as string | null) ?? null }),
      );
    },
    async salesOrdersByQuotationIds(ids) {
      return (await sel<Record<string, unknown>>("sales_orders", "id, so_number, order_date, status, ref_quotation_id", "ref_quotation_id", ids)).map(
        (r) => ({ ...asDoc("so_number", "order_date")(r), refQuotationId: (r.ref_quotation_id as string | null) ?? null }),
      );
    },
    async purchaseOrdersByIds(ids) {
      return (await sel<Record<string, unknown>>("purchase_orders", "id, po_number, order_date, status, ref_sales_order_id", "id", ids)).map(
        (r) => ({ ...asDoc("po_number", "order_date")(r), refSalesOrderId: (r.ref_sales_order_id as string | null) ?? null }),
      );
    },
    async purchaseOrdersBySalesOrderIds(ids) {
      return (await sel<Record<string, unknown>>("purchase_orders", "id, po_number, order_date, status, ref_sales_order_id", "ref_sales_order_id", ids)).map(
        (r) => ({ ...asDoc("po_number", "order_date")(r), refSalesOrderId: (r.ref_sales_order_id as string | null) ?? null }),
      );
    },
    async shipmentsByIds(ids) {
      return (await sel<Record<string, unknown>>("shipments", "id, ship_number, created_at, status", "id", ids)).map(
        (r) => ({ id: r.id as string, docNumber: (r.ship_number as string | null) ?? null, date: ((r.created_at as string) ?? "").slice(0, 10) || null, status: (r.status as string | null) ?? null }),
      );
    },
    async deliveriesByIds(ids) {
      return mapConsume(await sel<Record<string, unknown>>("deliveries", "id, delivery_no, delivery_date, status, ref_doc_id", "id", ids), "delivery_no", "delivery_date");
    },
    async deliveriesBySalesOrderIds(ids) {
      return mapConsume(await sel<Record<string, unknown>>("deliveries", "id, delivery_no, delivery_date, status, ref_doc_id", "ref_doc_id", ids), "delivery_no", "delivery_date");
    },
    async goodsReceiptsByIds(ids) {
      return mapConsume(await sel<Record<string, unknown>>("goods_receipts", "id, gr_no, receipt_date, status, ref_doc_id", "id", ids), "gr_no", "receipt_date");
    },
    async goodsReceiptsByPurchaseOrderIds(ids) {
      return mapConsume(await sel<Record<string, unknown>>("goods_receipts", "id, gr_no, receipt_date, status, ref_doc_id", "ref_doc_id", ids), "gr_no", "receipt_date");
    },
    async tradeDocumentsByIds(ids) {
      return mapTradeHead(await sel<Record<string, unknown>>("trade_documents", "id, doc_number, issue_date, status, shipment_id", "id", ids));
    },
    async tradeDocumentsByShipmentIds(ids) {
      return mapTradeHead(await sel<Record<string, unknown>>("trade_documents", "id, doc_number, issue_date, status, shipment_id", "shipment_id", ids));
    },
    async shipmentOrdersByOrderIds(soIds, poIds) {
      const out: RawShipmentOrder[] = [];
      if (soIds.length) out.push(...(await selOrders(sb, soIds, "SO")));
      if (poIds.length) out.push(...(await selOrders(sb, poIds, "PO")));
      return out;
    },
    async shipmentOrdersByShipmentIds(ids) {
      return (await sel<Record<string, unknown>>("shipment_orders", "shipment_id, order_type, order_id", "shipment_id", ids)).map(
        (r) => ({ shipmentId: r.shipment_id as string, orderType: (r.order_type as string | null) ?? null, orderId: (r.order_id as string | null) ?? null }),
      );
    },
    async ledgerByConsumers(deliveryIds, grIds) {
      const rows: RawLedgerRow[] = [];
      if (deliveryIds.length) {
        const { data, error } = await sb.from("stock_movements").select("ref_doc_type, ref_doc_id, movement_type").eq("ref_doc_type", "delivery").in("ref_doc_id", deliveryIds);
        if (error) throw new Error(`원장 조회 실패: ${error.message}`);
        rows.push(...mapLedger(data));
      }
      if (grIds.length) {
        const { data, error } = await sb.from("stock_movements").select("ref_doc_type, ref_doc_id, movement_type").eq("ref_doc_type", "goods_receipt").in("ref_doc_id", grIds);
        if (error) throw new Error(`원장 조회 실패: ${error.message}`);
        rows.push(...mapLedger(data));
      }
      return rows;
    },
    async tradeDocLinesByDocIds(ids) {
      return (await sel<Record<string, unknown>>("trade_document_lines", "document_id, order_line_id", "document_id", ids)).map(
        (r) => ({ documentId: r.document_id as string, orderLineId: (r.order_line_id as string | null) ?? null }),
      );
    },
    async soLinesByIds(ids) {
      return (await sel<Record<string, unknown>>("so_lines", "id, so_id", "id", ids)).map((r) => ({ id: r.id as string, soId: r.so_id as string }));
    },
    async soOpenQty(soId) {
      const { data, error } = await sb.from("so_open_qty").select("so_line_id, product_name, unit, ordered_qty, shipped_qty, open_qty").eq("so_id", soId).order("sort_order", { ascending: true, nullsFirst: false });
      if (error) throw new Error(`수주 잔량 조회 실패: ${error.message}`);
      const lineIds = ((data ?? []) as Record<string, unknown>[]).map((r) => r.so_line_id as string);
      const refs = await refPointers(sb, "so_lines", "ref_quotation_line_id", lineIds);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        lineId: r.so_line_id as string,
        productName: (r.product_name as string | null) ?? null,
        unit: (r.unit as string | null) ?? null,
        orderedQty: num(r.ordered_qty as number | string | null),
        consumedQty: num(r.shipped_qty as number | string | null),
        openQty: num(r.open_qty as number | string | null),
        refPointerId: refs.get(r.so_line_id as string) ?? null,
      }));
    },
    async poOpenQty(poId) {
      const { data, error } = await sb.from("po_open_qty").select("po_line_id, product_name, unit, ordered_qty, received_qty, open_qty").eq("po_id", poId).order("sort_order", { ascending: true, nullsFirst: false });
      if (error) throw new Error(`발주 잔량 조회 실패: ${error.message}`);
      const lineIds = ((data ?? []) as Record<string, unknown>[]).map((r) => r.po_line_id as string);
      const refs = await refPointers(sb, "po_lines", "ref_so_line_id", lineIds);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        lineId: r.po_line_id as string,
        productName: (r.product_name as string | null) ?? null,
        unit: (r.unit as string | null) ?? null,
        orderedQty: num(r.ordered_qty as number | string | null),
        consumedQty: num(r.received_qty as number | string | null),
        openQty: num(r.open_qty as number | string | null),
        refPointerId: refs.get(r.po_line_id as string) ?? null,
      }));
    },
    async shipmentLineTotals(rows) {
      const out = new Map<string, number>();
      const so = uniq(rows.filter((r) => r.orderType === "SO").map((r) => r.orderLineId));
      const po = uniq(rows.filter((r) => r.orderType === "PO").map((r) => r.orderLineId));
      for (const [ot, ids] of [["SO", so], ["PO", po]] as const) {
        if (!ids.length) continue;
        const { data, error } = await sb.from("shipment_line_totals").select("order_line_id, shipped_qty").eq("order_type", ot).in("order_line_id", ids);
        if (error) throw new Error(`선적 집계 조회 실패: ${error.message}`);
        for (const r of (data ?? []) as Record<string, unknown>[]) out.set(r.order_line_id as string, num(r.shipped_qty as number | string | null));
      }
      return out;
    },
    async quotationItemsByQuotationId(qid) {
      const { data, error } = await sb.from("quotation_items").select("id, sort_order, product_name").eq("quotation_id", qid).order("sort_order", { ascending: true, nullsFirst: false });
      if (error) throw new Error(`견적 라인 조회 실패: ${error.message}`);
      const { data: q } = await sb.from("quotations").select("quotation_number").eq("id", qid).maybeSingle();
      const num_ = (q as { quotation_number?: string } | null)?.quotation_number ?? null;
      return ((data ?? []) as Record<string, unknown>[]).map((r, i) => ({ id: r.id as string, docNumber: num_, lineNo: (r.sort_order as number | null) != null ? (r.sort_order as number) + 1 : i + 1, productName: (r.product_name as string | null) ?? null }));
    },
    async soLinesByRefQuotationLineIds(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await sb.from("so_lines").select("id, so_id, sort_order, product_name, ref_quotation_line_id").in("ref_quotation_line_id", ids);
      if (error) throw new Error(`파생 수주라인 조회 실패: ${error.message}`);
      const rows = (data ?? []) as Record<string, unknown>[];
      const soNums = await docNumbers(sb, "sales_orders", "so_number", uniq(rows.map((r) => r.so_id as string)));
      return rows.map((r, i) => ({
        refPointerId: r.ref_quotation_line_id as string,
        soId: r.so_id as string,
        soNumber: soNums.get(r.so_id as string) ?? null,
        lineNo: (r.sort_order as number | null) != null ? (r.sort_order as number) + 1 : i + 1,
        productName: (r.product_name as string | null) ?? null,
      }));
    },
    async deliveryLinesByDeliveryId(id) {
      return mapConsumeLines(await sbLines2(sb, "delivery_lines", "delivery_id", id, "id, line_no, so_line_id, item_name, qty, uom"), "so_line_id");
    },
    async grLinesByGrId(id) {
      return mapConsumeLines(await sbLines2(sb, "gr_lines", "gr_id", id, "id, line_no, po_line_id, item_name, qty, uom"), "po_line_id");
    },
    async shipmentLinesByShipmentId(id) {
      const { data, error } = await sb.from("shipment_lines").select("order_type, order_line_id, item_name, qty, uom").eq("shipment_id", id);
      if (error) throw new Error(`선적 라인 조회 실패: ${error.message}`);
      return ((data ?? []) as Record<string, unknown>[]).map((r, i) => ({
        lineNo: i + 1,
        orderType: r.order_type as "SO" | "PO",
        orderLineId: (r.order_line_id as string | null) ?? null,
        itemName: (r.item_name as string | null) ?? null,
        qty: num(r.qty as number | string | null),
        uom: (r.uom as string | null) ?? null,
      }));
    },
    async tradeDocLinesFull(docId) {
      const { data, error } = await sb.from("trade_document_lines").select("line_no, order_line_id, shipment_line_id, product_name, qty, uom").eq("document_id", docId).order("line_no", { ascending: true });
      if (error) throw new Error(`무역서류 라인 조회 실패: ${error.message}`);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        lineNo: r.line_no as number,
        orderLineId: (r.order_line_id as string | null) ?? null,
        shipmentLineId: (r.shipment_line_id as string | null) ?? null,
        productName: (r.product_name as string | null) ?? null,
        qty: num(r.qty as number | string | null),
        uom: (r.uom as string | null) ?? null,
      }));
    },
    // 원천 존재/라벨 조회
    async quotationItemsByIds(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await sb.from("quotation_items").select("id, sort_order, quotation_id, product_name").in("id", ids);
      if (error) throw new Error(`견적 라인 조회 실패: ${error.message}`);
      const rows = (data ?? []) as Record<string, unknown>[];
      const qnums = await docNumbers(sb, "quotations", "quotation_number", uniq(rows.map((r) => r.quotation_id as string)));
      return rows.map((r, i) => ({ id: r.id as string, docNumber: qnums.get(r.quotation_id as string) ?? null, lineNo: (r.sort_order as number | null) != null ? (r.sort_order as number) + 1 : i + 1, productName: (r.product_name as string | null) ?? null }));
    },
    async soLinesByIdsForOrigin(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await sb.from("so_lines").select("id, sort_order, so_id, product_name").in("id", ids);
      if (error) throw new Error(`수주 라인 조회 실패: ${error.message}`);
      const rows = (data ?? []) as Record<string, unknown>[];
      const nums = await docNumbers(sb, "sales_orders", "so_number", uniq(rows.map((r) => r.so_id as string)));
      return rows.map((r, i) => ({ id: r.id as string, docNumber: nums.get(r.so_id as string) ?? null, lineNo: (r.sort_order as number | null) != null ? (r.sort_order as number) + 1 : i + 1, productName: (r.product_name as string | null) ?? null }));
    },
    async poLinesByIdsForOrigin(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await sb.from("po_lines").select("id, sort_order, po_id, product_name").in("id", ids);
      if (error) throw new Error(`발주 라인 조회 실패: ${error.message}`);
      const rows = (data ?? []) as Record<string, unknown>[];
      const nums = await docNumbers(sb, "purchase_orders", "po_number", uniq(rows.map((r) => r.po_id as string)));
      return rows.map((r, i) => ({ id: r.id as string, docNumber: nums.get(r.po_id as string) ?? null, lineNo: (r.sort_order as number | null) != null ? (r.sort_order as number) + 1 : i + 1, productName: (r.product_name as string | null) ?? null }));
    },
  } as DocChainRepo;
  return repo;
}

// ── 실 레포 보조 매퍼 ──────────────────────────────────────────────────────
type SB = ReturnType<typeof createSupabaseServerClient>;

function mapConsume(rows: Record<string, unknown>[], numberField: string, dateField: string): RawConsumptionDoc[] {
  return rows.map((r) => ({ id: r.id as string, docNumber: (r[numberField] as string | null) ?? null, date: (r[dateField] as string | null) ?? null, status: (r.status as string | null) ?? null, refDocId: r.ref_doc_id as string }));
}
function mapTradeHead(rows: Record<string, unknown>[]): RawTradeDocHead[] {
  return rows.map((r) => ({ id: r.id as string, docNumber: (r.doc_number as string | null) ?? null, date: (r.issue_date as string | null) ?? null, status: (r.status as string | null) ?? null, shipmentId: r.shipment_id as string }));
}
function mapLedger(data: unknown): RawLedgerRow[] {
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ refDocType: (r.ref_doc_type as string | null) ?? null, refDocId: (r.ref_doc_id as string | null) ?? null, movementType: r.movement_type as string }));
}
async function selOrders(sb: SB, ids: string[], ot: "SO" | "PO"): Promise<RawShipmentOrder[]> {
  const { data, error } = await sb.from("shipment_orders").select("shipment_id, order_type, order_id").eq("order_type", ot).in("order_id", ids);
  if (error) throw new Error(`선적 연결 조회 실패: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ shipmentId: r.shipment_id as string, orderType: (r.order_type as string | null) ?? null, orderId: (r.order_id as string | null) ?? null }));
}
async function refPointers(sb: SB, table: string, refCol: string, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (ids.length === 0) return out;
  const { data, error } = await sb.from(table).select(`id, ${refCol}`).in("id", ids);
  if (error) throw new Error(`${table} 참조 조회 실패: ${error.message}`);
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) out.set(r.id as string, (r[refCol] as string | null) ?? null);
  return out;
}
async function docNumbers(sb: SB, table: string, numberCol: string, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (ids.length === 0) return out;
  const { data, error } = await sb.from(table).select(`id, ${numberCol}`).in("id", ids);
  if (error) throw new Error(`${table} 번호 조회 실패: ${error.message}`);
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) out.set(r.id as string, (r[numberCol] as string | null) ?? null);
  return out;
}
async function sbLines2(sb: SB, table: string, docCol: string, docId: string, cols: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await sb.from(table).select(cols).eq(docCol, docId).order("line_no", { ascending: true });
  if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
  return (data ?? []) as unknown as Record<string, unknown>[];
}
function mapConsumeLines(rows: Record<string, unknown>[], pointerCol: string): ConsumeLineRow[] {
  return rows.map((r) => ({ lineNo: r.line_no as number, pointerId: (r[pointerCol] as string | null) ?? null, itemName: (r.item_name as string | null) ?? null, qty: num(r.qty as number | string | null), uom: (r.uom as string | null) ?? null }));
}

/** 공개 진입점 — /flow/[slug]/[id] 페이지가 호출한다. */
export async function getDocChain(type: DocTypeKey, id: string): Promise<DocChainResult> {
  return buildDocChain({ type, id }, makeRealRepo());
}

export { DOC_TYPES };
