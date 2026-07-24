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
  fxSource: string | null; // 환율 출처 스냅샷 (대장 프리필/수동). 확정시점 고정(원칙 1-B)
  fxQuotedAt: string | null; // 환율 고시시점 스냅샷 (ISO)
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
  fxSource: string | null; // 환율 출처 스냅샷 (대장 프리필 시 출처, 수동 시 '수동입력')
  fxQuotedAt: string | null; // 환율 고시시점 스냅샷 (ISO). 없으면 null
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

/**
 * 도메인 타입 — 발주(Purchase Order) (SPEC C3·C4, 원칙 2 헤더-라인 · 원칙 3 참조생성).
 *
 * 물리 테이블 purchase_orders(헤더) + po_lines(라인) 이식. 수주(SalesOrder) 미러.
 *  - 원칙 2: subtotal=Σ(line.amount), total=subtotal−discount 는 서비스가 항상 재계산.
 *  - 원칙 3: refSalesOrderId/라인별 refSoLineId = 수주에서 참조 생성(back-to-back, 스냅샷 포인터).
 *  - 원칙 6: poNumber는 DB 원자적 발번(next_doc_number 'purchase_order')으로만 채번.
 *  - 원칙 1-B: 발주당 단일 통화 + exchangeRate(발주 시점 고정, 매출 환율 미승계).
 *  - 원칙 1: 입고수량/잔량은 컬럼으로 저장하지 않는다 — GR(P4)에서 Σ로 파생.
 *  - 거래처(partnerId)는 공급사(companies.company_type = supplier/both/미분류).
 */
export interface PurchaseOrderLine {
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
  refSoLineId: string | null; // 참조 출처 수주 라인(FK 아닌 스냅샷 포인터)
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  refSalesOrderId: string | null; // 참조 생성 출처(수주)
  partnerId: string | null; // 공급사
  partnerName: string | null; // 조인 표시용
  partnerCountry: string | null;
  orderDate: string | null;
  requestedDeliveryDate: string | null;
  currency: string | null;
  exchangeRate: number | null;
  fxSource: string | null; // 환율 출처 스냅샷(대장 프리필/수동). 확정시점 고정(원칙 1-B)
  fxQuotedAt: string | null; // 환율 고시시점 스냅샷 (ISO)
  incoterms: string | null;
  paymentTerms: string | null;
  destinationCountry: string | null;
  destinationPort: string | null;
  destinationAirport: string | null;
  transport: string | null;
  discount: number; // 헤더 레벨 할인
  subtotal: number; // = Σ(line.amount) (파생)
  total: number; // = subtotal − discount (파생)
  status: string; // draft/sent/confirmed/completed/cancelled
  notes: string | null;
  termsConditions: string | null;
  lines: PurchaseOrderLine[];
}

/** 발주 라인 입력 (id·amount 제외 — amount는 서비스가 계산). */
export interface PurchaseOrderLineInput {
  productId: string | null;
  productName: string;
  hsCode: string | null;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  refSoLineId: string | null; // 참조 출처 수주 라인(있으면 유지)
}

/** 발주 등록/수정 입력 (번호·합계·조인필드 제외 — 서비스가 채움). */
export interface PurchaseOrderInput {
  refSalesOrderId: string | null;
  partnerId: string | null;
  orderDate: string | null;
  requestedDeliveryDate: string | null;
  currency: string | null;
  exchangeRate: number | null;
  fxSource: string | null; // 환율 출처 스냅샷 (대장 프리필 시 출처, 수동 시 '수동입력')
  fxQuotedAt: string | null; // 환율 고시시점 스냅샷 (ISO). 없으면 null
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
  lines: PurchaseOrderLineInput[];
}

