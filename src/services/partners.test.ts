import { describe, it, expect } from "vitest";
import {
  companyNameError,
  mapCompanyTypeToPartnerType,
  mapPartnerTypeToCompanyType,
} from "./partners";

/**
 * P4.4h 거래처 저장(save_company RPC 전환) — 순수 로직 정합성 테스트.
 *
 * 여기서 지키는 것:
 *   · 봉인 이후 유일한 쓰기 경로인 save_company 의 필수값 거부(상호명 공란 RAISE)를
 *     서비스 미러(companyNameError)가 같은 메시지로 선차단한다 — 거부 경로 실제 실행.
 *   · company_type 매핑 왕복 — '미분류(unknown)'는 저장 시 null 로 보내 RPC 가
 *     기존 분류를 보존한다(덮어쓰기 금지 규칙의 전제).
 *
 * ⚠️ 이 테스트는 DB를 부르지 않는다. 권한 봉인(REVOKE)·RPC RAISE 자체는
 *    scripts/verify_seal.sql + 마이그레이션 감사 SELECT 가 담당한다(역할 분리).
 */

describe("companyNameError — save_company 필수값 RAISE 의 미러", () => {
  it("★공란 상호명은 거부한다 (RPC '거래처명은 필수 항목입니다.' 와 동일 문구)", () => {
    expect(companyNameError("")).toBe("거래처명은 필수 항목입니다.");
  });

  it("★공백만 있는 상호명도 거부한다 (trim 후 공란 = 공란)", () => {
    expect(companyNameError("   ")).toBe("거래처명은 필수 항목입니다.");
    expect(companyNameError("\t")).toBe("거래처명은 필수 항목입니다.");
  });

  it("정상 상호명은 통과한다 (null 반환 = 저장 진행)", () => {
    expect(companyNameError("한빛무역")).toBeNull();
    expect(companyNameError(" ACME Corp ")).toBeNull(); // 앞뒤 공백은 저장 시 trim
  });
});

describe("company_type 매핑 왕복 — 미분류는 덮어쓰지 않는다", () => {
  it("customer ↔ buyer, supplier ↔ supplier, both ↔ both", () => {
    expect(mapPartnerTypeToCompanyType("customer")).toBe("buyer");
    expect(mapPartnerTypeToCompanyType("supplier")).toBe("supplier");
    expect(mapPartnerTypeToCompanyType("both")).toBe("both");
    expect(mapCompanyTypeToPartnerType("buyer")).toBe("customer");
    expect(mapCompanyTypeToPartnerType("supplier")).toBe("supplier");
    expect(mapCompanyTypeToPartnerType("both")).toBe("both");
  });

  it("★DB 의 null·예상밖 값은 '미분류'로 읽는다 (buyer 로 오인하지 않는다)", () => {
    // 미분류는 저장 시 p_company_type=null → RPC 의 coalesce 가 기존 분류를 보존한다.
    expect(mapCompanyTypeToPartnerType(null)).toBe("unknown");
    expect(mapCompanyTypeToPartnerType("")).toBe("unknown");
    expect(mapCompanyTypeToPartnerType("weird")).toBe("unknown");
  });

  it("과거 표기 customer/vendor 도 표준으로 읽는다", () => {
    expect(mapCompanyTypeToPartnerType("customer")).toBe("customer");
    expect(mapCompanyTypeToPartnerType("vendor")).toBe("supplier");
  });
});
