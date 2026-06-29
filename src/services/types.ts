/**
 * 도메인 타입 — 화면과 서비스가 공유하는 "거래처(Partner)" 개념.
 *
 * SPEC 원칙 7: 화면은 물리 테이블(companies)이 아니라 이 도메인 타입으로만 대화한다.
 * 지금은 companies 테이블에서 매핑해 채우지만, P1/P2에서 partners 테이블로
 * 이전하더라도 이 타입과 화면은 바뀌지 않는다. (저장소 교체 가능)
 */
export type PartnerType = "customer" | "supplier" | "both" | "unknown";

export interface Partner {
  id: string;
  name: string;
  type: PartnerType;
  country: string | null;
  city: string | null;
  currency: string | null;
  contactName: string | null;
  contactEmail: string | null;
  paymentTerms: string | null;
  incoterms: string | null;
}
