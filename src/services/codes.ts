/**
 * 코드값 일원화 (SPEC 원칙 4).
 *
 * 단위·통화·인코텀즈·운송·문서상태 등을 화면마다 하드코딩하지 않고 여기 모은다.
 * 편집형 DB `code_tables`는 후순위(다중 사용자 편집이 필요해지면) — 지금은 타입 안전한 상수.
 */
export interface Code {
  code: string;
  label: string;
}

export const UNITS: Code[] = [
  { code: "PCS", label: "PCS" },
  { code: "SET", label: "SET" },
  { code: "KG", label: "KG" },
  { code: "CBM", label: "CBM" },
  { code: "MT", label: "MT" },
];

export const CURRENCIES: Code[] = [
  { code: "USD", label: "USD ($)" },
  { code: "EUR", label: "EUR (€)" },
  { code: "GBP", label: "GBP (£)" },
  { code: "KRW", label: "KRW (₩)" },
  { code: "JPY", label: "JPY (¥)" },
  { code: "CNY", label: "CNY (¥)" },
];

export const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  KRW: "₩",
  JPY: "¥",
  CNY: "¥",
};

/**
 * 통화별 고시단위(quote unit) — 환율 대장 입력의 100단위 함정 방지 (P2.3, F5).
 * 한국 은행은 JPY를 100엔당 원화로 고시한다(예: 100 JPY = 905 KRW). 사용자는 은행 화면값
 * 그대로 입력하고, 서비스가 이 단위로 나눠 1단위 정규화값(9.05)을 대장에 저장한다.
 * 여기 없는 통화는 1단위 고시(quoteUnitOf 기본 1).
 */
export const CURRENCY_QUOTE_UNIT: Record<string, number> = {
  JPY: 100,
};

/** 통화의 고시단위 (미정의는 1). 환율 입력 폼·서비스가 공유하는 단일 출처. */
export function quoteUnitOf(currency: string | null | undefined): number {
  if (!currency) return 1;
  return CURRENCY_QUOTE_UNIT[currency] ?? 1;
}

/** 환율 출처 추천값 (자유 입력 허용 — datalist 힌트용). */
export const FX_SOURCE_SUGGESTIONS: string[] = [
  "한국은행",
  "하나은행 고시",
  "우리은행 고시",
  "네이버 환율",
  "수동입력",
];

export const INCOTERMS: Code[] = [
  { code: "EXW", label: "EXW" },
  { code: "FCA", label: "FCA" },
  { code: "FOB", label: "FOB" },
  { code: "CFR", label: "CFR" },
  { code: "CIF", label: "CIF" },
  { code: "CPT", label: "CPT" },
  { code: "CIP", label: "CIP" },
  { code: "DAP", label: "DAP" },
  { code: "DPU", label: "DPU" },
  { code: "DDP", label: "DDP" },
];

export const TRANSPORT: Code[] = [
  { code: "sea", label: "해상 (Sea)" },
  { code: "air", label: "항공 (Air)" },
  { code: "both", label: "해상+항공" },
];

/**
 * 결제조건 — 무역 표준 조합. code 값은 기존 inquiries.payment_terms 문자열과
 * 그대로 맞춰 기존 데이터 표시·재저장이 깨지지 않게 한다. (자유값은 sticky 옵션으로 보존)
 */
export const PAYMENT_TERMS: Code[] = [
  { code: "T/T 30% in advance", label: "T/T 30% 선급" },
  { code: "T/T 50% in advance", label: "T/T 50% 선급" },
  { code: "T/T 100% in advance", label: "T/T 100% 선급" },
  { code: "L/C at sight", label: "L/C at sight (일람불)" },
  { code: "L/C 30days", label: "L/C 30 days" },
  { code: "L/C 60days", label: "L/C 60 days" },
  { code: "L/C 90days", label: "L/C 90 days" },
  { code: "CAD", label: "CAD (서류상환)" },
  { code: "O/A 30days", label: "O/A 30 days" },
  { code: "O/A 60days", label: "O/A 60 days" },
  { code: "O/A 90days", label: "O/A 90 days" },
];

