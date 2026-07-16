"use client";

import { useActionState, useState } from "react";
import { reverseStockMovementAction, type StockFormState } from "../actions";

/**
 * 역분개 버튼 — 정정의 유일한 수단(원칙 1: "수정이 아니라 역방향 이동 + 재입력").
 *
 * 원행은 건드리지 않는다. 반대부호 행을 하나 더 쌓을 뿐이라 이력이 그대로 남는다.
 * 이 버튼은 역분개 가능한 행에만 뜬다(REVERSAL 아님 + 아직 역분개 안 됨).
 * 단, 화면 판정을 신뢰하지 않는다 — RPC 검사 + DB의 UNIQUE 부분 인덱스가 최종 방어선이다.
 */
export function ReverseButton({
  movementId,
  summary,
}: {
  movementId: string;
  summary: string;
}) {
  const [state, formAction, pending] = useActionState<StockFormState, FormData>(
    reverseStockMovementAction,
    {},
  );
  const [open, setOpen] = useState(false);

  if (state.ok) {
    return <span className="text-xs text-emerald-600">역분개됨</span>;
  }

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          역분개
        </button>
        {state.error && (
          <p className="mt-1 text-xs text-red-600">{state.error}</p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="movementId" value={movementId} />
      <p className="text-xs text-slate-500">{summary} 되돌리기</p>
      <input
        name="memo"
        required
        autoFocus
        placeholder="사유 (필수)"
        className="w-40 rounded border border-slate-300 px-2 py-1 text-xs"
      />
      <div className="flex gap-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          {pending ? "처리 중…" : "확인"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          취소
        </button>
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
