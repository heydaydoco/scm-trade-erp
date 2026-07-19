import { describe, it, expect } from "vitest";
import { buildDocChain, type DocChainRepo, type OpenLine, type LineRow } from "./docChain";

/**
 * P4.6 문서 흐름 추적 — 조회 조립 정합성 테스트 (스펙 §7 커밋 b, "코드 전에 작성").
 *
 * DocChainRepo 는 **조회 메서드만** 가진다(rpc·insert·update·delete 없음) → 읽기 전용은
 * 구조적으로 보장된다. 여기서는 배치 조립(정상 DAG·경계 비확장·원장 집계·mono-SO·
 * 초점 라인 stale·미존재 초점)을 인메모리 페이크로 검증한다.
 */

/* ---------- 인메모리 픽스처 + 페이크 레포 ---------- */

interface Fixture {
  inquiries: { id: string; date: string; status: string }[];
  quotations: { id: string; num: string; date: string; status: string; inquiryId: string | null }[];
  salesOrders: { id: string; num: string; date: string; status: string; refQuotationId: string | null }[];
  purchaseOrders: { id: string; num: string; date: string; status: string; refSalesOrderId: string | null }[];
  shipments: { id: string; num: string; date: string; status: string }[];
  shipmentOrders: { shipmentId: string; orderType: string | null; orderId: string | null }[];
  deliveries: { id: string; num: string; date: string; status: string; refDocId: string }[];
  goodsReceipts: { id: string; num: string; date: string; status: string; refDocId: string }[];
  tradeDocs: { id: string; num: string; date: string; status: string; shipmentId: string }[];
  ledger: { refDocType: string | null; refDocId: string | null; movementType: string }[];
  tradeDocLines: { documentId: string; orderLineId: string | null; shipmentLineId: string | null; lineNo: number; productName: string | null; qty: number; uom: string | null }[];
  soLines: { id: string; soId: string; lineNo: number; productName: string | null }[];
  soOpen: Record<string, OpenLine[]>;
  quotationItems: { id: string; quotationId: string; lineNo: number; productName: string | null }[];
  deliveryLines: { deliveryId: string; lineNo: number; soLineId: string | null; itemName: string | null; qty: number; uom: string | null }[];
}

