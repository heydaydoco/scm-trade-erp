/**
 * 자사(Seller) 정보 — 견적서(Proforma Invoice) "From (Seller)" 블록과
 * 무역서류(CI/PL, P4.5) Seller 스냅샷의 단일 원천이다.
 *
 * ⚠️ 지금은 플레이스홀더입니다. 실제 문서를 거래처에 보내기 전에, 아래 값들을
 *    회사의 진짜 정보로 바꾸세요. 이 파일(src/config/company.ts) 한 곳만 고치면
 *    모든 문서에 반영됩니다.
 *
 * ⚠️ D7(P4.5): 무역서류 발행은 기본 필드(회사명·주소·국가·연락처·사업자번호)가
 *    플레이스홀더/공란이면 **서버(RPC)가 거부**합니다 — 발행이 막히는 것이 정상 동작.
 *    은행·서명자는 선택: 값이 있으면 CI에 인쇄, 공란이면 해당 섹션 생략.
 */
export const SELLER = {
  name: "Your Company Co., Ltd.", // ← 회사명
  addressLines: [
    "123 Example-ro, Gangnam-gu", // ← 주소 1줄
    "Seoul 06000, Republic of Korea", // ← 주소 2줄
  ],
  country: "", // ← 국가(영문, 예: Republic of Korea). 공란이면 무역서류 발행 거부(D7)
  tel: "+82-2-0000-0000", // ← 전화
  email: "sales@yourcompany.com", // ← 이메일
  bizRegNo: "000-00-00000", // ← 사업자등록번호
  /** 은행 블록(선택, D7) — 전부 채우면 CI에 Bank Details 인쇄, 공란이면 섹션 생략. */
  bank: {
    bankName: "", // ← 은행명 (영문)
    accountNo: "", // ← 계좌번호
    swift: "", // ← SWIFT/BIC
  },
  /** 서명자(선택, D7) — 채우면 CI 서명 블록에 인쇄, 공란이면 이름·직함 줄 생략. */
  signatory: {
    name: "", // ← 서명자 이름 (영문)
    title: "", // ← 직함 (예: Director)
  },
};

/**
 * 기준통화(Base Currency) — 원칙 1-B.
 * 모든 외화 금액을 이 통화로 환산해 합산·보고한다. 환율 대장(fx_rates)과 문서 환율은
 * "1 문서통화 = rate × 기준통화"로 표기한다 (예: 1 USD = 1,350 KRW → rate=1350).
 * 한국 수출입 기업 기준 KRW. 바꾸려면 이 한 줄만 고치면 된다(대장의 base_currency와 일치해야 함).
 */
export const BASE_CURRENCY = "KRW";
