"use client";

import { useActionState, useState } from "react";
import {
  cancelTradeDocumentAction,
  type CancelDocFormState,
} from "../actions";

/**
 * 무역서류 취소 버튼 — R4: 사유 필수. 삭제가 아니라 상태 전환(issued→cancelled).
 * 취소되면 이 선적의 화물 수정 잠금이 풀리고(다른 활성 문서가 없다면),
 * 재발행 시 새 번호가 발번된다(D1).
 */
export function CancelDocumentButton({
  documentId,
  docNumber,
  shipmentId,
}: {
  documentId: string;
  docNumber: string;
  shipmentId: string;
}) {
  const [state, formAction, pending] = useActionState<CancelDocFormState, FormData>(
    cancelTradeDocumentAction,
    {},
  );
  const [open, setOpen] = useState(false);

  if (state.ok) {
    return (
      <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        {state.ok} 새로고침하면 상태가 갱신됩니다.
      </p>
    );
  }

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          무역서류 취소
        </button>
        {state.error && (
          <p className="mt-1 text-sm text-red-600">{state.error}</p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="rounded-lg border border-red-200 bg-red-50/50 p-4">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <p className="mb-2 text-sm text-red-800">
        <b>{docNumber}</b> 를 취소합니다 — 삭제가 아니라 상태 전환입니다. 문서와
        번호는 이력으로 남고, 이 선적의 화물 수정 잠금이 풀리며(다른 활성 문서가
        없다면), 재발행하면 <b>새 번호</b>가 발번됩니다.
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
          {pending ? "취소 중…" : "확인 — 무역서류 취소"}
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