function makeFake(fx: Fixture): { repo: DocChainRepo; calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const bump = (n: string) => (calls[n] = (calls[n] ?? 0) + 1);
  const has = (ids: string[]) => new Set(ids);
  const soNumById = new Map(fx.salesOrders.map((s) => [s.id, s.num]));

  const repo: DocChainRepo = {
    async inquiriesByIds(ids) {
      bump("inquiriesByIds");
      return fx.inquiries.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, docNumber: null, date: r.date, status: r.status }));
    },
    async quotationsByIds(ids) {
      bump("quotationsByIds");
      return fx.quotations.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, docNumber: r.num, date: r.date, status: r.status, inquiryId: r.inquiryId }));
    },
    async quotationsByInquiryIds(ids) {
      return fx.quotations.filter((r) => r.inquiryId && ids.includes(r.inquiryId)).map((r) => ({ id: r.id, docNumber: r.num, date: r.date, status: r.status, inquiryId: r.inquiryId }));
    },
    async salesOrdersByIds(ids) {
      bump("salesOrdersByIds");
      return fx.salesOrders.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, docNumber: r.num, date: r.date, status: r.status, refQuotationId: r.refQuotationId }));
    },
    async salesOrdersByQuotationIds(ids) {
      return fx.salesOrders.filter((r) => r.refQuotationId && ids.includes(r.refQuotationId)).map((r) => ({ id: r.id, docNumber: r.num, date: r.date, status: r.status, refQuotationId: r.refQuotationId }));
    },
    async purchaseOrdersByIds(ids) {
      bump("purchaseOrdersByIds");
      return fx.purchaseOrders.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, docNumber: r.num, date: r.date, status: r.status, refSalesOrderId: r.refSalesOrderId }));
    },
    async purchaseOrdersBySalesOrderIds(ids) {
      return fx.purchaseOrders.filter((r) => r.refSalesOrderId && ids.includes(r.refSalesOrderId)).map((r) => ({ id: r.id, docNumber: r.num, date: r.date, status: r.status, refSalesOrderId: r.refSalesOrderId }));
    },
    async shipmentsByIds(ids) {
      return fx.shipments.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, docNumber: r.num, date: r.date, status: r.status }));
    },
    async deliveriesByIds(ids) {
      return fx.deliveries.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, docNumber: r.num, date: r.date, status: r.status, refDocId: r.refDocId }));
    },
    async deliveriesBySalesOrderIds(ids) {
      return fx.deliveries.filter((r) => ids.includes(r.refDocId)).map((r) => ({ id: r.id, docNumber: r.num, date: r.date, status: r.status, refDocId: r.refDocId }));
    },
    async goodsReceiptsByIds(ids) {
      return fx.goodsReceipts.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, docNumber: r.num, date: r.date, status: r.status, refDocId: r.refDocId }));
    },
    async goodsReceiptsByPurchaseOrderIds(ids) {
      return fx.goodsReceipts.filter((r) => ids.includes(r.refDocId)).map((r) => ({ id: r.id, docNumber: r.num, date: r.date, status: r.status, refDocId: r.refDocId }));
    },
    async tradeDocumentsByIds(ids) {
      return fx.tradeDocs.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, docNumber: r.num, date: r.date, status: r.status, shipmentId: r.shipmentId }));
    },
    async tradeDocumentsByShipmentIds(ids) {
      return fx.tradeDocs.filter((r) => ids.includes(r.shipmentId)).map((r) => ({ id: r.id, docNumber: r.num, date: r.date, status: r.status, shipmentId: r.shipmentId }));
    },
    async shipmentOrdersByOrderIds(soIds, poIds) {
      const so = has(soIds), po = has(poIds);
      return fx.shipmentOrders.filter((l) => (l.orderType === "SO" && l.orderId && so.has(l.orderId)) || (l.orderType === "PO" && l.orderId && po.has(l.orderId)));
    },
    async shipmentOrdersByShipmentIds(ids) {
      return fx.shipmentOrders.filter((l) => ids.includes(l.shipmentId));
    },
    async ledgerByConsumers(deliveryIds, grIds) {
      const d = has(deliveryIds), g = has(grIds);
      return fx.ledger.filter((r) => (r.refDocType === "delivery" && r.refDocId && d.has(r.refDocId)) || (r.refDocType === "goods_receipt" && r.refDocId && g.has(r.refDocId)));
    },
    async tradeDocLinesByDocIds(ids) {
      return fx.tradeDocLines.filter((l) => ids.includes(l.documentId)).map((l) => ({ documentId: l.documentId, orderLineId: l.orderLineId }));
    },
    async soLinesByIds(ids) {
      return fx.soLines.filter((l) => ids.includes(l.id)).map((l) => ({ id: l.id, soId: l.soId }));
    },
    async soOpenQty(soId) {
      return fx.soOpen[soId] ?? [];
    },
    async poOpenQty() {
      return [];
    },
    async shipmentLineTotals() {
      return new Map();
    },
    async quotationItemsByQuotationId(qid) {
      return fx.quotationItems.filter((i) => i.quotationId === qid).map((i) => ({ id: i.id, docNumber: qid, lineNo: i.lineNo, productName: i.productName }));
    },
    async quotationItemsByIds(ids) {
      return fx.quotationItems.filter((i) => ids.includes(i.id)).map((i) => ({ id: i.id, docNumber: i.quotationId, lineNo: i.lineNo, productName: i.productName }));
    },
    async soLinesByIdsForOrigin(ids): Promise<LineRow[]> {
      return fx.soLines.filter((l) => ids.includes(l.id)).map((l) => ({ id: l.id, docNumber: soNumById.get(l.soId) ?? null, lineNo: l.lineNo, productName: l.productName }));
    },
    async poLinesByIdsForOrigin() {
      return [];
    },
    async soLinesByRefQuotationLineIds() {
      return [];
    },
    async deliveryLinesByDeliveryId(id) {
      return fx.deliveryLines.filter((l) => l.deliveryId === id).map((l) => ({ lineNo: l.lineNo, pointerId: l.soLineId, itemName: l.itemName, qty: l.qty, uom: l.uom }));
    },
    async grLinesByGrId() {
      return [];
    },
    async shipmentLinesByShipmentId() {
      return [];
    },
    async tradeDocLinesFull() {
      return [];
    },
  };
  return { repo, calls };
}