/** 문의 상태 — 실제 inquiries.status 값에 맞춤 (P1.4에서 확정). */
export const INQUIRY_STATUS: Code[] = [
  { code: "received", label: "접수" },
  { code: "reviewing", label: "검토중" },
  { code: "quoted", label: "견적발송" },
  { code: "negotiating", label: "협상중" },
  { code: "won", label: "수주성공" },
  { code: "lost", label: "수주실패" },
];

/** 견적 상태 (P1.5에서 확정 — 실제 quotations.status 값). */
export const QUOTATION_STATUS: Code[] = [
  { code: "draft", label: "작성중" },
  { code: "sent", label: "발송" },
  { code: "approved", label: "승인" },
  { code: "rejected", label: "반려" },
  { code: "expired", label: "만료" },
];

/** 선적 상태 (P3.2 — 실제 shipments.status 값). */
export const SHIPMENT_STATUS: Code[] = [
  { code: "draft", label: "작성중" },
  { code: "booked", label: "부킹확정" },
  { code: "shipped", label: "선적완료" },
  { code: "arrived", label: "도착" },
  { code: "cancelled", label: "취소" },
];

/** 선적 방향 (P3.2 — 라벨·필터·진입기본값용. 주문 연결을 제한하지 않음). */
export const SHIPMENT_DIRECTION: Code[] = [
  { code: "export", label: "수출 (Export)" },
  { code: "import", label: "수입 (Import)" },
];

/** 선적 당사자 역할 (P4.4, 원칙 4 코드테이블) — shipment_parties.role 실제 값. */
export const SHIPMENT_PARTY_ROLES: Code[] = [
  { code: "shipper", label: "Shipper (송하인)" },
  { code: "consignee", label: "Consignee (수하인)" },
  { code: "notify", label: "Notify Party (통지처)" },
];

/** 마일스톤 유형 (P3.2, 원칙 4 코드테이블) — 기일엔진(P3.3) 원천. 해상·항공·수출입 공용. */
export const MILESTONE_TYPES: Code[] = [
  { code: "doc_cutoff", label: "서류마감 (S/I Cut-off)" },
  { code: "cargo_closing", label: "카고클로징 (CY Cut-off)" },
  { code: "vgm_cutoff", label: "VGM 마감" },
  { code: "etd", label: "출항 (ETD)" },
  { code: "eta", label: "입항 (ETA)" },
  { code: "arrival_notice", label: "도착통보" },
  { code: "cargo_release", label: "화물 반출" },
];

/**
 * 기본 마일스톤 템플릿 — 폼 "기본 마일스톤 채우기" 버튼(transport별 표준 세트, 빈 날짜 행으로 추가).
 * 마일스톤이 안 쌓이면 P3.3 기일엔진이 알릴 대상이 없으므로 입력 마찰을 줄인다.
 */
export const MILESTONE_TEMPLATES: Record<string, string[]> = {
  sea: ["doc_cutoff", "cargo_closing", "vgm_cutoff", "etd", "eta"],
  air: ["doc_cutoff", "etd", "eta"],
};

/** 감사 동작 — audit_log.action 값 → 한글 라벨 (P2.1, 원칙 4). */
export const AUDIT_ACTION: Code[] = [
  { code: "INSERT", label: "등록" },
  { code: "UPDATE", label: "수정" },
  { code: "DELETE", label: "삭제" },
];

/**
 * 수주 상태 — **표시용 전체 목록** (P2.2 + P4.3 `partial`).
 * `sales_orders.status` 에 CHECK 제약이 없어(text default 'draft') 코드 추가가 자유롭다.
 */
export const SO_STATUS_ALL: Code[] = [
  { code: "draft", label: "작성중" },
  { code: "confirmed", label: "확정" },
  { code: "partial", label: "부분출고" }, // ★ P4.3 — 기계 전용(아래 주석)
  { code: "completed", label: "완료" },
  { code: "cancelled", label: "취소" },
];

