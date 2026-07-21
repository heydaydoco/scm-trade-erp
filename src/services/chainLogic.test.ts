import { describe, it, expect } from "vitest";
import {
  DOC_TYPES,
  COLUMN_ORDER,
  docTypeBySlug,
  detailHref,
  flowHref,
  orderTypeToDocKey,
  docKeyByStockRefDocType,
  statusBadge,
  isCancelledStatus,
  shipmentOrderEdges,
  ledgerLeaves,
  assembleChain,
  orderKey,
  resolveLineOrigin,
  type ChainInput,
  type DocTypeKey,
  type RawSalesOrder,
  type RawPurchaseOrder,
  type RawQuotation,
  type RawConsumptionDoc,
  type RawTradeDocument,
  type RawDoc,
  type RawShipmentOrder,
  type RawLedgerRow,
} from "./chainLogic";

/**
 * P4.6 문서 흐름 추적 — 순수 로직 정합성 테스트 (스펙 §7 커밋 a, "코드 전에 작성").
 *
 * 아키텍트가 못박은 시나리오: 어휘 사전 완전성 / 픽스처 DAG 조립(정상 사슬·취소 사슬·
 * stale 끊김·폴리모픽 SO/PO 분기·null 판별자 통과·경계 비확장·REVERSAL 집계·유실 헤더 스텁).
 */

/* ---------- ① 어휘 사전 완전성 ---------- */

const ALL_KEYS: DocTypeKey[] = [
  "inquiry",
  "quotation",
  "salesOrder",
  "purchaseOrder",
  "shipment",
  "goodsReceipt",
  "delivery",
  "tradeDocument",
  "customsDeclaration",
];

