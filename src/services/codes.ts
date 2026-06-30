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

/** 견적 상태 (정확한 코드값은 P1.5 견적 화면에서 확정) */
export const QUOTATION_STATUS: Code[] = [
  { code: "draft", label: "작성중" },
  { code: "sent", label: "발송" },
  { code: "approved", label: "승인" },
  { code: "rejected", label: "반려" },
  { code: "expired", label: "만료" },
];

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
