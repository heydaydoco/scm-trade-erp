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

/**
 * 도메인 타입 — 수주(Sales Order) (SPEC B3, 원칙 2 헤더-라인 · 원칙 3 참조생성).
 *
 * 물리 테이블 sales_orders(헤더) + so_lines(라인) 이식.
 *  - 원칙 2: subtotal=Σ(line.amount), total=subtotal−discount 는 서비스가 항상 재계산.
 *  - 원칙 3: refQuotationId/라인별 refQuotationLineId = 견적에서 참조 생성(스냅샷 포인터).
 *  - 원칙 6: soNumber는 DB 원자적 발번(next_doc_number 'sales_order')으로만 채번.
 *  - 원칙 1-B: 수주당 단일 통화 + exchangeRate(확정시점 고정).
 *  - 원칙 1: 출고수량/잔량은 컬럼으로 저장하지 않는다 — Delivery(P4)에서 Σ로 파생.
 */
export interface SalesOrderLine {
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
  refQuotationLineId: string | null; // 참조 출처 견적 라인(FK 아닌 스냅샷 포인터)
}

export interface SalesOrder {
  id: string;
  soNumber: string;
  refQuotationId: string | null; // 참조 생성 출처(견적)
  partnerId: string | null;
  partnerName: string | null; // 조인 표시용
  partnerCountry: string | null;
  orderDate: string | null;
  requestedDeliveryDate: string | null;
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
  status: string; // draft/confirmed/completed/cancelled
  notes: string | null;
  termsConditions: string | null;
  lines: SalesOrderLine[];
}

/** 수주 라인 입력 (id·amount 제외 — amount는 서비스가 계산). */
export interface SalesOrderLineInput {
  productId: string | null;
  productName: string;
  hsCode: string | null;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  refQuotationLineId: string | null; // 참조 출처 견적 라인(있으면 유지)
}

/** 수주 등록/수정 입력 (번호·합계·조인필드 제외 — 서비스가 채움). */
export interface SalesOrderInput {
  refQuotationId: string | null;
  partnerId: string | null;
  orderDate: string | null;
  requestedDeliveryDate: string | null;
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
  lines: SalesOrderLineInput[];
}

/**
 * 도메인 타입 — 환율 대장(FxRate) (SPEC F5, 원칙 1-B 돈=금액+통화 · 원칙 5 불변).
 *
 * 물리 테이블 fx_rates 이식(추가 전용). 견적·수주의 환율 프리필 소스이며,
 * 문서는 이 대장을 FK로 참조하지 않는다 — 값만 스냅샷 복사(과거 문서 값 불변, 원칙 1-B).
 *  - rate: **1단위 정규화값** (1 quoteCurrency = rate × baseCurrency).
 *  - quoteUnit: 원본 고시단위(JPY=100 등). 원본 고시값 = rate × quoteUnit (표시·감사용).
 */
export interface FxRate {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: number; // 1단위 정규화값
  quoteUnit: number; // 고시단위 (JPY=100, 기본 1)
  rateDate: string | null; // YYYY-MM-DD (적용 고시일)
  source: string | null;
  quotedAt: string | null; // ISO (고시 시점)
  note: string | null;
  createdAt: string | null;
}

/**
 * 환율 등록 입력. 사용자는 **은행 고시값 그대로**(quotedRate) + 고시단위(quoteUnit)를 준다.
 * 정규화(rate = quotedRate / quoteUnit)는 서비스 한 곳에서 수행(원칙 7) — 100배 함정 차단.
 */
export interface FxRateInput {
  baseCurrency: string;
  quoteCurrency: string;
  quotedRate: number; // 은행 고시 그대로 (예: 100엔당 905)
  quoteUnit: number; // 고시단위 (예: 100)
  rateDate: string | null;
  source: string | null;
  quotedAt: string | null;
  note: string | null;
}

/**
 * 통화별 최신 환율 (프리필용). getLatestRates()가 통화코드 → 이 값 맵을 돌려준다.
 * rate는 1단위 정규화값이라 문서 exchangeRate에 그대로 넣으면 된다.
 */
export interface LatestRate {
  rate: number; // 1단위 정규화값
  quoteUnit: number;
  source: string | null;
  quotedAt: string | null;
  rateDate: string | null;
}