/**
 * 도메인 타입 — 선적(Shipment) (SPEC E1·E3·E4, §5 무역 · 원칙 3 참조 · 원칙 6 발번).
 *
 * 물리 테이블 shipments(헤더) + shipment_orders(주문 M:N) + milestones(일정).
 *  - 범위(P3.2): 부킹 + 주문 연결 + 마일스톤. 품목·금액·서류·S/I는 P4.
 *  - direction은 라벨·필터·기본값일 뿐, 주문 연결을 제한하지 않는다(SO+PO 혼합 = 3자무역/직송).
 *  - orders: 선적에 걸린 주문들(SO/PO). 분할선적·합짐을 M:N으로 처리(수량 배분은 P4).
 *  - milestones: 예정/실적 일정 — planned_date가 P3.3 기일엔진(D-7/D-3/D-1) 원천.
 */
export interface ShipmentOrderLink {
  orderType: string; // 'SO' | 'PO'
  orderId: string | null;
  orderNumber: string | null; // 표시용 스냅샷
}

export interface Milestone {
  type: string; // MILESTONE_TYPES 코드
  plannedDate: string | null; // YYYY-MM-DD (예정)
  actualDate: string | null; // YYYY-MM-DD (실적)
  memo: string | null;
}

export interface Shipment {
  id: string;
  shipNumber: string;
  direction: string | null; // export/import (라벨)
  partnerId: string | null; // 혼합 선적이면 null
  partnerName: string | null; // 조인 표시용
  partnerCountry: string | null;
  forwarder: string | null;
  carrier: string | null;
  transport: string | null; // sea/air
  vesselVoyage: string | null;
  pol: string | null; // 적출항
  pod: string | null; // 도착항
  bookingNo: string | null; // 포워더 부킹번호
  blNo: string | null; // B/L 번호
  // ⚠️ containerNo 없음(P5.2) — 헤더 컨테이너 스칼라는 **사장**됐다. 컨테이너는
  //    shipment_containers(복수·타입·씰·VGM·라인 배분)가 정본이다. shipments.container_no
  //    컬럼과 trade_documents 스냅샷 체인은 그대로 존치한다(과거 서류의 사실 보존).
  incoterms: string | null;
  status: string; // draft/booked/shipped/arrived/cancelled
  notes: string | null;
  orders: ShipmentOrderLink[];
  milestones: Milestone[];
}

/**
 * 도메인 타입 — 임박 기일(DeadlineItem) (SPEC I7·E3, P3.3 기일 역산 알림).
 *
 * 여러 소스(선적 마일스톤·수주/발주 납기·견적 유효기일·통관 적재의무기한)의 날짜를 하나로 모아 D-day로 정렬한다.
 *  - dDay = 기일(YYYY-MM-DD) − 오늘(**Asia/Seoul 달력 날짜**). 음수 = 지남(overdue).
 *  - 읽기 전용 파생 뷰(스키마 없음) — 기존 날짜 컬럼을 계산할 뿐, 별도 테이블 없음.
 */
export interface DeadlineItem {
  source: string; // milestone | so | po | quotation | customs
  sourceLabel: string; // '선적 마일스톤' | '수주 납기' | '발주 납기' | '견적 유효기일' | '수출신고'
  kind: string; // 세부 유형 (마일스톤 라벨 ETD/ETA…, '납기 요청일', '유효기일', '적재의무기한')
  date: string; // YYYY-MM-DD (기일)
  dDay: number; // 기일 − 오늘(KST). 음수=지남, 0=오늘, 양수=D-n
  docType: string; // shipment | sales_order | purchase_order | quotation | customs_declaration (링크용)
  docId: string;
  docNumber: string; // SHP-… / SO-… / PO-… / QT-…
  partnerName: string | null;
  memo: string | null;
}

/** 홈 대시보드 임박 요약 배지용. */
export interface DeadlineSummary {
  overdue: number; // 지남 (dDay < 0)
  within7: number; // 7일 내 (0 ≤ dDay ≤ 7)
}

/** 선적 등록/수정 입력 (번호·조인필드 제외 — 서비스가 채움). 주문연결·마일스톤은 read와 동일 모양. */
export interface ShipmentInput {
  direction: string | null;
  partnerId: string | null;
  forwarder: string | null;
  carrier: string | null;
  transport: string | null;
  vesselVoyage: string | null;
  pol: string | null;
  pod: string | null;
  bookingNo: string | null;
  blNo: string | null;
  // ⚠️ containerNo 없음(P5.2 사장) — 위 Shipment 주석 참조. 적입은 별도 RPC 로 저장한다.
  incoterms: string | null;
  status: string;
  notes: string | null;
  orders: ShipmentOrderLink[];
  milestones: Milestone[];
}

