import { describe, it, expect } from "vitest";
import {
  signedQty,
  isReversible,
  projectedOnHand,
  defaultMovedAt,
  MOVEMENT_TYPES,
  movementTypeOf,
  isInbound,
  resolveAdjustmentUom,
} from "./stock";

/**
 * P4.1 재고 원장 — 순수 로직 정합성 테스트 (SPEC §8: "코드 전에 작성").
 *
 * 여기서 지키는 것(원칙 1):
 *   · 부호는 화면이 아니라 유형이 결정한다 → "감소인데 +30" 이 구조적으로 불가능.
 *   · 정정은 UPDATE가 아니라 역분개 → 역분개 가능 판정이 틀리면 원장이 오염된다.
 *   · 마이너스 재고는 차단이 아니라 경고 후 허용(원칙 8) → 예상재고 계산이 경고의 근거.
 *   · 증빙일 기본값은 반드시 KST(P4.0-a와 같은 규칙).
 *
 * ⚠️ 이 테스트는 DB를 부르지 않는다. 권한 봉인·이중 역분개 UNIQUE 같은
 *    DB 불변식은 scripts/checks.sql 이 담당한다(역할 분리).
 */

describe("signedQty — 부호는 유형이 결정한다", () => {
  it("기초재고(INIT)는 양수", () => {
    expect(signedQty("INIT", 100)).toBe(100);
  });

  it("조정 증가(ADJ_IN)는 양수", () => {
    expect(signedQty("ADJ_IN", 30)).toBe(30);
  });

  it("★조정 감소(ADJ_OUT)만 음수로 뒤집는다", () => {
    expect(signedQty("ADJ_OUT", 30)).toBe(-30);
  });

  it("입고(GR_IN)는 양수 — P4.2", () => {
    expect(signedQty("GR_IN", 50)).toBe(50);
  });

  it("출고(DLV_OUT)는 음수 — P4.3", () => {
    expect(signedQty("DLV_OUT", 50)).toBe(-50);
  });

  it("★화면이 음수를 보내도 유형이 이긴다 (모순 입력 방어)", () => {
    // 폼은 항상 양수만 보내지만, 만에 하나 음수가 와도 유형이 부호를 정한다.
    expect(signedQty("ADJ_IN", -30)).toBe(30);
    expect(signedQty("ADJ_OUT", -30)).toBe(-30);
  });

  it("수량 0은 거부한다 (원장에 무의미한 행)", () => {
    expect(() => signedQty("ADJ_IN", 0)).toThrow();
  });

  it("REVERSAL은 이 함수로 만들지 않는다 (역분개 RPC 전용)", () => {
    expect(() => signedQty("REVERSAL", 10)).toThrow();
  });
});

describe("isInbound — 재고가 늘어나는 유형인가", () => {
  it("INIT·ADJ_IN·GR_IN은 입고", () => {
    expect(isInbound("INIT")).toBe(true);
    expect(isInbound("ADJ_IN")).toBe(true);
    expect(isInbound("GR_IN")).toBe(true);
  });

  it("ADJ_OUT·DLV_OUT은 출고", () => {
    expect(isInbound("ADJ_OUT")).toBe(false);
    expect(isInbound("DLV_OUT")).toBe(false);
  });
});

describe("isReversible — 역분개 가능 판정", () => {
  it("수동 조정 행은 역분개 가능", () => {
    expect(
      isReversible({ movementType: "ADJ_OUT", reversedById: null, refDocType: null }),
    ).toBe(true);
  });

  it("★역분개 행은 다시 역분개할 수 없다 (사슬 금지)", () => {
    expect(
      isReversible({ movementType: "REVERSAL", reversedById: null, refDocType: null }),
    ).toBe(false);
  });

  it("★이미 역분개된 행은 두 번 못 한다", () => {
    expect(
      isReversible({ movementType: "ADJ_IN", reversedById: "some-uuid", refDocType: null }),
    ).toBe(false);
  });

  it("역분개 행이면서 이미 역분개된 경우도 당연히 불가", () => {
    expect(
      isReversible({ movementType: "REVERSAL", reversedById: "x", refDocType: null }),
    ).toBe(false);
  });

  /**
   * ★ P4.2f 교착 방지 — 전표(입고 등)가 만든 행은 원장에서 직접 되돌리면 안 된다.
   * 원장만 되돌리면 입고는 'normal' 로 남아 잔량·발주상태·잠금과 어긋나고,
   * 그 뒤 [입고 취소]가 "이미 역분개된 행"으로 실패해 복구가 영원히 막힌다.
   */
  it("★전표가 만든 행(GR_IN)은 원장에서 직접 역분개 불가 — 전표에서 취소해야 한다", () => {
    expect(
      isReversible({
        movementType: "GR_IN",
        reversedById: null,
        refDocType: "goods_receipt",
      }),
    ).toBe(false);
  });

  it("★P4.3 출고(DLV_OUT)도 같은 규칙", () => {
    expect(
      isReversible({
        movementType: "DLV_OUT",
        reversedById: null,
        refDocType: "delivery",
      }),
    ).toBe(false);
  });

  it("유형이 GR_IN 이라도 전표 참조가 없으면(수동 전기) 역분개 가능", () => {
    // 판정 기준은 유형이 아니라 "전표에서 왔는가"다.
    expect(
      isReversible({ movementType: "GR_IN", reversedById: null, refDocType: null }),
    ).toBe(true);
  });

  it("모든 유형에 대해 판정이 정의돼 있다", () => {
    for (const t of MOVEMENT_TYPES) {
      const r = isReversible({
        movementType: t.code,
        reversedById: null,
        refDocType: null,
      });
      expect(typeof r).toBe("boolean");
    }
  });
});

