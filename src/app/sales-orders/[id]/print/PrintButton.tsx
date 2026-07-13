"use client";

/** 브라우저 인쇄 대화상자를 연다 → 거기서 "PDF로 저장" 선택. (화면 전용, 인쇄 시 숨김) */
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
