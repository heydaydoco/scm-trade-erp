"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveReceiptAction, type ReceiptFormState } from "./actions";
import { Field, inputClass } from "@/components/Field";

export interface ReceiptFormLine {
  poLineId: string;
  itemId: string | null; // null = 자유텍스트 품목 → 입고 불가
  itemName: string;
  uom: string | null; // 해석된 단위(라인→마스터). null = 단위 불명 → 입고 불가(P4.3f)
  orderedQty: number;
  receivedQty: number;
  openQty: number;
  prefill: number; // 잔량 프리필(음수면 0)
}

/**
 * 입고 등록 폼 — 발주 **참조 생성**(원칙 3: 수기 재입력 화면을 만들지 않는다).
 * 잔량이 프리필돼 있고 사용자는 **수량만 조정**한다. 수량을 비우면 그 줄은 이번에 안 받는다.
 */
export function ReceiptForm({
  poId,
  poNumber,
  lines,
  defaultDate,
  warehouses,
}: {
  poId: string;
  poNumber: string;
  lines: ReceiptFormLine[];
  defaultDate: string;
  warehouses: string[];
}) {
  const [state, formAction, pending] = useActionState<ReceiptFormState, FormData>(
    saveReceiptAction,
    {},
  );

  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lines.map((l) => [l.poLineId, l.prefill > 0 ? String(l.prefill) : ""]),
    ),
  );

  // 초과입고 판정 — 서비스의 isOverReceipt 와 같은 규칙(여기는 클라이언트라 서버 코드를 못 부른다).
  const over = lines.filter((l) => {
    const q = Number((qtys[l.poLineId] || "").replace(/,/g, ""));
    return Number.isFinite(q) && q > 0 && q > l.openQty;
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (over.length > 0) {
      const detail = over
        .map((l) => {
          const q = Number((qtys[l.poLineId] || "").replace(/,/g, ""));
          return `· ${l.itemName}: 잔량 ${l.openQty} → 입고 ${q} (${q - l.openQty} 초과)`;
        })
        .join("\n");
      const ok = window.confirm(
        `발주 잔량보다 많이 입고합니다.\n\n${detail}\n\n` +
          `공급사가 더 보냈거나 발주 수량이 틀렸을 수 있습니다.\n` +
          `막지는 않습니다. 그대로 진행할까요?`,
      );
      if (!ok) e.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="poId" value={poId} />
      <input type="hidden" name="lineCount" value={lines.length} />

      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="발주">
          <input
            value={poNumber}
            readOnly
            className={`${inputClass} bg-slate-50 text-slate-500`}
          />
        </Field>
        <Field label="입고일 (증빙일)">
          <input
            type="date"
            name="receiptDate"
            defaultValue={defaultDate}
            className={inputClass}
          />
        </Field>
        <Field label="창고">
          <select name="warehouseCode" defaultValue="MAIN" className={inputClass}>
            {warehouses.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">품목</th>
              <th className="px-3 py-2 text-right">발주</th>
              <th className="px-3 py-2 text-right">기입고</th>
              <th className="px-3 py-2 text-right">잔량</th>
              <th className="px-3 py-2 text-right">이번 입고</th>
              <th className="px-3 py-2">로트</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, i) => {
              const q = Number((qtys[l.poLineId] || "").replace(/,/g, ""));
              const isOver = Number.isFinite(q) && q > 0 && q > l.openQty;
              // 단위 불명(라인·마스터 모두 없음)도 잠근다 — 단위 없는 수량은 원장에 못 들어간다(P4.3f).
              const noUom = l.itemId !== null && l.uom === null;
              const blocked = l.itemId === null || noUom;
              return (
                <tr key={l.poLineId} className={blocked ? "bg-slate-50" : ""}>
                  <td className="px-3 py-2">
                    {l.itemName}
                    {l.itemId === null && (
                      <div className="text-xs text-amber-700">
                        품목 마스터 미연결 — 입고 불가
                      </div>
                    )}
                    {noUom && (
                      <div className="text-xs text-amber-700">
                        단위 없음 — 입고 불가 (품목 마스터에 단위를 입력하세요)
                      </div>
                    )}
                    <input type="hidden" name={`lines[${i}].poLineId`} value={l.poLineId} />
                    <input type="hidden" name={`lines[${i}].itemId`} value={l.itemId ?? ""} />
                    <input type="hidden" name={`lines[${i}].itemName`} value={l.itemName} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.orderedQty}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {l.receivedQty}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {l.openQty}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      name={`lines[${i}].qty`}
                      value={qtys[l.poLineId] ?? ""}
                      onChange={(e) =>
                        setQtys((p) => ({ ...p, [l.poLineId]: e.target.value }))
                      }
                      disabled={blocked}
                      inputMode="decimal"
                      placeholder="0"
                      className={`w-24 rounded border px-2 py-1 text-right ${
                        isOver ? "border-amber-400 bg-amber-50" : "border-slate-300"
                      } disabled:bg-slate-100`}
                    />
                    {isOver && (
                      <div className="text-xs text-amber-700">잔량 초과</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      name={`lines[${i}].lotNo`}
                      disabled={blocked}
                      placeholder="선택"
                      className="w-24 rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        잔량이 미리 채워져 있습니다. <b>수량만 조정</b>하세요 — 이번에 안 받는 품목은
        수량을 비우면 됩니다. 나머지는 나중에 다시 입고하면 됩니다(부분입고).
      </p>

      {over.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ⚠️ 잔량보다 많이 입고합니다({over.length}줄). 막지는 않지만 저장 시 확인합니다 —
          공급사가 더 보냈거나 발주 수량이 틀렸을 수 있습니다.
        </p>
      )}

      <Field label="비고" full>
        <input name="memo" className={inputClass} placeholder="선택 — 예: 1차 부분입고" />
      </Field>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "저장 중…" : "입고 등록"}
        </button>
        <Link href={`/purchase-orders/${poId}`} className="text-sm text-slate-500 underline">
          취소하고 발주로
        </Link>
      </div>
      <p className="text-xs text-slate-500">
        저장하면 재고가 즉시 늘어나고(원장 GR_IN), <b>이 발주는 잠깁니다</b>. 잘못 넣었으면
        입고를 취소하세요 — 원장이 역분개로 원복되고 발주 잠금도 풀립니다.
      </p>
    </form>
  );
}