describe("projectedOnHand — 저장 전 예상재고 (원칙 8 경고의 근거)", () => {
  it("증가는 더한다", () => {
    expect(projectedOnHand(70, "ADJ_IN", 30)).toBe(100);
  });

  it("감소는 뺀다", () => {
    expect(projectedOnHand(100, "ADJ_OUT", 30)).toBe(70);
  });

  it("★현재고보다 많이 빼면 음수가 된다 — 차단이 아니라 경고 대상(원칙 8)", () => {
    expect(projectedOnHand(100, "ADJ_OUT", 500)).toBe(-400);
  });

  it("재고가 없는 품목의 기초재고", () => {
    expect(projectedOnHand(0, "INIT", 100)).toBe(100);
  });

  it("이미 마이너스인 재고에서 더 빼기", () => {
    expect(projectedOnHand(-10, "ADJ_OUT", 5)).toBe(-15);
  });

  it("소수 수량도 부동소수 오차 없이", () => {
    // 0.1 + 0.2 = 0.30000000000000004 함정
    expect(projectedOnHand(0.1, "ADJ_IN", 0.2)).toBe(0.3);
  });
});

describe("defaultMovedAt — 증빙일 기본값은 한국 날짜", () => {
  it("UTC 14:59:59 → 같은 날 (KST 23:59:59)", () => {
    expect(defaultMovedAt(new Date("2026-07-31T14:59:59Z"))).toBe("2026-07-31");
  });

  it("★UTC 15:00:00 → 한국은 이미 다음날 (경계)", () => {
    expect(defaultMovedAt(new Date("2026-07-31T15:00:00Z"))).toBe("2026-08-01");
  });

  it("한국 오전 8시(=UTC 전날 23시)에 조정하면 오늘 날짜여야 한다", () => {
    // 서버가 UTC라 이 방어가 없으면 증빙일이 '어제'로 찍힌다.
    expect(defaultMovedAt(new Date("2026-08-01T23:00:00Z"))).toBe("2026-08-02");
  });
});

describe("movementTypeOf — 코드 → 라벨·색 조회", () => {
  it("6종이 전부 정의돼 있다", () => {
    expect(MOVEMENT_TYPES).toHaveLength(6);
    const codes = MOVEMENT_TYPES.map((m) => m.code).sort();
    expect(codes).toEqual(
      ["ADJ_IN", "ADJ_OUT", "DLV_OUT", "GR_IN", "INIT", "REVERSAL"].sort(),
    );
  });

  it("알 수 없는 코드는 원본을 돌려준다 (화면이 죽지 않게)", () => {
    expect(movementTypeOf("NOPE").label).toBe("NOPE");
  });

  it("각 유형의 sign이 signedQty와 일치한다 (단일 진실)", () => {
    for (const t of MOVEMENT_TYPES) {
      if (t.code === "REVERSAL") continue; // ± 둘 다 가능
      expect(t.sign).toBe(signedQty(t.code, 1));
    }
  });
});

/* ---------- P4.4h 조정 단위 체인 — save_stock_adjustment 거부 경로의 미러 ---------- */
//  coalesce(products.unit,'PCS') 발명이 제거됐다. 새 체인: 입력 unit →
//  products.unit → 저장 거부(RAISE). 규칙은 P4.3f 폴백 체인과 동일(단일 진실).
describe("resolveAdjustmentUom — 조정 단위는 지어내지 않는다", () => {
  it("입력 unit 이 있으면 그것이 이긴다 (원천 라인이 없는 조정의 1순위)", () => {
    expect(resolveAdjustmentUom("BOX", "EA")).toBe("BOX");
  });

  it("입력 unit 이 없으면 품목 마스터 unit", () => {
    expect(resolveAdjustmentUom(null, "EA")).toBe("EA");
  });

  it("★둘 다 없으면 null — RPC '단위를 알 수 없어 저장할 수 없습니다' RAISE 에 양보 ('PCS' 발명 금지)", () => {
    expect(resolveAdjustmentUom(null, null)).toBeNull();
  });

  it("★공란/공백 = 없음 — '' 마스터가 유효 단위로 오인되지 않는다 (nullif+btrim 규칙)", () => {
    expect(resolveAdjustmentUom("", "  ")).toBeNull();
    expect(resolveAdjustmentUom("  ", "EA")).toBe("EA");
    expect(resolveAdjustmentUom(" BOX ", null)).toBe("BOX"); // trim 해서 채택
  });
});
