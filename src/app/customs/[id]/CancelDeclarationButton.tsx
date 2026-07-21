"use client";

import { useActionState, useState } from "react";
import { cancelCustomsDeclarationAction, type CancelDeclFormState } from "../actions";

/**
 * 통관신고 취소 버튼 — 사유 필수. 삭제가 아니라 상태 전환(→cancelled).
 * 번호는 이력으로 남는다. draft/filed/accepted 어느 상태든 취소 가능(취소 후 새로 작성).
 */
export function CancelDeclarationButton({
  declarationId,
  declDocNo,
  shipmentId,
}: {
  declarationId: string;
  declDocNo: string;
  shipmentId: string;
}) {
  const [state, formAction, pending] = useActionState<CancelDeclFormState, FormData>(
    cancelCustomsDeclarationAction,
    {},
  );
  const [open, setOpen] = useState(false);

  // 성공 시 액션이 상세로 redirect 한다(CANCELLED 배너로 결과 표시) — 여기서 ok 배너를 그리지 않는다.
  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          통관신고 취소
        </button>
        {state.error && <p className="mt-1 text-sm text-red-600">{state.error}</p>}
      </div>
    );
  }

  return (
    <form action={formAction} className="rounded-lg border border-red-200 bg-red-50/50 p-4">
      <input type="hidden" name="declarationId" value={declarationId} />
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <p className="mb-2 text-sm text-red-800">
        <b>{declDocNo}</b> 를 취소합니다 — 삭제가 아니라 상태 전환입니다. 번호는 이력으로
        남고, 수정이 필요하면 취소 후 새로 작성하세요.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="reason"
          required
          autoFocus
          placeholder="취소 사유 (필수)"
          className="w-72 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? "취소 중…" : "확인 — 통관신고 취소"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          그만두기
        </button>
      </div>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
