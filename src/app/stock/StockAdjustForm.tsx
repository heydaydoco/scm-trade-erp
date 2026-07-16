"use client";

import { useActionState, useRef, useState } from "react";
import { saveStockAdjustmentAction, type StockFormState } from "./actions";
import { ADJUSTMENT_TYPES } from "@/services/codes";
import { Field, inputClass } from "@/components/Field";

export interface StockItemOption {
  id: string;
  code: string | null;
  name: string;
  uom: string;
}

/** 품목×창고 현재고 — 저장 전 예상재고를 화면에서 미리 계산하기 위한 조회표. */
export type OnHandMap = Record<string, number>;

export function StockAdjustForm({
  items,
  onHand,
  warehouses,
  defaultDate,
}: {
  items: StockItemOption[];
  onHand: OnHandMap; // key: `${itemId}|${warehouseCode}`
  warehouses: string[];
  defaultDate: string; // KST 오늘
}) {
  const [state, formAction, pending] = useActionState<StockFormState, FormData>(
    saveStockAdjustmentAction,
    {},
  );
  const v = state.values;
  const formRef = useRef<HTMLFormElement>(null);

  const [itemId, setItemId] = useState(v?.itemId ?? "");
  const [movementType, setMovementType] = useState(v?.movementType ?? "INIT");
  const [qty, setQty] = useState(v?.qty ?? "");
  const [warehouseCode, setWarehouseCode] = useState(v?.warehouseCode ?? "MAIN");
  const [showLot, setShowLot] = useState(Boolean(v?.lotNo));

  const item = items.find((i) => i.id === itemId);
  const current = onHand[`${itemId}|${warehouseCode}`] ?? 0;

  // 저장 전 예상재고 — 원칙 8(마이너스는 차단이 아니라 경고 후 허용)의 근거.
  // 서비스의 projectedOnHand와 같은 규칙이지만, 여기는 클라이언트라 서버 코드를 못 부른다.
  const qtyNum = Number((qty || "").replace(/,/g, ""));
  const qtyValid = Number.isFinite(qtyNum) && qtyNum > 0;
  const sign = movementType === "ADJ_OUT" ? -1 : 1;
  const projected = qtyValid
    ? Math.round((current + sign * Math.abs(qtyNum)) * 1e6) / 1e6
    : current;
  const willGoNegative = qtyValid && projected < 0;

  /**
   * 마이너스가 되면 **막지 않고 확인만 받는다**(원칙 8 — 제조·무역은 입고 전기가 늦는 게 현실).
   * 취소하면 저장을 중단한다.
   */
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (willGoNegative) {
      const ok = window.confirm(
        `현재고가 ${projected}${item ? " " + item.uom : ""} 가 됩니다(마이너스).\n\n` +
          `입고 전기가 아직 안 된 경우일 수 있습니다. 그대로 진행할까요?\n` +
          `(마이너스 재고는 홈 화면에 표시되어 추적됩니다)`,
      );
      if (!ok) e.preventDefault();
    }
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="space-y-4">
      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {state.ok}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="품목" required>
          <select
            name="itemId"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            className={inputClass}
            required
          >
            <option value="">선택하세요</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code ? `[${i.code}] ` : ""}
                {i.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="조정 유형" required>
          <select
            name="movementType"
            value={movementType}
            onChange={(e) => setMovementType(e.target.value)}
            className={inputClass}
            required
          >
            {ADJUSTMENT_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label} ({t.sign > 0 ? "+" : "−"})
              </option>
            ))}
          </select>
        </Field>

        <Field label="수량" required>
          <input
            name="qty"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="decimal"
            placeholder="양수로 입력 (증가·감소는 유형이 정합니다)"
            className={inputClass}
            required
          />
        </Field>

        <Field label="창고">
          <select
            name="warehouseCode"
            value={warehouseCode}
            onChange={(e) => setWarehouseCode(e.target.value)}
            className={inputClass}
          >
            {warehouses.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </Field>

        <Field label="증빙일">
          <input
            type="date"
            name="movedAt"
            defaultValue={v?.movedAt ?? defaultDate}
            className={inputClass}
          />
        </Field>
      </div>

      {/* 예상재고 — 저장 누르기 전에 결과를 보여준다(환율 폼의 ÷단위 미리보기와 같은 사상). */}
      {itemId && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            willGoNegative
              ? "bg-red-50 text-red-800"
              : "bg-blue-50 text-blue-800"
          }`}
        >
          현재고 <b>{current}</b>
          {qtyValid && (
            <>
              {" "}
              {sign > 0 ? "+" : "−"} <b>{Math.abs(qtyNum)}</b> ={" "}
              <b>{projected}</b>
            </>
          )}
          {item ? ` ${item.uom}` : ""}
          <span className="text-xs opacity-70">
            {" "}
            · {warehouseCode}
          </span>
          {willGoNegative && (
            <div className="mt-1 text-xs">
              ⚠️ 마이너스가 됩니다. 막지는 않지만(입고 전기가 늦는 경우가 있어)
              저장 시 한 번 더 확인하고, 홈 화면에 표시됩니다.
            </div>
          )}
        </div>
      )}

      {/* 로트는 P5에서 활성화 — 칸은 지금부터 있다(원장은 나중에 백필할 수 없다). */}
      {!showLot ? (
        <button
          type="button"
          onClick={() => setShowLot(true)}
          className="text-xs text-slate-500 underline"
        >
          + 로트번호 입력 (선택)
        </button>
      ) : (
        <Field label="로트번호">
          <input
            name="lotNo"
            defaultValue={v?.lotNo ?? ""}
            className={inputClass}
            placeholder="선택 — 로트 추적 기능은 P5에서 켜집니다"
          />
        </Field>
      )}

      <Field label="사유 (메모)" required full>
        <input
          name="memo"
          defaultValue={v?.memo ?? ""}
          className={inputClass}
          placeholder="예: 기초재고 등록 / 실사 차이 조정 / 파손 폐기"
          required
        />
      </Field>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "저장 중…" : "재고 조정 등록"}
        </button>
        <span className="text-xs text-slate-500">
          등록 후에는 수정·삭제할 수 없습니다. 잘못 넣었으면 원장에서 역분개하세요(원칙 1).
        </span>
      </div>
    </form>
  );
}
