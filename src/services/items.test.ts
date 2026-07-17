import { describe, it, expect } from "vitest";
import { itemNameError, normalizeUnit } from "./items";

/**
 * P4.4h 품목 저장(save_item RPC 전환) — 순수 로직 정합성 테스트.
 *
 * 여기서 지키는 것:
 *   · save_item 의 필수값 거부(품목명 공란 RAISE)를 서비스 미러가 같은 메시지로
 *     선차단한다 — 거부 경로 실제 실행.
 *   · ★unit 은 공란=없음(NULL) 로 정규화해 저장한다 — nullif(btrim(unit),'') 미러.
 *     '' 가 마스터에 저장되면 uom 폴백 체인(라인 uom → products.unit)이 이를
 *     "유효 단위"로 오인해 원장에 빈 단위가 박힌다(P4.4h 가 닫은 구멍).
 *
 * ⚠️ 이 테스트는 DB를 부르지 않는다. products 봉인·RPC RAISE 자체는
 *    scripts/verify_seal.sql + 마이그레이션 감사 SELECT 가 담당한다(역할 분리).
 */

describe("itemNameError — save_item 필수값 RAISE 의 미러", () => {
  it("★공란 품목명은 거부한다 (RPC '품목명은 필수 항목입니다.' 와 동일 문구)", () => {
    expect(itemNameError("")).toBe("품목명은 필수 항목입니다.");
    expect(itemNameError("   ")).toBe("품목명은 필수 항목입니다.");
  });

  it("정상 품목명은 통과한다 (null 반환 = 저장 진행)", () => {
    expect(itemNameError("스테인리스 볼트 M8")).toBeNull();
  });
});

describe("normalizeUnit — unit 공란은 NULL 로 (빈 문자열 저장 금지)", () => {
  it("★빈 문자열·공백만은 null (uom 체인이 '' 를 단위로 오인하지 않게)", () => {
    expect(normalizeUnit("")).toBeNull();
    expect(normalizeUnit("   ")).toBeNull();
    expect(normalizeUnit("\t ")).toBeNull();
  });

  it("null 은 그대로 null", () => {
    expect(normalizeUnit(null)).toBeNull();
  });

  it("정상 단위는 trim 해서 통과한다 (정상 저장 경로)", () => {
    expect(normalizeUnit("EA")).toBe("EA");
    expect(normalizeUnit(" KG ")).toBe("KG"); // RPC 의 btrim 과 같은 규칙
  });
});