/* ---------- 재고 원장 (P4.1 — SPEC D1·D2·D3) ---------- */

/**
 * 현재고 1행 — **저장된 숫자가 아니라** 원장 합산 결과(뷰 stock_on_hand).
 * 원칙 1: `items.qty = 47` 같은 수정 가능한 잔량 필드는 이 시스템에 존재하지 않는다.
 */
export interface StockOnHand {
  itemId: string;
  itemCode: string | null;
  itemName: string | null;
  uom: string;
  warehouseCode: string;
  onHand: number; // 음수 가능 — 차단이 아니라 경고 대상(원칙 8)
}

/** 원장 1행 (append-only). 수정·삭제되지 않는다. 정정은 반대부호 REVERSAL 행. */
export interface StockMovement {
  id: string;
  movementType: string; // MOVEMENT_TYPES 코드
  itemId: string;
  itemCode: string | null;
  itemName: string | null;
  qty: number; // 부호 포함(+입고 / −출고). 유형이 부호를 정한다.
  uom: string; // 품목 마스터에서 뜬 스냅샷(마스터가 바뀌어도 과거 행 불변)
  warehouseCode: string;
  lotNo: string | null; // 칸은 P4.1부터, 활성화는 P5 (원장은 백필 불가)
  movedAt: string; // YYYY-MM-DD 증빙일(KST). created_at과 다르다.
  refDocType: string | null; // 선행 전표 소프트 포인터 — P4.2 GR / P4.3 Delivery가 채운다
  refDocId: string | null;
  reversalOfId: string | null; // 이 행이 되돌린 원행 (REVERSAL일 때만)
  reversedById: string | null; // 이 행을 되돌린 REVERSAL 행 (없으면 null = 역분개 가능)
  memo: string | null;
  createdAt: string;
}

/* ---------- 입고 GR (P4.2 — SPEC C5) ---------- */

/**
 * 발주 라인의 잔량 — **저장된 컬럼이 아니라 계산**(뷰 po_open_qty, 원칙 1).
 * `received_qty` 를 po_lines 에 저장하지 않는다. 잔량 = 발주수량 − Σ(취소 아닌 입고).
 */
export interface PoOpenQty {
  poLineId: string;
  poId: string;
  sortOrder: number | null;
  productId: string | null; // null = 자유텍스트 품목 → 입고 불가(원장은 실품목만 받는다)
  productName: string | null;
  unit: string | null;
  orderedQty: number;
  receivedQty: number;
  openQty: number; // 음수 = 초과입고(차단 아님, 원칙 8)
}

export interface GrLine {
  id: string;
  lineNo: number;
  poLineId: string | null; // 소프트 포인터(FK 아님)
  itemId: string;
  itemName: string | null; // 스냅샷
  qty: number;
  uom: string; // 스냅샷
  lotNo: string | null; // 칸은 P4.2부터, 활성화는 P5
  memo: string | null;
}

/* ---------- 출고 Delivery (P4.3 — SPEC B8) ---------- */

/**
 * 수주 라인의 잔량 — **저장된 컬럼이 아니라 계산**(뷰 so_open_qty, 원칙 1).
 * SPEC의 심장: 잔량 = so_lines.qty − Σ(delivery_lines.qty).
 */
export interface SoOpenQty {
  soLineId: string;
  soId: string;
  sortOrder: number | null;
  productId: string | null; // null = 자유텍스트 품목 → 출고 불가
  productName: string | null;
  unit: string | null;
  unitPrice: number; // 거래명세서 표시용(출고에는 저장하지 않는다)
  orderedQty: number;
  shippedQty: number;
  openQty: number; // 음수 = 초과출고(차단 아님, 원칙 8)
}

