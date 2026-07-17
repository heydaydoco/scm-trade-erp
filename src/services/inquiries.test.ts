import { describe, it, expect } from "vitest";
import { inquiryRequiredError } from "./inquiries";

/**
 * P4.4h 문의 저장(save_inquiry RPC 전환) — 순수 로직 정합성 테스트.
 *
 * 문의는 문서 사슬의 기점(문의→견적 참조생성)이라 봉인 목록에 추가됐다(판정 3).
 * save_inquiry 의 필수값 거부(거래처·품목명·접수일)를 서비스 미러가 같은 메시지로
 * 선차단한다 — 거부 경로 실제 실행. 검증 수준은 현행 폼 그대로(과잉 검증 없음).
 *
 * ⚠️ 이 테스트는 DB를 부르지 않는다. inquiries 봉인·RPC RAISE 자체는
 *    scripts/verify_seal.sql + 마이그레이션 감사 SELECT 가 담당한다(역할 분리).
 */

const valid = {
  partnerId: "c-1",
  productName: "무선 충전기",
  inquiryDate: "2026-07-17",
};

describe("inquiryRequiredError — save_inquiry 필수값 RAISE 의 미러", () => {
  it("★거래처 없으면 거부 (RPC '거래처를 선택하세요.' 와 동일 문구)", () => {
    expect(inquiryRequiredError({ ...valid, partnerId: null })).toBe(
      "거래처를 선택하세요.",
    );
  });

  it("★품목명 공란이면 거부 (trim 후 공란 = 공란)", () => {
    expect(inquiryRequiredError({ ...valid, productName: "" })).toBe(
      "품목명을 입력하세요.",
    );
    expect(inquiryRequiredError({ ...valid, productName: "  " })).toBe(
      "품목명을 입력하세요.",
    );
  });

  it("★접수일 없으면 거부", () => {
    expect(inquiryRequiredError({ ...valid, inquiryDate: null })).toBe(
      "접수일을 입력하세요.",
    );
  });

  it("필수 3종이 모두 있으면 통과한다 (null 반환 = 저장 진행 — 정상 경로)", () => {
    expect(inquiryRequiredError(valid)).toBeNull();
  });

  it("검사 순서는 폼과 같다 — 거래처가 먼저다", () => {
    // 여러 필수값이 동시에 비어도 안내는 한 번에 하나, 폼과 같은 순서로.
    expect(
      inquiryRequiredError({ partnerId: null, productName: "", inquiryDate: null }),
    ).toBe("거래처를 선택하세요.");
  });
});
