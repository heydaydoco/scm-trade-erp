"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveDeliveryAction, type DeliveryFormState } from "./actions";
import { Field, inputClass } from "@/components/Field";
import { round6 } from "@/services/docFlow";
import {
  shortagesOf,
  type OutLineQty,
  type StockProjection,
} from "@/services/stockProjection";

export interface DeliveryFormLine {
  soLineId: string;
  itemId: string | null; // null = 자유텍스트 품목 → 출고 불가
  itemName: string;
  uom: string | null; // 해석된 단위(라인→마스터). null = 단위 불명 → 출고 불가(P4.3f)
  orderedQty: number;
  shippedQty: number;
  openQty: number;
  prefill: number; // 잔량 프리필(음수면 0)
}

/** 현재고 1행 — 뷰의 입도 그대로(품목×창고×**단위**). 서버가 이 모양으로 넘긴다. */
export interface OnHandRow {
  itemId: string;
  warehouseCode: string;
  uom: string;
  onHand: number;
}

/**
 * 출고 등록 폼 — 수주 **참조 생성**(원칙 3: 수기 재입력 화면을 만들지 않는다).
 * 잔량이 프리필돼 있고 사용자는 **수량만 조정**한다. 수량을 비우면 그 줄은 이번에 안 내보낸다.
 *
 * 경고 2종 — 둘 다 **차단이 아니라 확인**(원칙 8):
 *  ① 초과출고(잔량보다 많이)  ② 마이너스 예상재고(현재고보다 많이)
 */