export interface DeliveryLine {
  id: string;
  lineNo: number;
  soLineId: string | null; // 소프트 포인터(FK 아님)
  itemId: string;
  itemName: string | null; // 스냅샷
  qty: number; // 항상 양수 — 원장에서만 음수(DLV_OUT)
  uom: string; // 스냅샷
  lotNo: string | null; // 칸은 P4.3부터, 활성화는 P5
  memo: string | null;
}

/** 출고 헤더. 부분출고 = 같은 수주에 여러 건. 취소는 상태 + 원장 역분개. */
export interface Delivery {
  id: string;
  deliveryNo: string;
  deliveryDate: string; // YYYY-MM-DD (KST)
  status: string; // DELIVERY_STATUS: normal | cancelled
  warehouseCode: string;
  refDocType: string; // 'sales_order'
  refDocId: string;
  soNumber: string | null; // 표시용 조인
  partnerName: string | null;
  memo: string | null;
  createdAt: string;
  lines: DeliveryLine[];
}

/** 입고 헤더. 부분입고 = 같은 발주에 GR 여러 건. 취소는 상태 + 원장 역분개. */
export interface GoodsReceipt {
  id: string;
  grNo: string;
  receiptDate: string; // YYYY-MM-DD (KST)
  status: string; // GR_STATUS: normal | cancelled
  warehouseCode: string;
  refDocType: string; // 'purchase_order'
  refDocId: string;
  poNumber: string | null; // 표시용 조인
  partnerName: string | null;
  memo: string | null;
  createdAt: string;
  lines: GrLine[];
}

/* ---------- P4.4 선적 화물 · 당사자 스냅샷 ---------- */

/**
 * 선적 화물 라인 — **물류 전표**라 원장 전기 없음, item 은 소프트(자유텍스트 허용).
 * order_line_id 소프트 포인터가 잔량·가드의 축이다(원칙 1·5).
 */
export interface ShipmentCargoLine {
  id: string;
  orderType: "SO" | "PO";
  orderLineId: string | null;
  itemId: string | null;
  itemName: string; // 스냅샷
  qty: number;
  uom: string; // 스냅샷 — P4.3f 체인(라인→마스터→거부)으로 해석된 값
  packageCount: number | null;
  packageType: string | null;
  grossWeightKg: number | null;
  cbm: number | null;
  memo: string | null;
}

/** 선적 당사자 스냅샷 — 인쇄(S/I)는 이것만 본다(마스터 소급 변경 차단). */
export interface ShipmentParty {
  role: "shipper" | "consignee" | "notify";
  companyId: string | null; // 출처 기록용 소프트 포인터
  name: string;
  address: string | null;
  contact: string | null;
}

/**
 * 주문라인별 선적 가능 잔량 — 뷰 shipment_line_totals 기반 계산(원칙 1).
 * uom 은 해석된 단위(라인→마스터), null = 단위 불명 → 폼이 그 줄을 잠근다(P4.3f).
 */
export interface ShippableOrderLine {
  orderType: "SO" | "PO";
  orderId: string;
  orderNumber: string | null; // shipment_orders 스냅샷
  orderLineId: string;
  productId: string | null;
  itemName: string | null;
  uom: string | null;
  orderedQty: number;
  shippedQty: number; // 살아있는 선적 라인 합(전 선적 대상)
  openQty: number; // 음수 = 초과 선적(차단 아님, 원칙 8)
}

/* ---------- P5.2 적입(E5) — 컨테이너 실측 · 라인 배분 ---------- */

/**
 * 컨테이너 실측 1건 — **전표가 아니라 선적 하위 실측 기록**이다(채번 없음, 인쇄물 없음).
 * 텍스트 3필드는 입력 원문의 정규화(btrim)만 거친 값 — 대문자 강제·ISO 체크디지트
 * 검증을 하지 않는다(있는 그대로 기록하는 것이 실측 기록의 원칙).
 * vgm_kg 는 **입력값**이다 — 배분에서 파생되는 G.W. 합과 별개이며 상호검증하지 않는다.
 */
export interface ShipmentContainer {
  id: string;
  containerNo: string | null;
  containerType: string | null;
  sealNo: string | null;
  vgmKg: number | null;
}

