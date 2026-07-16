"use client";

import { useActionState, useState } from "react";
import { cancelReceiptAction, type ReceiptFormState } from "../actions";

/**
 * 입고 취소 — 삭제가 아니라 상태 + **원장 역분개**(원칙 1·5).
 * 원장 행은 지워지지 않고 반대부호 REVERSAL 이 쌓인다. 발주 잠금도 함께 풀린다.
 * 이중 취소는 RPC 검사 + reversal_of_id UNIQUE 부분 인덱스가 차단한다.
 */
export function CancelReceiptButton({
  receiptId,
  grNo,
}: {
  receiptId: string;
  grNo: string;
}) {
  const [state, formAction, pending] = useActionState<ReceiptFormState, FormData>(
    cancelReceiptAction,
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
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
        >
          입고 취소
        </button>
        {state.error && <p className="mt-1 text-sm text-red-600">{state.error}</p>}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
      <input type="hidden" name="receiptId" value={receiptId} />
      <p className="text-sm text-red-900">
        <b>{grNo}</b> 입고를 취소합니다. 재고가 역분개로 원복되고, 이 입고가 잠그고 있던
        발주의 잠금이 풀립니다. 기록은 지워지지 않고 &apos;취소&apos; 상태로 남습니다.
      </p>
      <input
        name="memo"
        required
        autoFocus
        placeholder="취소 사유 (필수)"
        className="w-full rounded border border-red-300 px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {pending ? "취소 중…" : "확인 — 입고 취소"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
        >
          그만두기
        </button>
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
