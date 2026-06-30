/**
 * 도메인 타입 — 화면과 서비스가 공유하는 "거래처(Partner)" 개념.
 *
 * SPEC 원칙 7: 화면은 물리 테이블(companies)이 아니라 이 도메인 타입으로만 대화한다.
 * P1/P2에서 partners 테이블로 이전하더라도 이 타입과 화면은 바뀌지 않는다.
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
  contactPhone: string | null;
  address: string | null;
  paymentTerms: string | null;
  incoterms: string | null;
  notes: string | null;
  active: boolean;
}

/** 거래처 등록/수정 입력 (id·시스템 필드 제외). */
export interface PartnerInput {
  name: string;
  type: PartnerType;
  country: string | null;
  city: string | null;
  currency: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  paymentTerms: string | null;
  incoterms: string | null;
  notes: string | null;
  active: boolean;
}

/**
 * 도메인 타입 — 품목(Item) (SPEC A1 / §5 items 모델).
 *
 * 원칙 7: 화면은 물리 테이블(products)이 아니라 이 도메인 타입으로만 대화한다.
 * products 행 ↔ Item 매핑은 services/items.ts 가 전담한다.
 */
export interface Item {
  id: string;
  code: string | null; // 품목코드(SKU)
  name: string; // 품목명
  hsCode: string | null; // HS 코드
  baseUom: string | null; // 기본 단위
  stdPrice: number | null; // 표준단가
  currency: string | null;
  originCountry: string | null; // 원산지
  isDangerous: boolean; // 위험물여부
  lotManaged: boolean; // 로트 관리여부
  serialManaged: boolean; // 시리얼 관리여부
  description: string | null; // 설명/비고
  active: boolean;
}

/** 품목 등록/수정 입력 (id·시스템 필드 제외). */
export interface ItemInput {
  code: string | null;
  name: string;
  hsCode: string | null;
  baseUom: string | null;
  stdPrice: number | null;
  currency: string | null;
  originCountry: string | null;
  isDangerous: boolean;
  lotManaged: boolean;
  serialManaged: boolean;
  description: string | null;
  active: boolean;
}

/**
 * 도메인 타입 — 문의(Inquiry) (SPEC B1, 문서 사슬의 시작점).
 *
 * 물리 테이블 inquiries 이식. 참조 두 종류:
 *  - 거래처: partnerId(=company_id) 정식 참조. partnerName/Country는 조인된 표시용.
 *  - 품목: productId 소프트 링크(품목 마스터에서 고른 경우만, NULL 허용) +
 *          productName 자유텍스트 스냅샷(카탈로그에 없어도 입력 가능).
 * inquiries 행 ↔ Inquiry 매핑은 services/inquiries.ts 가 전담한다.
 */
export interface Inquiry {
  id: string;
  partnerId: string | null;
  partnerName: string | null; // 조인 표시용 (companies.company_name)
  partnerCountry: string | null; // 조인 표시용 (companies.country)
  inquiryDate: string | null; // YYYY-MM-DD
  productId: string | null; // 소프트 링크
  productName: string; // 자유텍스트 스냅샷
  hsCode: string | null;
  quantity: number | null;
  unit: string | null;
  transport: string | null; // sea/air/both
  destinationCountry: string | null;
  destinationPort: string | null;
  destinationAirport: string | null;
  incoterms: string | null;
  paymentTerms: string | null;
  requiredDeliveryDate: string | null;
  sampleRequested: boolean;
  ndaRequired: boolean;
  status: string; // received/reviewing/quoted/negotiating/won/lost
  notes: string | null;
}

/** 문의 등록/수정 입력 (id·조인 표시필드 제외). */
export interface InquiryInput {
  partnerId: string | null;
  inquiryDate: string | null;
  productId: string | null;
  productName: string;
  hsCode: string | null;
  quantity: number | null;
  unit: string | null;
  transport: string | null;
  destinationCountry: string | null;
  destinationPort: string | null;
  destinationAirport: string | null;
  incoterms: string | null;
  paymentTerms: string | null;
  requiredDeliveryDate: string | null;
  sampleRequested: boolean;
  ndaRequired: boolean;
  status: string;
  notes: string | null;
}
