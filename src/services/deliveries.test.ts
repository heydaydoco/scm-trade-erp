import { describe, it, expect } from "vitest";
import {
  shippedQtyOf,
  openQtyOf,
  isOverDelivery,
  prefillQty,
  soStatusFrom,
  projectStockByItem,
  shortagesOf,
  type DeliveryQtyLike,
} from "./deliveries";

/**
 * P4.3 출고(Delivery) — 순수 로직 정합성 테스트 (SPEC §8: "코드 전에 작성").
 *
 * SPEC §8 원문 시나리오를 그대로 코드화한다:
 *   "주문 10 → 출고 4+6 → 잔량 0 → 초과출고 거부"
 *   ⚠️ 단 "초과출고 거부"는 P4 에서 **경고 후 허용**으로 확정됐다(원칙 8과 같은 결).
 *      공급사·현장 실무에서 막으면 출고 자체를 못 친다. 판정만 하고 막지 않는다.
 *
 * ★ 이 단계의 고유 함정: **같은 품목이 여러 수주 라인에 걸린 경우**.
 *   라인별로 재고를 보면 각각은 통과하는데 합치면 마이너스가 된다 → 품목별 합산이 필수.
 */

const live = (qty: number): DeliveryQtyLike => ({ qty, cancelled: false });
const dead = (qty: number): DeliveryQtyLike => ({ qty, cancelled: true });

describe("shippedQtyOf / openQtyOf — 잔량 = 수주수량 − Σ(살아있는 출고)", () => {
  it("★SPEC §8: 주문 10 → 출고 4+6 → 잔량 0", () => {
    expect(openQtyOf(10, [])).toBe(10);
    expect(openQtyOf(10, [live(4)])).toBe(6);
    expect(openQtyOf(10, [live(4), live(6)])).toBe(0);
  });

  it("★취소된 출고는 없던 일 → 잔량 복원", () => {
    expect(shippedQtyOf([live(4), dead(6)])).toBe(4);
    expect(openQtyOf(10, [live(4), dead(6)])).toBe(6);
    expect(openQtyOf(10, [dead(4), dead(6)])).toBe(10);
  });

  it("부분출고 3회 후 잔량 0", () => {
    expect(openQtyOf(100, [live(30), live(50), live(20)])).toBe(0);
  });

  it("초과출고하면 잔량이 음수 (막지 않는다)", () => {
    expect(openQtyOf(10, [live(15)])).toBe(-5);
  });

  it("소수 수량 부동소수 오차 없음", () => {
    expect(shippedQtyOf([live(0.1), live(0.2)])).toBe(0.3);
  });
});

describe("isOverDelivery / prefillQty", () => {
  it("잔량 이내는 경고 없음, 초과면 경고", () => {
    expect(isOverDelivery(10, 10)).toBe(false);
    expect(isOverDelivery(10, 11)).toBe(true);
    expect(isOverDelivery(0, 1)).toBe(true);
  });

  it("이미 초과라 잔량이 음수면 0으로 프리필", () => {
    expect(prefillQty(-5)).toBe(0);
    expect(prefillQty(6)).toBe(6);
  });
});

describe("soStatusFrom — 수주 상태 자동전환 (RPC 미러)", () => {
  it("출고 0 → 세대 도장 값으로 복귀", () => {
    expect(soStatusFrom(10, 0, "confirmed")).toBe("confirmed");
    expect(soStatusFrom(10, 0, "draft")).toBe("draft");
  });

  it("★도장이 없으면 건드리지 않는다(null)", () => {
    expect(soStatusFrom(10, 0, null)).toBeNull();
  });

  it("일부 출고 → partial(기계 전용) / 잔량 0 → completed", () => {
    expect(soStatusFrom(10, 4, "confirmed")).toBe("partial");
    expect(soStatusFrom(10, 10, "confirmed")).toBe("completed");
  });

  it("초과출고도 completed", () => {
    expect(soStatusFrom(10, 15, "confirmed")).toBe("completed");
  });
});

/* ---------- ★ P4.3 고유: 마이너스 재고 예상 집계 ---------- */

