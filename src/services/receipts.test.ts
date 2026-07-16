import { describe, it, expect } from "vitest";
import {
  receivedQtyOf,
  openQtyOf,
  isOverReceipt,
  prefillQty,
  poStatusFrom,
  type ReceiptQtyLike,
} from "./receipts";

/**
 * P4.2 입고(GR) — 순수 로직 정합성 테스트 (SPEC §8: "코드 전에 작성").
 *
 * SPEC §8 이 못박은 시나리오를 여기서 코드화한다:
 *   "주문 10 → 출고 4+6 → 잔량 0 → 초과출고 거부 / 부분입고 3회 후 잔량 0 /
 *    역방향 정정 후 잔량 복원"
 * (입고판 = 발주 10 → 입고 4+6 → 잔량 0 / 부분입고 3회 → 잔량 0 / 취소 후 잔량 복원)
 *
 * ⚠️ 원칙 1: 잔량은 컬럼이 아니라 **계산**이다. received_qty 를 po_lines 에 저장하지 않는다.
 * ⚠️ 원칙 8: 초과입고는 **차단이 아니라 경고 후 허용**. 판정만 하고 막지 않는다.
 * ⚠️ DB 불변식(원자성·이중취소·가드)은 scripts/checks.sql 담당(역할 분리).
 */

const live = (qty: number): ReceiptQtyLike => ({ qty, cancelled: false });
const dead = (qty: number): ReceiptQtyLike => ({ qty, cancelled: true });

describe("receivedQtyOf — 취소된 입고는 없던 일", () => {
  it("입고 없으면 0", () => {
    expect(receivedQtyOf([])).toBe(0);
  });

  it("살아있는 입고만 합산", () => {
    expect(receivedQtyOf([live(4), live(6)])).toBe(10);
  });

  it("★취소된 입고는 빠진다 (상쇄)", () => {
    expect(receivedQtyOf([live(4), dead(6)])).toBe(4);
  });

  it("전부 취소되면 0으로 복원", () => {
    expect(receivedQtyOf([dead(4), dead(6)])).toBe(0);
  });

  it("소수 수량도 부동소수 오차 없이", () => {
    expect(receivedQtyOf([live(0.1), live(0.2)])).toBe(0.3);
  });
});

describe("openQtyOf — 잔량 = 발주수량 − Σ(살아있는 입고)", () => {
  it("입고 전 잔량은 발주수량 그대로", () => {
    expect(openQtyOf(10, [])).toBe(10);
  });

  it("★SPEC §8: 발주 10 → 입고 4+6 → 잔량 0", () => {
    expect(openQtyOf(10, [live(4)])).toBe(6);
    expect(openQtyOf(10, [live(4), live(6)])).toBe(0);
  });

  it("★부분입고 3회 후 잔량 0", () => {
    expect(openQtyOf(100, [live(30)])).toBe(70);
    expect(openQtyOf(100, [live(30), live(50)])).toBe(20);
    expect(openQtyOf(100, [live(30), live(50), live(20)])).toBe(0);
  });

  it("★취소하면 잔량이 복원된다", () => {
    expect(openQtyOf(10, [live(4), live(6)])).toBe(0);
    expect(openQtyOf(10, [live(4), dead(6)])).toBe(6); // 두번째 입고 취소 → 잔량 6 복원
    expect(openQtyOf(10, [dead(4), dead(6)])).toBe(10); // 전량 취소 → 원상
  });

  it("초과입고하면 잔량이 음수가 된다 (막지 않는다 — 원칙 8)", () => {
    expect(openQtyOf(10, [live(15)])).toBe(-5);
  });

  it("발주수량이 null/0 인 라인", () => {
    expect(openQtyOf(0, [])).toBe(0);
  });
});

describe("isOverReceipt — 초과입고 경고 판정 (차단 아님)", () => {
  it("잔량 이내는 경고 없음", () => {
    expect(isOverReceipt(10, 10)).toBe(false);
    expect(isOverReceipt(10, 3)).toBe(false);
  });

  it("★잔량 초과면 경고", () => {
    expect(isOverReceipt(10, 11)).toBe(true);
  });

  it("★잔량이 이미 0인데 더 넣으면 경고", () => {
    expect(isOverReceipt(0, 1)).toBe(true);
  });

  it("잔량이 이미 음수면 어떤 수량이든 경고", () => {
    expect(isOverReceipt(-5, 1)).toBe(true);
  });

  it("경계: 잔량과 정확히 같으면 경고 없음", () => {
    expect(isOverReceipt(7.5, 7.5)).toBe(false);
  });
});

describe("prefillQty — 입고 폼 잔량 프리필", () => {
  it("잔량을 그대로 채운다 (사용자는 수량만 줄이면 된다)", () => {
    expect(prefillQty(6)).toBe(6);
  });

  it("★이미 초과입고라 잔량이 음수면 0으로 (음수를 폼에 넣지 않는다)", () => {
    expect(prefillQty(-5)).toBe(0);
  });

  it("잔량 0이면 0", () => {
    expect(prefillQty(0)).toBe(0);
  });
});

describe("poStatusFrom — 발주 상태 자동전환 (RPC 미러)", () => {
  it("입고 0 → 세대 도장 값으로 복귀", () => {
    expect(poStatusFrom(10, 0, "confirmed")).toBe("confirmed");
    expect(poStatusFrom(10, 0, "sent")).toBe("sent");
  });

  it("★도장이 없으면 상태를 바꾸지 않는다 (null 반환 = 건드리지 마라)", () => {
    expect(poStatusFrom(10, 0, null)).toBeNull();
  });

  it("일부 입고 → partial (기계 전용 상태)", () => {
    expect(poStatusFrom(10, 4, "confirmed")).toBe("partial");
  });

  it("★잔량 0 → completed", () => {
    expect(poStatusFrom(10, 10, "confirmed")).toBe("completed");
  });

  it("★초과입고도 completed (잔량 음수 = 다 받고 더 받음)", () => {
    expect(poStatusFrom(10, 15, "confirmed")).toBe("completed");
  });

  it("발주수량 0인 발주에 입고가 있으면 completed", () => {
    expect(poStatusFrom(0, 5, "confirmed")).toBe("completed");
  });
});
