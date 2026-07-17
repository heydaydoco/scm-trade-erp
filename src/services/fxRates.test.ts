import { describe, it, expect } from "vitest";
import { fxRateInputError, normalizeRate } from "./fxRates";

/**
 * P4.4h 환율 등록(save_fx_rate RPC 전환) — 순수 로직 정합성 테스트.
 *
 * 환율은 모든 금액 계산의 입력값 + 저장 후 불변(원칙 4·5) — anon 직접 INSERT 를
 * 봉인하고 save_fx_rate RPC 로만 쌓는다(위조 환율 주입 차단). 현행 서비스 검증은
 * RPC 로 이관됐고, 여기의 순수 미러(fxRateInputError)가 같은 메시지로 선차단한다.
 *
 * ★ 100단위 고시 함정: 정규화(rate = 고시값 ÷ 고시단위)의 저장값 계산은 RPC 가
 *   수행한다(round 6자리). normalizeRate 는 그 계산의 미러 — 폼 미리보기·테스트용.
 *
 * ⚠️ 이 테스트는 DB를 부르지 않는다. fx_rates INSERT 봉인·RPC RAISE 자체는
 *    scripts/verify_seal.sql + 마이그레이션 감사 SELECT 가 담당한다(역할 분리).
 */

const valid = {
  baseCurrency: "KRW",
  quoteCurrency: "USD",
  quotedRate: 1350,
  quoteUnit: 1,
};

describe("fxRateInputError — save_fx_rate 검증 RAISE 의 미러", () => {
  it("★대상통화 없으면 거부", () => {
    expect(fxRateInputError({ ...valid, quoteCurrency: "" })).toBe(
      "대상통화를 선택하세요.",
    );
    expect(fxRateInputError({ ...valid, quoteCurrency: "  " })).toBe(
      "대상통화를 선택하세요.",
    );
  });

  it("★기준통화 자신은 거부 — 환율은 항상 1 (RPC RAISE 와 전문 일치 — 꼬리 드리프트 방지)", () => {
    expect(fxRateInputError({ ...valid, quoteCurrency: "KRW" })).toBe(
      "기준통화(KRW)는 대장에 등록할 필요가 없습니다 — 환율은 항상 1입니다.",
    );
  });

  it("★고시단위 0 이하·비유한은 거부", () => {
    expect(fxRateInputError({ ...valid, quoteUnit: 0 })).toBe(
      "고시단위는 0보다 큰 숫자여야 합니다.",
    );
    expect(fxRateInputError({ ...valid, quoteUnit: -100 })).toBe(
      "고시단위는 0보다 큰 숫자여야 합니다.",
    );
    expect(fxRateInputError({ ...valid, quoteUnit: NaN })).toBe(
      "고시단위는 0보다 큰 숫자여야 합니다.",
    );
  });

  it("★환율 0 이하·NaN·Infinity 는 거부 (rate 양수 RAISE 의 미러)", () => {
    expect(fxRateInputError({ ...valid, quotedRate: 0 })).toBe(
      "환율은 0보다 큰 숫자로 입력하세요.",
    );
    expect(fxRateInputError({ ...valid, quotedRate: -905 })).toBe(
      "환율은 0보다 큰 숫자로 입력하세요.",
    );
    expect(fxRateInputError({ ...valid, quotedRate: NaN })).toBe(
      "환율은 0보다 큰 숫자로 입력하세요.",
    );
    expect(fxRateInputError({ ...valid, quotedRate: Infinity })).toBe(
      "환율은 0보다 큰 숫자로 입력하세요.",
    );
  });

  it("정상 입력은 통과한다 (null 반환 = 저장 진행 — 정상 경로)", () => {
    expect(fxRateInputError(valid)).toBeNull();
    expect(
      fxRateInputError({ ...valid, quoteCurrency: "JPY", quotedRate: 905, quoteUnit: 100 }),
    ).toBeNull();
  });
});

describe("normalizeRate — 100단위 고시 정규화 (RPC round(…,6) 의 미러)", () => {
  it("★100엔당 905 → 1엔당 9.05 (100배 함정 차단)", () => {
    expect(normalizeRate(905, 100)).toBe(9.05);
  });

  it("1단위 고시는 그대로", () => {
    expect(normalizeRate(1350, 1)).toBe(1350);
  });

  it("6자리 반올림 — RPC 의 round(…, 6) 과 같은 규칙", () => {
    expect(normalizeRate(1, 3)).toBe(0.333333);
  });
});