describe("projectStockByItem — 같은 품목 여러 라인은 합산해야 한다", () => {
  const onHand = { A: 10, B: 3 };

  it("품목 하나, 라인 하나", () => {
    const r = projectStockByItem(
      [{ itemId: "A", itemName: "볼트", qty: 4, uom: "PCS" }],
      onHand,
    );
    expect(r).toEqual([
      { itemId: "A", itemName: "볼트", uom: "PCS", onHand: 10, outQty: 4, projected: 6 },
    ]);
  });

  it("★같은 품목이 두 라인에 → 합산해서 하나로 (이게 이 단계의 함정)", () => {
    // 라인별로 보면 6도 5도 각각 재고 10 이내라 통과처럼 보인다.
    // 합치면 11 > 10 이라 −1 이 된다.
    const r = projectStockByItem(
      [
        { itemId: "A", itemName: "볼트", qty: 6, uom: "PCS" },
        { itemId: "A", itemName: "볼트", qty: 5, uom: "PCS" },
      ],
      onHand,
    );
    expect(r).toHaveLength(1);
    expect(r[0].outQty).toBe(11);
    expect(r[0].projected).toBe(-1);
  });

  it("서로 다른 품목은 각각", () => {
    const r = projectStockByItem(
      [
        { itemId: "A", itemName: "볼트", qty: 4, uom: "PCS" },
        { itemId: "B", itemName: "너트", qty: 1, uom: "PCS" },
      ],
      onHand,
    );
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.itemId === "A")!.projected).toBe(6);
    expect(r.find((x) => x.itemId === "B")!.projected).toBe(2);
  });

  it("재고 기록이 없는 품목은 0으로 본다", () => {
    const r = projectStockByItem(
      [{ itemId: "Z", itemName: "신품목", qty: 3, uom: "PCS" }],
      onHand,
    );
    expect(r[0].onHand).toBe(0);
    expect(r[0].projected).toBe(-3);
  });

  it("수량 0/빈 줄은 무시한다 (이번에 안 내보내는 품목)", () => {
    const r = projectStockByItem(
      [
        { itemId: "A", itemName: "볼트", qty: 0, uom: "PCS" },
        { itemId: "B", itemName: "너트", qty: 1, uom: "PCS" },
      ],
      onHand,
    );
    expect(r).toHaveLength(1);
    expect(r[0].itemId).toBe("B");
  });

  it("소수 수량 합산도 오차 없이", () => {
    const r = projectStockByItem(
      [
        { itemId: "A", itemName: "볼트", qty: 0.1, uom: "PCS" },
        { itemId: "A", itemName: "볼트", qty: 0.2, uom: "PCS" },
      ],
      { A: 1 },
    );
    expect(r[0].outQty).toBe(0.3);
    expect(r[0].projected).toBe(0.7);
  });
});

describe("shortagesOf — 마이너스가 되는 품목만 (원칙 8 경고 대상)", () => {
  it("전부 재고 이내면 경고 없음", () => {
    const r = shortagesOf(
      [{ itemId: "A", itemName: "볼트", qty: 4, uom: "PCS" }],
      { A: 10 },
    );
    expect(r).toEqual([]);
  });

  it("★합산해서 마이너스가 되는 품목만 골라낸다", () => {
    const r = shortagesOf(
      [
        { itemId: "A", itemName: "볼트", qty: 6, uom: "PCS" },
        { itemId: "A", itemName: "볼트", qty: 5, uom: "PCS" },
        { itemId: "B", itemName: "너트", qty: 1, uom: "PCS" },
      ],
      { A: 10, B: 3 },
    );
    expect(r).toHaveLength(1);
    expect(r[0].itemId).toBe("A");
    expect(r[0].projected).toBe(-1);
  });

  it("정확히 0이 되는 건 경고 아님 (마이너스가 아니다)", () => {
    const r = shortagesOf(
      [{ itemId: "A", itemName: "볼트", qty: 10, uom: "PCS" }],
      { A: 10 },
    );
    expect(r).toEqual([]);
  });

  it("이미 마이너스인 재고에서 더 내보내면 경고", () => {
    const r = shortagesOf(
      [{ itemId: "A", itemName: "볼트", qty: 1, uom: "PCS" }],
      { A: -5 },
    );
    expect(r[0].projected).toBe(-6);
  });
});