/**
 * 컨테이너 × 화물라인 포장수 배분 — 선택적이다(배분 없이 컨테이너만 기록해도 정상).
 * 과배분(라인 포장수 초과)·포장수 미기재 라인 배분을 서버가 막지 않는다 — UI 경고 담당.
 * ⚠️ **무참조 리프**: 이 id 는 어떤 전표·스냅샷도 참조하지 않으며 앞으로도 금지다
 *    (그래서 저장이 전량교체이고 감사 트리거도 붙이지 않는다 — P5.2 churn 판정).
 */
export interface ShipmentContainerAllocation {
  id: string;
  containerId: string;
  shipmentLineId: string;
  allocatedPackageCount: number;
}

/* ---------- P4.5 무역서류 CI/PL — 발행=스냅샷 전량, 인쇄는 이것만 본다 ---------- */

/**
 * 무역서류 라인 — 발행 시점 전량 스냅샷(D2). shipmentLineId/orderLineId 는
 * 소프트 포인터(추적용) — 원천이 사라져도 문서는 불변이다.
 */
export interface TradeDocumentLine {
  id: string;
  lineNo: number;
  shipmentLineId: string | null;
  orderLineId: string | null;
  productCode: string | null;
  productName: string;
  description: string | null;
  hsCode: string | null;
  originCountry: string | null;
  qty: number;
  uom: string;
  unitPrice: number;
  amount: number; // = round2(qty × unitPrice) — RPC 가 계산(클라 값 불신)
  netWeight: number | null; // 폼 직접 입력 (D5)
  grossWeight: number | null; // 폼 직접 입력, 프리필=선적 라인 G.W.(R1)
}

/* ---------- 적입 스냅샷 (P5.3) ---------- */

/**
 * 스냅샷된 배분 1건 — 소프트 포인터(shipmentLineId) + 값 복사.
 * 라이브 배분 행은 전량교체·cascade 대상이라 id 를 남기지 않는다(P5.2 무참조 리프).
 */
export interface TradeDocumentContainerAllocation {
  shipmentLineId: string | null;
  allocatedPackageCount: number | null;
}

/**
 * 스냅샷된 컨테이너 1행 — 실측 **3필드**(번호·타입·씰)는 **원문 그대로**, 수치는
 * 발행 시점 서버가 계산해 **동결**한 값이다(인쇄는 계산 0·읽기만 한다).
 * 불완전 플래그 키명은 `containerMetrics` 출력과 정렬한다(G.W./CBM 별도 판정).
 *
 * ⚠️ VGM 은 담지 않는다(P5.3 §4 판정·개정 2호). 컨테이너 총질량은 공동적입 시 타
 *    고객 물량 합산 정량이라 고객 문서에 실으면 유출이다 — 인쇄만 숨기지 않고
 *    데이터 층에서 뺀다. VGM 의 자리는 S/I 다([[feedback-no-vgm-customer-docs]]).
 */
export interface TradeDocumentContainer {
  containerNo: string | null;
  containerType: string | null;
  sealNo: string | null;
  allocations: TradeDocumentContainerAllocation[];
  packageCount: number | null;
  grossWeightKg: number | null;
  cbm: number | null;
  gwIncomplete: boolean;
  cbmIncomplete: boolean;
}

/** 스냅샷 전체 총계 — 컨테이너 동결값의 합·플래그 OR. */
export interface TradeDocumentContainerTotals {
  packageCount: number | null;
  grossWeightKg: number | null;
  cbm: number | null;
  gwIncomplete: boolean;
  cbmIncomplete: boolean;
}

/**
 * `trade_documents.containers_snapshot` 매핑 결과.
 * **null 은 이 타입이 아니다** — 서비스가 `null`(= P5.3 이전 발행)과 구분해서 준다.
 */
export interface TradeDocumentContainersSnapshot {
  containers: TradeDocumentContainer[];
  totals: TradeDocumentContainerTotals | null;
}

