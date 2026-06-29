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
];

/** 문의 상태 (정확한 코드값은 P1.4 문의 화면에서 기존 데이터와 맞춰 확정) */
export const INQUIRY_STATUS: Code[] = [
  { code: "new", label: "신규" },
  { code: "reviewing", label: "검토중" },
  { code: "quoted", label: "견적완료" },
  { code: "closed", label: "종료" },
];

/** 견적 상태 (정확한 코드값은 P1.5 견적 화면에서 확정) */
export const QUOTATION_STATUS: Code[] = [
  { code: "draft", label: "작성중" },
  { code: "sent", label: "발송" },
  { code: "approved", label: "승인" },
  { code: "rejected", label: "반려" },
  { code: "expired", label: "만료" },
];

/** 거래처 구분(도메인). DB company_type(buyer/supplier) ↔ 매핑은 services/partners.ts */
export const PARTNER_TYPE_LABEL: Record<string, string> = {
  customer: "고객",
  supplier: "공급사",
  both: "고객·공급사",
  unknown: "미분류",
};

/** 코드 배열에서 라벨 찾기 (없으면 원본 코드 또는 '-') */
export function labelOf(codes: Code[], code: string | null | undefined): string {
  return codes.find((c) => c.code === code)?.label ?? code ?? "-";
}
