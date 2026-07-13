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

/**
 * 도메인 타입 — 견적(Quotation) (SPEC B2, 원칙 2 헤더-라인의 첫 등장).
 *
 * 물리 테이블 quotations(헤더) + quotation_items(라인) 이식.
 *  - 원칙 2: 라인이 합계의 진실. subtotal=Σ(line.amount), total=subtotal−discount
 *    는 서비스가 항상 재계산한다(헤더 컬럼은 표시·인쇄용 스냅샷).
 *  - 원칙 3: inquiryId = 참조 생성 출처(문의→견적).
 *  - 원칙 6: quotationNumber는 DB 원자적 발번(next_doc_number)으로만 채번.
 *  - 원칙 1-B: 견적당 단일 통화 + exchangeRate(확정시점 고정, 전체 FX는 P2).
 */
export interface QuotationLine {
  id: string;
  lineNo: number; // sort_order + 1 (표시용 1-based)
  productId: string | null; // 품목 소프트 링크
  productName: string; // 자유텍스트 스냅샷
  hsCode: string | null;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  amount: number; // = quantity × unitPrice (파생 — 서비스가 계산)
}

export interface Quotation {
  id: string;
  quotationNumber: string;
  inquiryId: string | null;
  partnerId: string | null;
  partnerName: string | null; // 조인 표시용
  partnerCountry: string | null;
  quotationDate: string | null;
  validUntil: string | null;
  currency: string | null;
  exchangeRate: number | null;
  incoterms: string | null;
  paymentTerms: string | null;
  destinationCountry: string | null;
  destinationPort: string | null;
  destinationAirport: string | null;
  transport: string | null;
  discount: number; // 헤더 레벨 할인
  subtotal: number; // = Σ(line.amount) (파생)
  total: number; // = subtotal − discount (파생)
  status: string; // draft/sent/approved/rejected/expired
  notes: string | null;
  termsConditions: string | null;
  lines: QuotationLine[];
}

/** 견적 라인 입력 (id·amount 제외 — amount는 서비스가 계산). */
export interface QuotationLineInput {
  productId: string | null;
  productName: string;
  hsCode: string | null;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
}

/** 견적 등록/수정 입력 (번호·합계·조인필드 제외 — 서비스가 채움). */
export interface QuotationInput {
  inquiryId: string | null;
  partnerId: string | null;
  quotationDate: string | null;
  validUntil: string | null;
  currency: string | null;
  exchangeRate: number | null;
  incoterms: string | null;
  paymentTerms: string | null;
  destinationCountry: string | null;
  destinationPort: string | null;
  destinationAirport: string | null;
  transport: string | null;
  discount: number;
  status: string;
  notes: string | null;
  termsConditions: string | null;
  lines: QuotationLineInput[];
}

/**
 * 도메인 타입 — 변경 이력(AuditLogEntry) (SPEC I5, 원칙 5 — 불변·삭제 없음).
 *
 * 물리 테이블 audit_log 이식. **기록은 오직 DB 트리거(fn_audit)만** 수행하고
 * 앱은 읽기만 한다 → 위조·삭제 불가. 화면은 이 도메인 타입으로만 대화한다(원칙 7).
 * before/after는 변경 전후 행 전체(jsonb) 스냅샷 — 무엇이 바뀌었는지 재구성 가능.
 */
export interface AuditLogEntry {
  id: string;
  tableName: string; // 어떤 테이블이 바뀌었나 (예: quotations)
  recordId: string | null; // 대상 행의 id (테이블마다 타입 달라도 text로)
  action: string; // INSERT / UPDATE / DELETE
  before: Record<string, unknown> | null; // 변경 전 행 (INSERT면 null)
  after: Record<string, unknown> | null; // 변경 후 행 (DELETE면 null)
  actor: string; // 작성자 (인증 도입 전에는 'system')
  at: string; // 발생 시각 (ISO, timestamptz)
}