/** 포장 스냅샷 1행 — R-정정: "이 문서에 포함된 라인"의 S/I 스칼라만으로 구성. */
export interface TradeDocumentPackage {
  shipmentLineId: string | null;
  itemName: string | null;
  packageCount: number | null;
  packageType: string | null;
  grossWeightKg: number | null;
  cbm: number | null;
}

/**
 * 무역서류 헤더 — CI+PL 세트 = 1행 = 번호 1개(D1). PL 은 자체 번호 없이
 * docNumber 를 Invoice No.로 참조 인쇄한다. 발행 후 불변 — 취소·재발행만.
 */
export interface TradeDocument {
  id: string;
  docType: string; // 'CI'
  docNumber: string; // CI-YYYYMM-NNN (doc_type='trade_document' 카운터, R2)
  shipmentId: string;
  customerId: string;
  currency: string;
  issueDate: string; // YYYY-MM-DD (KST)
  incoterm: string | null;
  incotermPlace: string | null;
  paymentTerms: string | null;
  remarks: string | null;
  // Seller 스냅샷 (config 원천, D6·D7)
  sellerName: string;
  sellerAddress: string; // 줄바꿈(\n) 결합 — 인쇄가 줄로 나눈다
  sellerCountry: string;
  sellerTel: string | null;
  sellerEmail: string | null;
  sellerBizRegNo: string;
  sellerBankName: string | null; // 은행·서명자는 선택 — null 이면 섹션 생략
  sellerAccountNo: string | null;
  sellerSwift: string | null;
  sellerSignatoryName: string | null;
  sellerSignatoryTitle: string | null;
  // Buyer 스냅샷 (발행 시점 SO 고객 companies 미러, D6)
  buyerName: string;
  buyerAddress: string | null;
  buyerCity: string | null;
  buyerCountry: string | null;
  buyerContactName: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  // Consignee / Notify 스냅샷 (shipment_parties 복사 — 없으면 null, D6)
  consigneeName: string | null;
  consigneeAddress: string | null;
  consigneeContact: string | null;
  notifyName: string | null;
  notifyAddress: string | null;
  notifyContact: string | null;
  // 선적정보 스냅샷 (shipments 가 실제 가진 필드 범위 내)
  shippingMarks: string | null;
  shipmentNo: string | null;
  transport: string | null;
  vesselVoyage: string | null;
  pol: string | null;
  pod: string | null;
  carrier: string | null;
  blNo: string | null;
  bookingNo: string | null;
  containerNo: string | null;
  packagesSnapshot: TradeDocumentPackage[];
  // 적입 스냅샷(P5.3) — null 은 **P5.3 이전 발행**(헤더는 container_no 스칼라 폴백).
  // 빈 구조는 '적입 스코프 0건'. 인쇄·상세는 이 값만 소비한다(라이브 재조회 0).
  containersSnapshot: TradeDocumentContainersSnapshot | null;
  subtotalAmount: number;
  discountAmount: number; // D3 비례 배분 합 (0이면 인쇄에서 행 생략)
  totalAmount: number;
  status: string; // TRADE_DOC_STATUS: issued | cancelled (R3 소문자)
  cancelledAt: string | null; // ISO
  cancelReason: string | null;
  createdAt: string;
  lines: TradeDocumentLine[];
}

/** 목록·선적 상세 섹션용 요약 행 — 전부 헤더 스냅샷이라 조인이 필요 없다. */
export interface TradeDocumentListItem {
  id: string;
  docNumber: string;
  shipmentId: string;
  shipmentNo: string | null;
  customerId: string;
  buyerName: string;
  currency: string;
  totalAmount: number;
  status: string;
  issueDate: string;
  createdAt: string;
}

/** 발행 라인 입력 — 보충 필드만(qty·uom·단가·금액은 서버가 원천에서 재계산). */
export interface TradeDocumentLineInput {
  shipmentLineId: string;
  include: boolean;
  hsCode: string | null;
  originCountry: string | null;
  netWeight: number | null;
  grossWeight: number | null;
  description: string | null;
}