describe("어휘 사전 — 9개 전표타입, slug·테이블·판별자 실값이 조사와 일치", () => {
  it("9개 키가 전부 정의돼 있다", () => {
    for (const k of ALL_KEYS) expect(DOC_TYPES[k]?.key).toBe(k);
    expect(Object.keys(DOC_TYPES).sort()).toEqual([...ALL_KEYS].sort());
  });

  it("통관신고(P5.1) 사전 항목 — slug=customs, table=customs_declarations, column=terminal", () => {
    expect(DOC_TYPES.customsDeclaration.slug).toBe("customs");
    expect(DOC_TYPES.customsDeclaration.table).toBe("customs_declarations");
    expect(DOC_TYPES.customsDeclaration.column).toBe("terminal");
    expect(DOC_TYPES.customsDeclaration.orderType).toBeNull();
    expect(detailHref("customsDeclaration", "CD1")).toBe("/customs/CD1");
    expect(flowHref("customsDeclaration", "CD1")).toBe("/flow/customs/CD1");
  });

  it("slug 은 유일하다(라우팅 충돌 없음)", () => {
    const slugs = ALL_KEYS.map((k) => DOC_TYPES[k].slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("slug → 전표타입 왕복 + 미지 slug 은 null", () => {
    for (const k of ALL_KEYS) expect(docTypeBySlug(DOC_TYPES[k].slug)?.key).toBe(k);
    expect(docTypeBySlug("nope")).toBeNull();
  });

  it("★URL 세그먼트 ≠ 테이블 매핑(조사 확정): receipts=goods_receipts, documents=trade_documents", () => {
    expect(DOC_TYPES.goodsReceipt.slug).toBe("receipts");
    expect(DOC_TYPES.goodsReceipt.table).toBe("goods_receipts");
    expect(DOC_TYPES.tradeDocument.slug).toBe("documents");
    expect(DOC_TYPES.tradeDocument.table).toBe("trade_documents");
  });

  it("★ref_doc_type 판별자 실값(오기 'GR'|'DLV' 아님)", () => {
    expect(DOC_TYPES.delivery.ownRefDocType).toBe("sales_order");
    expect(DOC_TYPES.goodsReceipt.ownRefDocType).toBe("purchase_order");
    expect(DOC_TYPES.delivery.stockRefDocType).toBe("delivery");
    expect(DOC_TYPES.goodsReceipt.stockRefDocType).toBe("goods_receipt");
  });

  it("order_type 실값은 주문 전표에만", () => {
    expect(DOC_TYPES.salesOrder.orderType).toBe("SO");
    expect(DOC_TYPES.purchaseOrder.orderType).toBe("PO");
    expect(DOC_TYPES.shipment.orderType).toBeNull();
  });

  it("href 빌더 — 상세는 라우트 세그먼트, 흐름은 /flow/slug", () => {
    expect(detailHref("goodsReceipt", "G1")).toBe("/receipts/G1");
    expect(detailHref("tradeDocument", "T1")).toBe("/documents/T1");
    expect(detailHref("salesOrder", "S1")).toBe("/sales-orders/S1");
    expect(flowHref("delivery", "D1")).toBe("/flow/deliveries/D1");
    expect(flowHref("goodsReceipt", "G1")).toBe("/flow/receipts/G1");
  });

  it("판별자 변환 헬퍼", () => {
    expect(orderTypeToDocKey("SO")).toBe("salesOrder");
    expect(orderTypeToDocKey("PO")).toBe("purchaseOrder");
    expect(orderTypeToDocKey(null)).toBeNull();
    expect(orderTypeToDocKey("XX")).toBeNull();
    expect(docKeyByStockRefDocType("delivery")).toBe("delivery");
    expect(docKeyByStockRefDocType("goods_receipt")).toBe("goodsReceipt");
    expect(docKeyByStockRefDocType("GR")).toBeNull(); // 오기 어휘는 매칭 안 됨
    expect(docKeyByStockRefDocType(null)).toBeNull();
  });

  it("상태 배지 — 저장값(소문자) → 라벨·variant, 취소는 red", () => {
    expect(statusBadge("delivery", "cancelled")).toEqual({ label: "취소", variant: "red" });
    expect(statusBadge("tradeDocument", "issued")).toEqual({ label: "발행", variant: "green" });
    expect(statusBadge("salesOrder", "partial")).toEqual({ label: "부분출고", variant: "amber" });
    expect(statusBadge("salesOrder", "draft")).toEqual({ label: "작성중", variant: "zinc" });
    expect(isCancelledStatus("cancelled")).toBe(true);
    expect(isCancelledStatus("draft")).toBe(false);
    // 미지 상태도 크래시 없이 폴백
    expect(statusBadge("inquiry", null).variant).toBe("zinc");
  });
});

/* ---------- ② 폴리모픽 엣지 + null 판별자 통과 ---------- */

describe("shipmentOrderEdges — SO/PO 분기 · null 판별자 조용히 통과", () => {
  it("★SO·PO 둘 다 있으면 각각 엣지", () => {
    const e = shipmentOrderEdges([
      { shipmentId: "SH1", orderType: "SO", orderId: "S1" },
      { shipmentId: "SH1", orderType: "PO", orderId: "P1" },
    ]);
    expect(e).toEqual([
      { orderType: "salesOrder", orderId: "S1", shipmentId: "SH1" },
      { orderType: "purchaseOrder", orderId: "P1", shipmentId: "SH1" },
    ]);
  });

  it("★order_type null / order_id null 행은 크래시 없이 미기여", () => {
    const e = shipmentOrderEdges([
      { shipmentId: "SH1", orderType: null, orderId: "S1" },
      { shipmentId: "SH1", orderType: "SO", orderId: null },
      { shipmentId: "SH1", orderType: "SO", orderId: "S2" },
    ]);
    expect(e).toEqual([{ orderType: "salesOrder", orderId: "S2", shipmentId: "SH1" }]);
  });
});

/* ---------- ③ 원장 리프 집계(REVERSAL 포함) ---------- */

describe("ledgerLeaves — 소비 전표별 '원장 N행·역분개 M행', 수동조정 제외", () => {
  it("★DLV_OUT 3 + REVERSAL 3 → count 6·reversal 3", () => {
    const rows: RawLedgerRow[] = [
      { refDocType: "delivery", refDocId: "D1", movementType: "DLV_OUT" },
      { refDocType: "delivery", refDocId: "D1", movementType: "DLV_OUT" },
      { refDocType: "delivery", refDocId: "D1", movementType: "DLV_OUT" },
      { refDocType: "delivery", refDocId: "D1", movementType: "REVERSAL" },
      { refDocType: "delivery", refDocId: "D1", movementType: "REVERSAL" },
      { refDocType: "delivery", refDocId: "D1", movementType: "REVERSAL" },
    ];
    const leaf = ledgerLeaves(rows).get("ledger:delivery:D1")!;
    expect(leaf).toEqual({ consumerType: "delivery", consumerId: "D1", count: 6, reversalCount: 3 });
  });

  it("입고와 출고 리프를 분리 집계", () => {
    const rows: RawLedgerRow[] = [
      { refDocType: "goods_receipt", refDocId: "G1", movementType: "GR_IN" },
      { refDocType: "delivery", refDocId: "D1", movementType: "DLV_OUT" },
    ];
    const m = ledgerLeaves(rows);
    expect(m.get("ledger:goodsReceipt:G1")?.count).toBe(1);
    expect(m.get("ledger:delivery:D1")?.count).toBe(1);
  });

  it("★수동 조정(INIT/ADJ, ref_doc_type null)은 리프 미생성 — 문서 조상 없는 원장", () => {
    const rows: RawLedgerRow[] = [
      { refDocType: null, refDocId: null, movementType: "INIT" },
      { refDocType: null, refDocId: null, movementType: "ADJ_OUT" },
    ];
    expect(ledgerLeaves(rows).size).toBe(0);
  });
});

/* ---------- ④ 초점 라인 stale 처리(라이브 6건 대응) ---------- */

describe("resolveLineOrigin — 라인 포인터 유실 시 '연결 끊김' + 스냅샷명", () => {
  const present = new Set(["L1", "L2"]);
  const labelFor = (id: string) => `SO-라인 ${id}`;

  it("대상 존재 → ok + 상류 라벨", () => {
    expect(resolveLineOrigin({ pointerId: "L1", snapshotName: "볼트" }, present, labelFor)).toEqual({
      status: "ok",
      label: "SO-라인 L1",
      snapshotName: "볼트",
    });
  });

  it("★대상 부재(취소 전표의 stale 포인터) → broken + 스냅샷명 유지, 크래시 없음", () => {
    expect(resolveLineOrigin({ pointerId: "GONE", snapshotName: "너트" }, present, labelFor)).toEqual({
      status: "broken",
      label: null,
      snapshotName: "너트",
    });
  });

  it("포인터 자체가 null → none", () => {
    expect(resolveLineOrigin({ pointerId: null, snapshotName: "자유품목" }, present, labelFor).status).toBe("none");
  });
});

/* ---------- ⑤ DAG 조립 — 정상 사슬 ---------- */

function doc(id: string, num: string, status: string): RawDoc {
  return { id, docNumber: num, date: "2026-07-01", status };
}

function fullChainInput(overrides?: Partial<ChainInput>): ChainInput {
  const inquiry: RawDoc = { id: "INQ1", docNumber: null, date: "2026-06-01", status: "quoted" };
  const quotation: RawQuotation = { ...doc("Q1", "QT-202606-001", "approved"), inquiryId: "INQ1" };
  const so: RawSalesOrder = { ...doc("S1", "SO-202607-001", "draft"), refQuotationId: "Q1" };
  const po: RawPurchaseOrder = { ...doc("P1", "PO-202607-001", "draft"), refSalesOrderId: "S1" };
  const shipment: RawDoc = doc("SH1", "SHP-202607-001", "booked");
  const shipmentOrders: RawShipmentOrder[] = [
    { shipmentId: "SH1", orderType: "SO", orderId: "S1" },
    { shipmentId: "SH1", orderType: "PO", orderId: "P1" },
  ];
  const delivery: RawConsumptionDoc = { ...doc("D1", "DLV-202607-001", "normal"), refDocId: "S1" };
  const receipt: RawConsumptionDoc = { ...doc("G1", "GR-202607-001", "normal"), refDocId: "P1" };
  const tradeDoc: RawTradeDocument = {
    ...doc("T1", "CI-202607-001", "issued"),
    shipmentId: "SH1",
    soNumbers: ["SO-202607-001"],
  };
  const ledger: RawLedgerRow[] = [
    { refDocType: "delivery", refDocId: "D1", movementType: "DLV_OUT" },
    { refDocType: "goods_receipt", refDocId: "G1", movementType: "GR_IN" },
  ];
  return {
    focus: { type: "salesOrder", id: "S1" },
    primaryOrders: [orderKey("salesOrder", "S1"), orderKey("purchaseOrder", "P1")],
    inquiries: [inquiry],
    quotations: [quotation],
    salesOrders: [so],
    purchaseOrders: [po],
    shipments: [shipment],
    shipmentOrders,
    deliveries: [delivery],
    goodsReceipts: [receipt],
    tradeDocuments: [tradeDoc],
    customsDeclarations: [],
    ledger,
    ...overrides,
  };
}

function hasEdge(edges: { from: string; to: string; kind: string }[], from: string, to: string, kind: string) {
  return edges.some((e) => e.from === from && e.to === to && e.kind === kind);
}

describe("assembleChain — 정상 풀체인(문의→견적→SO→발주/선적/출고, PO→입고, 선적→CI, 원장 리프)", () => {
  const chain = assembleChain(fullChainInput());

  it("9개 canonical 엣지가 정확히 그려진다", () => {
    expect(hasEdge(chain.edges, "inquiry:INQ1", "quotation:Q1", "inquiry-quotation")).toBe(true);
    expect(hasEdge(chain.edges, "quotation:Q1", "salesOrder:S1", "quotation-so")).toBe(true);
    expect(hasEdge(chain.edges, "salesOrder:S1", "purchaseOrder:P1", "so-po")).toBe(true);
    expect(hasEdge(chain.edges, "salesOrder:S1", "delivery:D1", "so-delivery")).toBe(true);
    expect(hasEdge(chain.edges, "purchaseOrder:P1", "goodsReceipt:G1", "po-receipt")).toBe(true);
    expect(hasEdge(chain.edges, "salesOrder:S1", "shipment:SH1", "order-shipment")).toBe(true);
    expect(hasEdge(chain.edges, "purchaseOrder:P1", "shipment:SH1", "order-shipment")).toBe(true);
    expect(hasEdge(chain.edges, "shipment:SH1", "tradeDocument:T1", "shipment-tradedoc")).toBe(true);
    expect(hasEdge(chain.edges, "delivery:D1", "ledger:delivery:D1", "delivery-ledger")).toBe(true);
    expect(hasEdge(chain.edges, "goodsReceipt:G1", "ledger:goodsReceipt:G1", "receipt-ledger")).toBe(true);
  });

  it("★금지 엣지는 없다 — 출고→무역서류(청구) 직접 홉 미존재", () => {
    expect(chain.edges.some((e) => e.from === "delivery:D1" && e.to === "tradeDocument:T1")).toBe(false);
    // 무역서류→SO 직접 엣지도 없다(라인 distinct 는 노드 메타로만).
    expect(chain.edges.some((e) => e.to.startsWith("salesOrder") && e.from.startsWith("tradeDocument"))).toBe(false);
  });

  it("초점 노드에 focus=true, 나머지는 false", () => {
    expect(chain.nodes.find((n) => n.key === "salesOrder:S1")?.focus).toBe(true);
    expect(chain.nodes.find((n) => n.key === "quotation:Q1")?.focus).toBe(false);
    expect(chain.focusKey).toBe("salesOrder:S1");
  });

  it("컬럼 그룹 순서 = 상류→주문→이행→종단", () => {
    expect(chain.columns.map((c) => c.group)).toEqual(COLUMN_ORDER);
    const term = chain.columns.find((c) => c.group === "terminal")!;
    expect(term.nodes.some((n) => n.type === "tradeDocument")).toBe(true);
    expect(term.nodes.some((n) => n.type === "ledger")).toBe(true);
  });

  it("무역서류 노드에 mono-SO 메타", () => {
    const td = chain.nodes.find((n) => n.key === "tradeDocument:T1")!;
    expect(td.meta?.soNumbers).toEqual(["SO-202607-001"]);
  });

  it("원장 리프에 집계 카드(N행·역분개 M)", () => {
    const leaf = chain.nodes.find((n) => n.key === "ledger:delivery:D1")!;
    expect(leaf.meta).toEqual({ ledgerCount: 1, reversalCount: 0 });
    expect(leaf.column).toBe("terminal");
  });
});

/* ---------- ⑥ 취소 사슬 ---------- */

describe("assembleChain — 취소 지배 사슬(라이브 실태)도 노드가 살아있다", () => {
  it("취소 전표는 노드로 남고 상태로 식별된다(흐림 판정은 status 기반)", () => {
    const input = fullChainInput({
      deliveries: [{ ...doc("D1", "DLV-202607-001", "cancelled"), refDocId: "S1" }],
      // 취소 출고가 만든 DLV_OUT + 취소로 인한 REVERSAL
      ledger: [
        { refDocType: "delivery", refDocId: "D1", movementType: "DLV_OUT" },
        { refDocType: "delivery", refDocId: "D1", movementType: "REVERSAL" },
      ],
    });
    const chain = assembleChain(input);
    const d = chain.nodes.find((n) => n.key === "delivery:D1")!;
    expect(d.status).toBe("cancelled");
    expect(isCancelledStatus(d.status)).toBe(true);
    const leaf = chain.nodes.find((n) => n.key === "ledger:delivery:D1")!;
    expect(leaf.meta).toEqual({ ledgerCount: 2, reversalCount: 1 });
  });
});

/* ---------- ⑩ 선적 → 통관신고 (P5.1) ---------- */

describe("assembleChain — 선적→통관신고 엣지(⑩, P5.1)", () => {
  it("한 선적에 수출+수입 신고가 공존하고 각각 shipment-customs 엣지가 그려진다", () => {
    const input = fullChainInput({
      customsDeclarations: [
        { ...doc("CD1", "ECD-202607-001", "accepted"), shipmentId: "SH1" },
        { ...doc("CD2", "ICD-202607-001", "filed"), shipmentId: "SH1" },
      ],
    });
    const chain = assembleChain(input);
    expect(
      hasEdge(chain.edges, "shipment:SH1", "customsDeclaration:CD1", "shipment-customs"),
    ).toBe(true);
    expect(
      hasEdge(chain.edges, "shipment:SH1", "customsDeclaration:CD2", "shipment-customs"),
    ).toBe(true);
    const term = chain.columns.find((c) => c.group === "terminal")!;
    expect(term.nodes.some((n) => n.type === "customsDeclaration" && n.id === "CD1")).toBe(true);
    const cd1 = chain.nodes.find((n) => n.key === "customsDeclaration:CD1")!;
    expect(cd1.label).toBe("통관신고");
    expect(cd1.status).toBe("accepted");
  });

  it("선적이 사슬에 없으면 통관신고는 '유실된 상류' 선적 스텁에 매달린다(무크래시)", () => {
    const input = fullChainInput({
      customsDeclarations: [{ ...doc("CD9", "ECD-202607-009", "draft"), shipmentId: "SH_GONE" }],
    });
    const chain = assembleChain(input);
    expect(
      hasEdge(chain.edges, "shipment:SH_GONE", "customsDeclaration:CD9", "shipment-customs"),
    ).toBe(true);
    expect(chain.nodes.find((n) => n.key === "shipment:SH_GONE")?.stub).toBe(true);
  });
});

/* ---------- ⑦ 경계 노드 비확장 ---------- */

describe("assembleChain — 공유 선적으로 만난 타 주문은 경계 노드(미확장)", () => {
  it("★primary 밖 SO 는 boundary=true, 상류(견적) 미확장", () => {
    // SO-A(primary) 와 SO-B(경계)가 한 선적에 적재. SO-B 는 refQuotation 이 있어도 확장 안 함.
    const input = fullChainInput({
      focus: { type: "salesOrder", id: "S1" },
      primaryOrders: [orderKey("salesOrder", "S1")], // S1 만 primary — P1·SO-B 는 경계
      purchaseOrders: [],
      goodsReceipts: [],
      salesOrders: [
        { ...doc("S1", "SO-202607-001", "draft"), refQuotationId: "Q1" },
        { ...doc("SB", "SO-202607-009", "draft"), refQuotationId: "Q9" }, // 경계 — Q9 로 확장하면 안 됨
      ],
      shipmentOrders: [
        { shipmentId: "SH1", orderType: "SO", orderId: "S1" },
        { shipmentId: "SH1", orderType: "SO", orderId: "SB" },
      ],
      deliveries: [],
      tradeDocuments: [],
      ledger: [],
    });
    const chain = assembleChain(input);
    const sb = chain.nodes.find((n) => n.key === "salesOrder:SB")!;
    expect(sb.boundary).toBe(true);
    expect(chain.nodes.find((n) => n.key === "salesOrder:S1")?.boundary).toBe(false);
    // 경계 SO-B 는 선적 엣지는 갖되, 상류 견적 Q9 스텁을 만들지 않는다.
    expect(hasEdge(chain.edges, "salesOrder:SB", "shipment:SH1", "order-shipment")).toBe(true);
    expect(chain.nodes.some((n) => n.key === "quotation:Q9")).toBe(false);
    expect(chain.edges.some((e) => e.to === "salesOrder:SB" && e.kind === "quotation-so")).toBe(false);
  });
});

/* ---------- ⑧ 유실 헤더 스텁 ---------- */

describe("assembleChain — 헤더 포인터 대상 부재 → '유실된 상류(삭제됨)' 스텁", () => {
  it("★출고가 참조하는 SO 가 없으면 스텁 SO 노드 + 엣지 유지(무크래시)", () => {
    const input = fullChainInput({
      focus: { type: "delivery", id: "D1" },
      primaryOrders: [], // SO 미포함
      inquiries: [],
      quotations: [],
      salesOrders: [], // ← refDocId 'S_GONE' 대상 없음
      purchaseOrders: [],
      shipments: [],
      shipmentOrders: [],
      deliveries: [{ ...doc("D1", "DLV-202607-001", "normal"), refDocId: "S_GONE" }],
      goodsReceipts: [],
      tradeDocuments: [],
      ledger: [{ refDocType: "delivery", refDocId: "D1", movementType: "DLV_OUT" }],
    });
    const chain = assembleChain(input);
    const stub = chain.nodes.find((n) => n.key === "salesOrder:S_GONE")!;
    expect(stub.stub).toBe(true);
    expect(stub.meta?.lostReason).toBe("유실된 상류(삭제됨)");
    expect(hasEdge(chain.edges, "salesOrder:S_GONE", "delivery:D1", "so-delivery")).toBe(true);
    // 원장 리프도 정상
    expect(chain.nodes.some((n) => n.key === "ledger:delivery:D1")).toBe(true);
  });
});