function baseFixture(): Fixture {
  return {
    inquiries: [{ id: "INQ1", date: "2026-06-01", status: "quoted" }],
    quotations: [{ id: "Q1", num: "QT-202606-001", date: "2026-06-02", status: "approved", inquiryId: "INQ1" }],
    salesOrders: [
      { id: "S1", num: "SO-202607-001", date: "2026-07-01", status: "draft", refQuotationId: "Q1" },
      { id: "SB", num: "SO-202607-009", date: "2026-07-02", status: "draft", refQuotationId: "Q9" }, // 경계
    ],
    purchaseOrders: [{ id: "P1", num: "PO-202607-001", date: "2026-07-03", status: "draft", refSalesOrderId: "S1" }],
    shipments: [{ id: "SH1", num: "SHP-202607-001", date: "2026-07-05", status: "booked" }],
    shipmentOrders: [
      { shipmentId: "SH1", orderType: "SO", orderId: "S1" },
      { shipmentId: "SH1", orderType: "PO", orderId: "P1" },
      { shipmentId: "SH1", orderType: "SO", orderId: "SB" }, // 공유 선적으로 만난 타 주문
      { shipmentId: "SH1", orderType: null, orderId: null }, // null 판별자 — 조용히 통과
    ],
    deliveries: [{ id: "D1", num: "DLV-202607-001", date: "2026-07-06", status: "normal", refDocId: "S1" }],
    goodsReceipts: [{ id: "G1", num: "GR-202607-001", date: "2026-07-07", status: "normal", refDocId: "P1" }],
    tradeDocs: [{ id: "T1", num: "CI-202607-001", date: "2026-07-08", status: "issued", shipmentId: "SH1" }],
    ledger: [
      { refDocType: "delivery", refDocId: "D1", movementType: "DLV_OUT" },
      { refDocType: "delivery", refDocId: "D1", movementType: "REVERSAL" },
      { refDocType: "goods_receipt", refDocId: "G1", movementType: "GR_IN" },
      { refDocType: null, refDocId: null, movementType: "INIT" }, // 수동조정 — 리프 없음
    ],
    tradeDocLines: [{ documentId: "T1", orderLineId: "SL1", shipmentLineId: "SHL1", lineNo: 1, productName: "볼트", qty: 5, uom: "EA" }],
    soLines: [{ id: "SL1", soId: "S1", lineNo: 1, productName: "볼트" }],
    soOpen: {
      S1: [{ lineId: "SL1", productName: "볼트", unit: "EA", orderedQty: 10, consumedQty: 4, openQty: 6, refPointerId: "QI1" }],
    },
    quotationItems: [{ id: "QI1", quotationId: "Q1", lineNo: 1, productName: "볼트" }],
    deliveryLines: [],
  };
}

/* ---------- 정상 DAG(SO 초점) ---------- */