/** 발행 입력 — Seller 는 서비스가 config 에서 채운다(폼 입력 아님). */
export interface TradeDocumentIssueInput {
  shipmentId: string;
  customerId: string;
  currency: string;
  issueDate: string | null; // null = 오늘(KST)
  incoterm: string | null;
  incotermPlace: string | null;
  paymentTerms: string | null;
  remarks: string | null;
  lines: TradeDocumentLineInput[];
}

/**
 * 발행 폼용 파생 행 — 선적 라인 + 주문/품목 체인을 서버에서 한 번에 붙인 읽기 전용 뷰.
 * unitPrice/amount 는 미리보기(진실은 RPC 재계산), *Prefill 은 폼 초기값(수정 가능 스냅샷).
 */
export interface IssuableLine {
  shipmentLineId: string;
  orderType: "SO" | "PO";
  itemName: string;
  qty: number;
  uom: string;
  orderLineId: string | null;
  soId: string | null;
  soNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  currency: string | null; // 공란 = 발행 불가(경고 대상)
  unitPrice: number | null; // so_lines 계약 단가 — null 이면 서버가 발행 거부
  amount: number | null; // = round2(qty × unitPrice) 미리보기
  soDiscount: number; // D3 미리보기용
  soOrderTotal: number; // D3 분모 미러(amount null 라인은 qty×단가 재계산 합산)
  hsPrefill: string | null; // so_line.hs_code → products.hs_code
  originPrefill: string | null; // products.origin_country (발명 금지 — 없으면 공란)
  descriptionPrefill: string | null; // so_line.description
  grossWeightPrefill: number | null; // R1: shipment_line.gross_weight_kg
  packageCount: number | null; // R-정정 포장 경고 판정용
  packageType: string | null;
}

/* ============================================================================
 *  통관신고 (P5.1 — customs_declarations, 수출 E6 / 수입 E9)
 *  헤더 온리(라인 없음)·인쇄물 없음. 쓰기는 RPC 2종(save/cancel)뿐(출생 봉인).
 * ========================================================================== */

/** 통관신고 헤더 도메인 — status·declType 소문자. 선적 요약은 조회 시 임베드. */
export interface CustomsDeclaration {
  id: string;
  declDocNo: string; // 내부 채번 ECD/ICD-YYYYMM-NNN
  declType: string; // DECL_TYPE: export | import
  shipmentId: string; // hard FK 앵커
  status: string; // CUSTOMS_DECL_STATUS: draft | filed | accepted | cancelled
  customsDeclNo: string | null; // 세관 발급 신고번호(내부 채번과 별개 — 입력값만)
  filingDate: string | null; // YYYY-MM-DD (KST)
  acceptanceDate: string | null; // YYYY-MM-DD (KST)
  brokerName: string | null; // 관세사(자유 텍스트)
  taxableValue: number | null; // 수입 전용 세액(관세사 통지값 — 계산·단정 없음)
  dutyAmount: number | null;
  vatAmount: number | null;
  taxCurrency: string | null;
  loadingDeadlineExtended: string | null; // 수출 전용 — 적재의무기한 연장승인일
  memo: string | null;
  cancelledAt: string | null; // ISO
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  // 선적 요약 스냅샷 아님 — 조회 시 임베드(표시용, 없으면 null)
  shipmentNo: string | null;
  shipmentStatus: string | null;
  partnerName: string | null;
}

/**
 * 통관신고 저장 입력 — save_customs_declaration RPC 파라미터의 도메인 형태.
 * id=null 은 신규(1회 발번). qty·세액은 발명·계산 없음 — 입력값 그대로 전달, 검증은 RPC.
 */
export interface CustomsDeclarationInput {
  id: string | null;
  shipmentId: string;
  declType: string; // export | import
  status: string; // draft | filed | accepted (cancelled 는 별도 취소 RPC)
  customsDeclNo: string | null;
  filingDate: string | null;
  acceptanceDate: string | null;
  brokerName: string | null;
  taxableValue: number | null;
  dutyAmount: number | null;
  vatAmount: number | null;
  taxCurrency: string | null;
  loadingDeadlineExtended: string | null;
  memo: string | null;
}