export function DeliveryForm({
  soId,
  soNumber,
  lines,
  defaultDate,
  warehouses,
  onHand,
}: {
  soId: string;
  soNumber: string;
  lines: DeliveryFormLine[];
  defaultDate: string;
  warehouses: string[];
  onHand: OnHandRow[];
}) {
  const [state, formAction, pending] = useActionState<DeliveryFormState, FormData>(
    saveDeliveryAction,
    {},
  );

  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lines.map((l) => [l.soLineId, l.prefill > 0 ? String(l.prefill) : ""]),
    ),
  );
  // 창고를 바꾸면 예상재고가 통째로 달라진다(재고는 창고별) → 상태로 들고 있어야 한다.
  const [warehouse, setWarehouse] = useState(
    warehouses.includes("MAIN") ? "MAIN" : (warehouses[0] ?? "MAIN"),
  );

  const qtyOf = (soLineId: string) =>
    Number((qtys[soLineId] || "").replace(/,/g, ""));

  // 초과출고 판정 — 서비스의 isOverDelivery 와 같은 규칙(여기는 클라이언트라 서버 코드를 못 부른다).
  const over = lines.filter((l) => {
    const q = qtyOf(l.soLineId);
    return Number.isFinite(q) && q > 0 && q > l.openQty;
  });

  // 마이너스 예상재고 — **품목별 합산**(서비스의 순수 로직 그대로. 라인별로 보면 놓친다).
  // ⚠️ 단위별로 나눠 부른다: 재고 뷰의 입도가 품목×창고×단위라 단위를 섞어 더하면
  //    `100 PCS − 10 KG = 90` 같은 거짓 숫자가 나온다(P4.1f에서 실제로 교정한 함정).
  const onHandIndex = new Map(
    onHand.map((r) => [`${r.itemId}|${r.warehouseCode}|${r.uom}`, r.onHand]),
  );
  const byUom = new Map<string, OutLineQty[]>();
  for (const l of lines) {
    const q = qtyOf(l.soLineId);
    // 단위 불명 라인(l.uom === null)은 저장 자체가 잠기므로 집계에서도 뺀다.
    if (!l.itemId || !l.uom || !Number.isFinite(q) || q <= 0) continue;
    const group = byUom.get(l.uom) ?? [];
    group.push({ itemId: l.itemId, itemName: l.itemName, qty: q, uom: l.uom });
    byUom.set(l.uom, group);
  }
  const shortages: StockProjection[] = [];
  for (const [uom, group] of byUom) {
    const onHandByItem: Record<string, number> = {};
    for (const g of group) {
      onHandByItem[g.itemId] =
        onHandIndex.get(`${g.itemId}|${warehouse}|${uom}`) ?? 0;
    }
    shortages.push(...shortagesOf(group, onHandByItem));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const blocks: string[] = [];

    if (over.length > 0) {
      blocks.push(
        "[수주 잔량 초과]\n" +
          over
            .map((l) => {
              const q = qtyOf(l.soLineId);
              return `· ${l.itemName}: 잔량 ${l.openQty} → 출고 ${q} (${round6(
                q - l.openQty,
              )} 초과)`;
            })
            .join("\n"),
      );
    }

    if (shortages.length > 0) {
      blocks.push(
        `[마이너스 재고 예상 — 창고 ${warehouse}]\n` +
          shortages
            .map(
              (s) =>
                `· ${s.itemName}: 현재 ${s.onHand} → 예상 ${s.projected} ${s.uom} (출고 ${s.outQty})`,
            )
            .join("\n"),
      );
    }

    if (blocks.length === 0) return;

    const ok = window.confirm(
      `${blocks.join("\n\n")}\n\n` +
        `마이너스 재고는 어딘가 입고 전기가 누락됐다는 신호일 수 있습니다.\n` +
        `막지는 않습니다. 그대로 진행할까요?`,
    );
    if (!ok) e.preventDefault();
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="soId" value={soId} />
      <input type="hidden" name="lineCount" value={lines.length} />

      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="수주">
          <input
            value={soNumber}
            readOnly
            className={`${inputClass} bg-slate-50 text-slate-500`}
          />
        </Field>
        <Field label="출고일 (증빙일)">
          <input
            type="date"
            name="deliveryDate"
            defaultValue={defaultDate}
            className={inputClass}
          />
        </Field>
        <Field label="창고">
          <select
            name="warehouseCode"
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
            className={inputClass}
          >
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
              <th className="px-3 py-2 text-right">수주</th>
              <th className="px-3 py-2 text-right">기출고</th>
              <th className="px-3 py-2 text-right">잔량</th>
              <th className="px-3 py-2 text-right">이번 출고</th>
              <th className="px-3 py-2 text-right">예상재고</th>
              <th className="px-3 py-2">로트</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, i) => {
              const q = qtyOf(l.soLineId);
              const isOver = Number.isFinite(q) && q > 0 && q > l.openQty;
              // 단위 불명(라인·마스터 모두 없음)도 잠근다 — 단위 없는 수량은 원장에 못 들어간다(P4.3f).
              const noUom = l.itemId !== null && l.uom === null;
              const blocked = l.itemId === null || noUom;
              // 이 줄의 품목이 마이너스가 되는가 — 합산 결과에서 찾는다(같은 품목 여러 줄).
              const short =
                l.itemId && l.uom
                  ? shortages.find((s) => s.itemId === l.itemId && s.uom === l.uom)
                  : undefined;
              return (
                <tr key={l.soLineId} className={blocked ? "bg-slate-50" : ""}>
                  <td className="px-3 py-2">
                    {l.itemName}
                    {l.itemId === null && (
                      <div className="text-xs text-amber-700">
                        품목 마스터 미연결 — 출고 불가
                      </div>
                    )}
                    {noUom && (
                      <div className="text-xs text-amber-700">
                        단위 없음 — 출고 불가 (품목 마스터에 단위를 입력하세요)
                      </div>
                    )}
                    <input type="hidden" name={`lines[${i}].soLineId`} value={l.soLineId} />
                    <input type="hidden" name={`lines[${i}].itemId`} value={l.itemId ?? ""} />
                    <input type="hidden" name={`lines[${i}].itemName`} value={l.itemName} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.orderedQty}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {l.shippedQty}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {l.openQty}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      name={`lines[${i}].qty`}
                      value={qtys[l.soLineId] ?? ""}
                      onChange={(e) =>
                        setQtys((p) => ({ ...p, [l.soLineId]: e.target.value }))
                      }
                      disabled={blocked}
                      inputMode="decimal"
                      placeholder="0"
                      className={`w-24 rounded border px-2 py-1 text-right ${
                        isOver ? "border-amber-400 bg-amber-50" : "border-slate-300"
                      } disabled:bg-slate-100`}
                    />
                    {isOver && <div className="text-xs text-amber-700">잔량 초과</div>}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {short ? (
                      <span className="font-medium text-red-600">
                        {short.onHand} → {short.projected}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
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
        잔량이 미리 채워져 있습니다. <b>수량만 조정</b>하세요 — 이번에 안 내보내는 품목은
        수량을 비우면 됩니다. 나머지는 나중에 다시 출고하면 됩니다(부분출고).
      </p>

      {over.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ⚠️ 수주 잔량보다 많이 출고합니다({over.length}줄). 막지는 않지만 저장 시 확인합니다.
        </p>
      )}

      {shortages.length > 0 && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
          ⚠️ <b>마이너스 재고가 됩니다</b> (창고 {warehouse}) — 막지는 않지만 저장 시
          확인합니다(원칙 8).
          <ul className="mt-1 space-y-0.5 text-xs">
            {shortages.map((s) => (
              <li key={`${s.itemId}|${s.uom}`}>
                · {s.itemName}: 현재 {s.onHand} → 예상{" "}
                <b>{s.projected}</b> {s.uom} (이번 출고 {s.outQty})
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs opacity-80">
            마이너스는 어딘가 <b>입고 전기가 누락</b>됐다는 신호입니다 — 재고를 먼저
            확인하는 편이 좋습니다.
          </p>
        </div>
      )}

      <Field label="비고" full>
        <input name="memo" className={inputClass} placeholder="선택 — 예: 1차 부분출고" />
      </Field>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "저장 중…" : "출고 등록"}
        </button>
        <Link href={`/sales-orders/${soId}`} className="text-sm text-slate-500 underline">
          취소하고 수주로
        </Link>
      </div>
      <p className="text-xs text-slate-500">
        저장하면 재고가 즉시 줄어들고(원장 DLV_OUT), <b>이 수주는 잠깁니다</b>. 잘못
        넣었으면 출고를 취소하세요 — 원장이 역분개로 원복되고 수주 잠금도 풀립니다.
      </p>
    </form>
  );
}
