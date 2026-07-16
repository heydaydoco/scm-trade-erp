"use client";

/**
 * 브라우저 인쇄 대화상자를 연다 → 거기서 "PDF로 저장" 선택. (화면 전용, 인쇄 시 숨김)
 *
 * P4.4 공용 추출 — 이전엔 4개 인쇄 페이지가 바이트 단위 동일 사본을 각자 들고
 * 있었다(견적·주문확인서·발주서·거래명세서). 5벌째(S/I) 복붙 대신 여기 한 벌만 둔다.
 * ⚠️ 인쇄 페이지 **본문** 통합은 P4.5 사안 — 여기서는 버튼만 공용화한다.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
    >
      🖨 인쇄 / PDF로 저장
    </button>
  );
}
