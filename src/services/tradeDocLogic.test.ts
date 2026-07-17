import { describe, expect, it } from "vitest";
import {
  allocateDiscounts,
  issuableCombos,
  lineAmount,
  packingFillMode,
  subtotalOf,
  totalOf,
  weightFillMode,
  weightTotal,
  zeroPriceCount,
  type ComboSourceLine,
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
