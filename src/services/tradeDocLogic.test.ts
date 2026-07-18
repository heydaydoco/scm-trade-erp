import { describe, expect, it } from "vitest";
import {
  allocateDiscounts,
  discountEntriesOf,
  issuableCombos,
  lineAmount,
  linesForCombo,
  packingFillMode,
  subtotalOf,
  totalOf,
  weightFillMode,
  weightTotal,
  zeroPriceCount,
  type ComboSourceLine,
  type DiscountSourceLine,
} from "./tradeDocLogic";

/* ---------- ① D3 할인 비례 배분 — 서버(save_trade_document) 산식 미러 ---------- */

describe("allocateDiscounts — 주문별 round2(discount × docAmount ÷ orderTotal) 합산", () => {
  it("★전량 포함이면 주문 할인이 그대로 배분된다 (docAmount = orderTotal)", () => {
    const r = allocateDiscounts([
      { soNumber: "SO-1", discount: 100, docAmount: 1000, orderTotal: 1000 },
    ]);
    expect(r.discount).toBe(100);
    expect(r.warnings).toEqual([]);
  });

  it("★부분 포함이면 비례 배분 — 100 × 500/1000 = 50", () => {
    const r = allocateDiscounts([
      { soNumber: "SO-1", discount: 100, docAmount: 500, orderTotal: 1000 },
    ]);
    expect(r.discount).toBe(50);
  });

  it("주문별로 round2 후 합산한다 — 10 × 1/3 = 3.33", () => {
    const r = allocateDiscounts([
      { soNumber: "SO-1", discount: 10, docAmount: 1, orderTotal: 3 },
    ]);
    expect(r.discount).toBe(3.33);
  });

  it("★다중 주문은 각자 배분 후 합산", () => {
    const r = allocateDiscounts([
      { soNumber: "SO-1", discount: 100, docAmount: 500, orderTotal: 1000 }, // 50
      { soNumber: "SO-2", discount: 30, docAmount: 300, orderTotal: 300 }, // 30
    ]);
    expect(r.discount).toBe(80);
  });

  it("★주문 라인 금액 합이 0이면 그 주문 할인은 0 처리 + 경고 (D3)", () => {
    const r = allocateDiscounts([
      { soNumber: "SO-1", discount: 100, docAmount: 0, orderTotal: 0 },
      { soNumber: "SO-2", discount: 20, docAmount: 200, orderTotal: 400 }, // 10
    ]);
    expect(r.discount).toBe(10);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("SO-1");
  });

  it("금액 합이 음수여도 배분하지 않는다 (적대검증 — 0 이하 분모)", () => {
    const r = allocateDiscounts([
      { soNumber: "SO-1", discount: 10, docAmount: 100, orderTotal: -1 },
    ]);
    expect(r.discount).toBe(0);
    expect(r.warnings).toHaveLength(1);
  });

  it("할인 0 + 금액 합 0 이면 경고 없음 (배분할 것이 없다)", () => {
    const r = allocateDiscounts([
      { soNumber: "SO-1", discount: 0, docAmount: 0, orderTotal: 0 },
    ]);
    expect(r.discount).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it("음수 할인은 충실 배분하되 경고한다 (적대검증 — 데이터 확인 유도)", () => {
    const r = allocateDiscounts([
      { soNumber: "SO-1", discount: -50, docAmount: 500, orderTotal: 500 },
    ]);
    expect(r.discount).toBe(-50);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("음수");
  });

  it("부동소수 무오차 — 0.1+0.2 계열이 0.3으로 떨어진다", () => {
    const r = allocateDiscounts([
      { soNumber: "SO-1", discount: 0.3, docAmount: 0.1 + 0.2, orderTotal: 0.1 + 0.2 },
    ]);
    expect(r.discount).toBe(0.3);
  });
});

/* ---------- ② 라인 금액·합계 — amount = round2(qty × 단가) (D2) ---------- */

describe("lineAmount / subtotalOf / totalOf — 화면 미리보기 = 서버 저장값", () => {
  it("★amount = round2(qty × 단가)", () => {
    expect(lineAmount(3, 19.99)).toBe(59.97);
    expect(lineAmount(0.1, 3)).toBe(0.3); // 0.30000000000000004 방지
  });

  it("subtotal = round2(Σ round2(라인 금액))", () => {
    expect(
      subtotalOf([
        { qty: 0.1, unitPrice: 1 },
        { qty: 0.2, unitPrice: 1 },
      ]),
    ).toBe(0.3);
  });

  it("total = round2(subtotal − discount)", () => {
    expect(totalOf(100, 3.33)).toBe(96.67);
  });

  it("단가 0 라인 수 — 폼 경고 '0원 라인 n건'의 근거", () => {
    expect(
      zeroPriceCount([{ unitPrice: 0 }, { unitPrice: 10 }, { unitPrice: 0 }]),
    ).toBe(2);
  });
});

/* ---------- ③ (고객×통화) 발행 조합 — D4 ---------- */

const soLine = (over: Partial<ComboSourceLine>): ComboSourceLine => ({
  shipmentLineId: "sl-1",
  orderType: "SO",
  customerId: "C1",
  customerName: "Acme",
  currency: "USD",
  soNumber: "SO-1",
  ...over,
});

describe("issuableCombos — 선적의 SO 라인만으로 (고객×통화) 조합을 만든다", () => {
  it("★같은 (고객,통화)는 하나의 조합으로 합쳐진다", () => {
    const r = issuableCombos([
      soLine({ shipmentLineId: "a", soNumber: "SO-1" }),
      soLine({ shipmentLineId: "b", soNumber: "SO-2" }),
    ]);
    expect(r.combos).toHaveLength(1);
    expect(r.combos[0]).toMatchObject({ customerId: "C1", currency: "USD", lineCount: 2 });
    expect(r.combos[0].soNumbers).toEqual(["SO-1", "SO-2"]);
    expect(r.warnings).toEqual([]);
  });

  it("★PO 라인은 조합에서 제외된다 — 수입 서류는 공급자 발행 (경고 아님, 정의)", () => {
    const r = issuableCombos([
      soLine({ shipmentLineId: "a" }),
      soLine({ shipmentLineId: "b", orderType: "PO" }),
    ]);
    expect(r.combos).toHaveLength(1);
    expect(r.combos[0].lineCount).toBe(1);
    expect(r.warnings).toEqual([]);
  });

  it("★통화 공란(SO)은 제외 + 경고 — RPC도 같은 이유로 거부한다", () => {
    const r = issuableCombos([
      soLine({ shipmentLineId: "a" }),
      soLine({ shipmentLineId: "b", soNumber: "SO-9", currency: "  " }),
    ]);
    expect(r.combos).toHaveLength(1);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("SO-9");
  });

  it("통화 공란 경고는 주문당 1회로 접는다", () => {
    const r = issuableCombos([
      soLine({ shipmentLineId: "a", soNumber: "SO-9", currency: null }),
      soLine({ shipmentLineId: "b", soNumber: "SO-9", currency: null }),
    ]);
    expect(r.combos).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  it("고객 미상(customerId null)도 제외 + 경고", () => {
    const r = issuableCombos([soLine({ customerId: null, soNumber: "SO-3" })]);
    expect(r.combos).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("SO-3");
  });

  it("서로 다른 통화는 다른 조합 — 혼합 선적의 조합별 반복 발행(D4)", () => {
    const r = issuableCombos([
      soLine({ shipmentLineId: "a", currency: "USD" }),
      soLine({ shipmentLineId: "b", currency: "EUR", soNumber: "SO-2" }),
    ]);
    expect(r.combos).toHaveLength(2);
    expect(r.combos.map((c) => c.currency).sort()).toEqual(["EUR", "USD"]);
  });
});

/* ---------- ④ D5·R1 중량 — all-or-nothing 인쇄 규칙 ---------- */

describe("weightFillMode / weightTotal — 전 라인 입력 시에만 컬럼+TOTAL", () => {
  it("★전 라인 입력 = all → 컬럼+TOTAL 인쇄", () => {
    expect(weightFillMode([1.5, 2.5])).toBe("all");
    expect(weightTotal([1.5, 2.5])).toBe(4);
  });

  it("★일부만 입력 = partial → 컬럼 생략 + 폼 경고 (부분합 왜곡 방지)", () => {
    expect(weightFillMode([1.5, null])).toBe("partial");
  });

  it("전무 = none → 컬럼 생략 (경고 없음)", () => {
    expect(weightFillMode([null, null])).toBe("none");
    expect(weightFillMode([])).toBe("none");
  });

  it("합계는 round6 — 0.1+0.2 = 0.3", () => {
    expect(weightTotal([0.1, 0.2])).toBe(0.3);
  });
});

/* ---------- ⑤ R-정정 포장 섹션 — 포함 라인 스코프 all-or-nothing ---------- */

describe("packingFillMode — 포함 라인 전원이 (수량+유형) 보유 시에만 섹션 인쇄", () => {
  it("★전원 보유 = all", () => {
    expect(
      packingFillMode([
        { packageCount: 5, packageType: "CTN" },
        { packageCount: 2, packageType: "PLT" },
      ]),
    ).toBe("all");
  });

  it("★일부 보유 = partial → 섹션 생략 + 폼 경고", () => {
    expect(
      packingFillMode([
        { packageCount: 5, packageType: "CTN" },
        { packageCount: null, packageType: null },
      ]),
    ).toBe("partial");
  });

  it("수량만 있고 유형이 공란이면 보유가 아니다", () => {
    expect(packingFillMode([{ packageCount: 5, packageType: "  " }])).toBe("none");
  });

  it("수량 0도 보유가 아니다 (S/I 총계 규칙과 동일)", () => {
    expect(packingFillMode([{ packageCount: 0, packageType: "CTN" }])).toBe("none");
  });

  it("전무 = none → 섹션 생략", () => {
    expect(packingFillMode([{ packageCount: null, packageType: null }])).toBe("none");
    expect(packingFillMode([])).toBe("none");
  });
});

/* ---------- ⑥ (커밋 c) 발행 폼 결선용 — 조합 스코프 필터·할인 엔트리 구성 ---------- */

describe("linesForCombo — (선적×고객×통화) 스코프의 클라이언트 미러 (D4)", () => {
  const mk = (
    orderType: "SO" | "PO",
    customerId: string | null,
    currency: string | null,
    tag: string,
  ) => ({ orderType, customerId, currency, tag });

  it("★같은 (고객,통화) SO 라인만 남긴다 — PO·타 고객·타 통화 제외", () => {
    const rows = [
      mk("SO", "cust-a", "USD", "keep-1"),
      mk("PO", "cust-a", "USD", "po"),
      mk("SO", "cust-b", "USD", "other-cust"),
      mk("SO", "cust-a", "EUR", "other-cur"),
      mk("SO", "cust-a", "USD", "keep-2"),
    ];
    expect(linesForCombo(rows, "cust-a", "USD").map((r) => r.tag)).toEqual([
      "keep-1",
      "keep-2",
    ]);
  });

  it("★통화 공란(null·공백) SO 는 어떤 조합에도 안 들어간다 (서버도 거부)", () => {
    const rows = [
      mk("SO", "cust-a", null, "null-cur"),
      mk("SO", "cust-a", "  ", "blank-cur"),
    ];
    expect(linesForCombo(rows, "cust-a", "USD")).toEqual([]);
  });

  it("통화는 공백을 다듬어 비교한다 (' USD ' == 'USD')", () => {
    const rows = [mk("SO", "cust-a", " USD ", "trimmed")];
    expect(linesForCombo(rows, "cust-a", "USD").map((r) => r.tag)).toEqual([
      "trimmed",
    ]);
  });

  it("고객 미상(null) 라인은 제외", () => {
    const rows = [mk("SO", null, "USD", "no-cust")];
    expect(linesForCombo(rows, "cust-a", "USD")).toEqual([]);
  });
});

describe("discountEntriesOf — 주문별 문서 포함 금액 누적 (서버 v_so_amounts 미러)", () => {
  const mk = (
    soId: string | null,
    soNumber: string | null,
    qty: number,
    unitPrice: number | null,
    soDiscount: number,
    soOrderTotal: number,
  ): DiscountSourceLine => ({ soId, soNumber, qty, unitPrice, soDiscount, soOrderTotal });

  it("★같은 주문의 라인 금액을 누적한다 — docAmount = Σ round2(qty×단가)", () => {
    const entries = discountEntriesOf([
      mk("so-1", "SO-1", 2, 10, 100, 1000), // 20
      mk("so-1", "SO-1", 3, 5, 100, 1000), // 15
    ]);
    expect(entries).toEqual([
      { soNumber: "SO-1", discount: 100, docAmount: 35, orderTotal: 1000 },
    ]);
  });

  it("★다중 주문은 등장 순서대로 각자 엔트리 (서버 array_position 미러)", () => {
    const entries = discountEntriesOf([
      mk("so-2", "SO-2", 1, 100, 30, 300),
      mk("so-1", "SO-1", 2, 10, 100, 1000),
      mk("so-2", "SO-2", 1, 50, 30, 300),
    ]);
    expect(entries.map((e) => e.soNumber)).toEqual(["SO-2", "SO-1"]);
    expect(entries[0].docAmount).toBe(150);
    expect(entries[1].docAmount).toBe(20);
  });

  it("★부동소수 무오차 — 0.1×3 라인 누적도 round2 로 결정적", () => {
    const entries = discountEntriesOf([
      mk("so-1", "SO-1", 3, 0.1, 1, 10), // 0.3
      mk("so-1", "SO-1", 3, 0.1, 1, 10), // 0.3
    ]);
    expect(entries[0].docAmount).toBe(0.6);
  });

  it("주문 미상(soId null)·단가 미상(unitPrice null) 라인은 미리보기에서 뺀다(서버가 발행 거부할 라인)", () => {
    const entries = discountEntriesOf([
      mk(null, null, 1, 10, 0, 0),
      mk("so-1", "SO-1", 1, null, 100, 1000),
      mk("so-1", "SO-1", 2, 10, 100, 1000),
    ]);
    expect(entries).toEqual([
      { soNumber: "SO-1", discount: 100, docAmount: 20, orderTotal: 1000 },
    ]);
  });

  it("allocateDiscounts 와 결합 — 전량 포함 = 주문 할인 그대로", () => {
    const entries = discountEntriesOf([
      mk("so-1", "SO-1", 2, 250, 40, 1000),
      mk("so-1", "SO-1", 1, 500, 40, 1000),
    ]);
    expect(allocateDiscounts(entries).discount).toBe(40);
  });
});

/* ---------- ⑦ 적대검증 교정 — pg round(numeric,2) 동치 (half away from zero·십진 정확) ---------- */

describe("lineAmount — 서버 round(qty×단가, 2) 와 .xx5 경계에서도 동치", () => {
  it("★0.5 × 4.27 = 2.135 → 2.14 (double 곱 2.1349…의 내림 방지)", () => {
    expect(lineAmount(0.5, 4.27)).toBe(2.14);
  });

  it("★8.7 × 1.15 = 10.005 → 10.01", () => {
    expect(lineAmount(8.7, 1.15)).toBe(10.01);
  });

  it("경계 아닌 값은 기존과 동일", () => {
    expect(lineAmount(3, 19.99)).toBe(59.97);
    expect(lineAmount(0.1, 3)).toBe(0.3);
  });
});

describe("allocateDiscounts — 서버 round(discount×docAmount÷orderTotal, 2) 동치", () => {
  it("★2.90 × 3 ÷ 4 = 2.175 → 2.18 (half away from zero)", () => {
    const r = allocateDiscounts([
      { soNumber: "SO-1", discount: 2.9, docAmount: 3, orderTotal: 4 },
    ]);
    expect(r.discount).toBe(2.18);
  });

  it("★음수 할인도 0 반대쪽으로 — -0.05 × 1 ÷ 2 = -0.025 → -0.03", () => {
    const r = allocateDiscounts([
      { soNumber: "SO-1", discount: -0.05, docAmount: 1, orderTotal: 2 },
    ]);
    expect(r.discount).toBe(-0.03);
    expect(r.warnings).toHaveLength(1); // 음수 경고는 유지
  });

  it("-0.03 × 1 ÷ 2 = -0.015 → -0.02", () => {
    const r = allocateDiscounts([
      { soNumber: "SO-1", discount: -0.03, docAmount: 1, orderTotal: 2 },
    ]);
    expect(r.discount).toBe(-0.02);
  });

  it("비종결 소수(1/3)는 양쪽 다 3.33 — 기존 동작 유지", () => {
    const r = allocateDiscounts([
      { soNumber: "SO-1", discount: 10, docAmount: 1, orderTotal: 3 },
    ]);
    expect(r.discount).toBe(3.33);
  });
});

describe("subtotalOf/discountEntriesOf — .xx5 라인 누적도 서버와 동치", () => {
  it("★subtotal: 2.135 라인 2건 → 2.14 + 2.14 = 4.28", () => {
    expect(
      subtotalOf([
        { qty: 0.5, unitPrice: 4.27 },
        { qty: 0.5, unitPrice: 4.27 },
      ]),
    ).toBe(4.28);
  });

  it("★discountEntriesOf docAmount 도 라인별 서버 반올림 후 누적", () => {
    const entries = discountEntriesOf([
      { soId: "so-1", soNumber: "SO-1", qty: 0.5, unitPrice: 4.27, soDiscount: 0, soOrderTotal: 10 },
      { soId: "so-1", soNumber: "SO-1", qty: 8.7, unitPrice: 1.15, soDiscount: 0, soOrderTotal: 10 },
    ]);
    expect(entries[0].docAmount).toBe(12.15); // 2.14 + 10.01
  });
});