/**
 * 수주 폼에서 **사람이 고를 수 있는** 상태.
 * ⚠️ `partial`(부분출고) 제외 — 출고 RPC 만 전이시키는 **기계 전용 상태**다.
 *    손으로 넣으면 실제 출고 없이 부분출고가 되어 잔량과 상태가 어긋난다.
 *    (`completed` 수동 선택은 P2.2 동작 그대로 유지)
 */
export const SO_STATUS: Code[] = SO_STATUS_ALL.filter((s) => s.code !== "partial");

/** 출고 상태 (P4.3). 취소는 삭제가 아니라 상태 + 원장 역분개(원칙 1·5). */
export const DELIVERY_STATUS: Code[] = [
  { code: "normal", label: "정상" },
  { code: "cancelled", label: "취소" },
];

/**
 * 발주 상태 — **표시용 전체 목록** (P3.1 + P4.2 `partial`).
 * `purchase_orders.status` 에 CHECK 제약이 없어(text default 'draft') 코드 추가가 자유롭다.
 */
export const PO_STATUS_ALL: Code[] = [
  { code: "draft", label: "작성중" },
  { code: "sent", label: "발주송부" },
  { code: "confirmed", label: "공급사확정" },
  { code: "partial", label: "부분입고" }, // ★ P4.2 — 기계 전용(아래 주석)
  { code: "completed", label: "완료" },
  { code: "cancelled", label: "취소" },
];

/**
 * 발주 폼에서 **사람이 고를 수 있는** 상태.
 *
 * ⚠️ `partial`(부분입고)은 제외한다 — 입고 RPC 만 전이시키는 **기계 전용 상태**다.
 *    사람이 손으로 넣으면 실제 입고 없이 부분입고가 되어 잔량과 상태가 어긋난다.
 *    (`completed` 수동 선택은 P3.1 동작 그대로 유지 — 입고 없이 종결하는 실무가 있다)
 */
export const PO_STATUS: Code[] = PO_STATUS_ALL.filter((s) => s.code !== "partial");

/** 입고 상태 (P4.2). 취소는 삭제가 아니라 상태 + 원장 역분개(원칙 1·5). */
export const GR_STATUS: Code[] = [
  { code: "normal", label: "정상" },
  { code: "cancelled", label: "취소" },
];

/**
 * 무역서류 상태 (P4.5 — 실제 trade_documents.status 값, 소문자 판정 R3).
 * 발행 후 불변 — 수정 없음, 취소(사유 필수)와 재발행(새 번호)만(D1).
 */
export const TRADE_DOC_STATUS: Code[] = [
  { code: "issued", label: "발행" },
  { code: "cancelled", label: "취소" },
];

/**
 * 통관신고 상태 (P5.1 — 실제 customs_declarations.status 값, 소문자).
 * draft→filed→accepted 순방향만(역행 금지), 취소는 별도 RPC. accepted 후 수정 없음(취소만).
 */
export const CUSTOMS_DECL_STATUS: Code[] = [
  { code: "draft", label: "작성중" },
  { code: "filed", label: "신고" },
  { code: "accepted", label: "수리" },
  { code: "cancelled", label: "취소" },
];

/** 통관신고 유형 (P5.1 — customs_declarations.decl_type: 수출 E6 / 수입 E9). */
export const DECL_TYPE: Code[] = [
  { code: "export", label: "수출신고" },
  { code: "import", label: "수입신고" },
];

/**
 * 재고 이동 유형 (P4.1, SPEC D2 — 원칙 4 코드테이블: 부호·의미를 코드가 갖는다).
 *
 * ⚠️ `sign` 이 이 시스템의 부호 단일 진실이다. 화면은 항상 양수만 입력받고,
 *    +/− 는 유형이 결정한다 → "감소인데 +30" 같은 모순이 구조적으로 불가능해진다.
 *    DB 쪽에서도 save_stock_adjustment RPC 가 같은 규칙으로 부호를 정한다(이중 방어).
 *
 * REVERSAL 의 sign 은 0 = "고정 부호 없음". 역분개는 원행의 반대이므로 ± 둘 다 나온다.
 * 새 패턴이 생기면 if 문이 아니라 여기 코드를 추가한다(원칙 4).
 */