describe("buildDocChain — SO 초점 풀 DAG 조립", () => {
  it("★9엣지·경계·원장리프·mono-SO·초점라인이 한 번에 조립된다", async () => {
    const { repo } = makeFake(baseFixture());
    const res = await buildDocChain({ type: "salesOrder", id: "S1" }, repo);
    expect(res.found).toBe(true);
    const keys = res.chain!.nodes.map((n) => n.key);
    expect(keys).toContain("inquiry:INQ1");
    expect(keys).toContain("quotation:Q1");
    expect(keys).toContain("salesOrder:S1");
    expect(keys).toContain("purchaseOrder:P1");
    expect(keys).toContain("shipment:SH1");
    expect(keys).toContain("delivery:D1");
    expect(keys).toContain("goodsReceipt:G1");
    expect(keys).toContain("tradeDocument:T1");
    expect(keys).toContain("ledger:delivery:D1");
    expect(keys).toContain("ledger:goodsReceipt:G1");

    // 초점
    expect(res.chain!.nodes.find((n) => n.key === "salesOrder:S1")?.focus).toBe(true);
    // 원장 집계
    expect(res.chain!.nodes.find((n) => n.key === "ledger:delivery:D1")?.meta).toEqual({ ledgerCount: 2, reversalCount: 1 });
    // mono-SO 메타
    expect(res.chain!.nodes.find((n) => n.key === "tradeDocument:T1")?.meta?.soNumbers).toEqual(["SO-202607-001"]);
  });

  it("★경계 SO 는 boundary=true 이고 상류 견적(Q9)으로 확장하지 않는다", async () => {
    const { repo } = makeFake(baseFixture());
    const res = await buildDocChain({ type: "salesOrder", id: "S1" }, repo);
    const sb = res.chain!.nodes.find((n) => n.key === "salesOrder:SB")!;
    expect(sb.boundary).toBe(true);
    expect(res.chain!.nodes.some((n) => n.key === "quotation:Q9")).toBe(false);
    // 경계 SO 도 선적 엣지는 있다(공유 선적)
    expect(res.chain!.edges.some((e) => e.from === "salesOrder:SB" && e.to === "shipment:SH1")).toBe(true);
  });

  it("★null 판별자 shipment_orders 행은 크래시 없이 무시된다", async () => {
    const { repo } = makeFake(baseFixture());
    const res = await buildDocChain({ type: "salesOrder", id: "S1" }, repo);
    // null 링크가 스텁 주문을 만들지 않는다
    expect(res.chain!.nodes.every((n) => n.type !== "salesOrder" || n.id !== "")).toBe(true);
    expect(res.found).toBe(true);
  });

  it("배치 조회 — 주문 헤더 조회가 노드 수만큼 반복되지 않는다(N+1 아님)", async () => {
    const { repo, calls } = makeFake(baseFixture());
    await buildDocChain({ type: "salesOrder", id: "S1" }, repo);
    // salesOrdersByIds 는 시드·부모·헤더·경계 등 몇 번(≤6)만 — 노드당 루프면 훨씬 커진다
    expect(calls.salesOrdersByIds).toBeLessThanOrEqual(6);
    expect(calls.purchaseOrdersByIds).toBeLessThanOrEqual(4);
  });

  it("초점 SO 라인 표 — 잔량·소비 + 원천 견적 라인 해석", async () => {
    const { repo } = makeFake(baseFixture());
    const res = await buildDocChain({ type: "salesOrder", id: "S1" }, repo);
    expect(res.focusLines?.kind).toBe("salesOrder");
    expect(res.focusLines?.showConsumption).toBe(true);
    const row = res.focusLines!.rows[0];
    expect(row).toMatchObject({ itemName: "볼트", ordered: 10, consumed: 4, open: 6 });
    expect(row.origin.status).toBe("ok");
    expect(row.origin.label).toContain("라인 1");
  });
});

/* ---------- 초점 라인 stale(라이브 6건 대응) ---------- */

describe("buildDocChain — 출고 초점, 취소 전표의 stale 라인 포인터", () => {
  it("★so_line_id 대상 부재 → '연결 끊김' + 스냅샷명, 무크래시", async () => {
    const fx = baseFixture();
    fx.deliveries = [{ id: "D1", num: "DLV-202607-001", date: "2026-07-06", status: "cancelled", refDocId: "S1" }];
    // 부모 SO 라인이 재저장돼 사라진 상태: 출고 라인은 GONE 을 가리킨다
    fx.deliveryLines = [{ deliveryId: "D1", lineNo: 1, soLineId: "GONE", itemName: "너트(스냅샷)", qty: 3, uom: "EA" }];
    fx.soLines = []; // SL1 도 사라졌다고 가정(원천 전멸)
    const { repo } = makeFake(fx);
    const res = await buildDocChain({ type: "delivery", id: "D1" }, repo);
    expect(res.found).toBe(true);
    expect(res.focusLines?.kind).toBe("delivery");
    const row = res.focusLines!.rows[0];
    expect(row.origin.status).toBe("broken");
    expect(row.origin.snapshotName).toBe("너트(스냅샷)");
    // 취소 출고여도 노드는 살아있다
    expect(res.chain!.nodes.find((n) => n.key === "delivery:D1")?.status).toBe("cancelled");
  });
});

/* ---------- 미존재 초점 ---------- */

describe("buildDocChain — 부재 id 는 found=false(화면이 '찾을 수 없음')", () => {
  it("없는 수주 id", async () => {
    const { repo } = makeFake(baseFixture());
    const res = await buildDocChain({ type: "salesOrder", id: "NOPE" }, repo);
    expect(res.found).toBe(false);
    expect(res.chain).toBeNull();
  });
});
