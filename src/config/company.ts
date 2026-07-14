/**
 * 자사(Seller) 정보 — 견적서(Proforma Invoice) 상단 "From (Seller)" 블록에 들어간다.
 *
 * ⚠️ 지금은 플레이스홀더입니다. 실제 견적서를 거래처에 보내기 전에, 아래 값들을
 *    회사의 진짜 정보로 바꾸세요. 이 파일(src/config/company.ts) 한 곳만 고치면
 *    모든 견적서에 반영됩니다.
 */
export const SELLER = {
  name: "Your Company Co., Ltd.", // ← 회사명
  addressLines: [
    "123 Example-ro, Gangnam-gu", // ← 주소 1줄
    "Seoul 06000, Republic of Korea", // ← 주소 2줄
  ],
  tel: "+82-2-0000-0000", // ← 전화
  email: "sales@yourcompany.com", // ← 이메일
  bizRegNo: "000-00-00000", // ← 사업자등록번호
};

/**
 * 기준통화(Base Currency) — 원칙 1-B.
 * 모든 외화 금액을 이 통화로 환산해 합산·보고한다. 환율 대장(fx_rates)과 문서 환율은
 * "1 문서통화 = rate × 기준통화"로 표기한다 (예: 1 USD = 1,350 KRW → rate=1350).
 * 한국 수출입 기업 기준 KRW. 바꾸려면 이 한 줄만 고치면 된다(대장의 base_currency와 일치해야 함).
 */
export const BASE_CURRENCY = "KRW";