export interface MovementType extends Code {
  sign: 1 | -1 | 0; // +1 입고 / −1 출고 / 0 원행에 따름(REVERSAL)
  tone: "in" | "out" | "reversal"; // 화면 색 구분
}

export const MOVEMENT_TYPES: MovementType[] = [
  { code: "INIT", label: "기초재고", sign: 1, tone: "in" },
  { code: "ADJ_IN", label: "조정 증가", sign: 1, tone: "in" },
  { code: "ADJ_OUT", label: "조정 감소", sign: -1, tone: "out" },
  { code: "GR_IN", label: "구매 입고", sign: 1, tone: "in" }, // P4.2 발주→입고가 생성
  { code: "DLV_OUT", label: "판매 출고", sign: -1, tone: "out" }, // P4.3 수주→출고가 생성
  { code: "REVERSAL", label: "역분개", sign: 0, tone: "reversal" },
];

/** 화면에서 사용자가 직접 고를 수 있는 조정 유형 3종(나머지는 전표·역분개가 만든다). */
export const ADJUSTMENT_TYPES: MovementType[] = MOVEMENT_TYPES.filter((m) =>
  ["INIT", "ADJ_IN", "ADJ_OUT"].includes(m.code),
);

/** 새 발주 기본 약관 (Purchase Order Terms). 서비스·폼이 공유(클라이언트 안전). */
export const DEFAULT_PO_TERMS =
  "Please confirm acceptance of this purchase order in writing.\n" +
  "Delivery to be completed by the requested date; notify immediately of any delay.\n" +
  "Goods must match the specifications, quantity and price stated herein.";

/** 새 수주 기본 약관 (Order Confirmation Terms). 서비스·폼이 공유(클라이언트 안전). */
export const DEFAULT_SO_TERMS =
  "This order confirmation is subject to the agreed quotation terms.\n" +
  "Delivery schedule to be confirmed upon order acceptance.\n" +
  "Prices and quantities as listed; any change requires written agreement.";

/** 새 견적 기본 약관 (Proforma Invoice Terms). 서비스·폼이 공유(클라이언트 안전). */
export const DEFAULT_QUOTATION_TERMS =
  "Prices are valid for 30 days from the date of quotation.\n" +
  "Delivery within 60 days after PO confirmation.\n" +
  "All prices are subject to final confirmation upon order.";

/** 거래처 구분(도메인) 단일 출처 — 선택 가능한 3종. DB company_type ↔ 매핑은 services/partners.ts */
export const PARTNER_TYPES: Code[] = [
  { code: "customer", label: "고객" },
  { code: "supplier", label: "공급사" },
  { code: "both", label: "고객·공급사" },
];

/** 구분 코드 → 라벨 (PARTNER_TYPES에서 파생 + 미분류). 화면·폼·액션이 공유. */
export const PARTNER_TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(PARTNER_TYPES.map((c) => [c.code, c.label])),
  unknown: "미분류",
};

/** 코드 배열에서 라벨 찾기 (없으면 원본 코드 또는 '-') */
export function labelOf(codes: Code[], code: string | null | undefined): string {
  return codes.find((c) => c.code === code)?.label ?? code ?? "-";
}

/**
 * 금액 2자리 반올림 (부동소수 드리프트 방지). 클라이언트·서버가 공유해
 * '화면 합계 = 저장 합계 = 인쇄 합계'를 보장한다 (원칙 2).
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * 환율 6자리 반올림 — 1단위 정규화(예: 905/100=9.05, 소액통화 0.00074…)를 결정적으로 저장.
 * 금액(round2)보다 정밀도가 필요해 별도 함수. 서비스가 대장 저장 시 사용.
 */
export function round6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}
