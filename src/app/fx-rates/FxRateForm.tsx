"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createFxRateAction, type FxRateFormState } from "./actions";
import { BASE_CURRENCY } from "@/config/company";
import {
  CURRENCIES,
  FX_SOURCE_SUGGESTIONS,
  quoteUnitOf,
  round6,
} from "@/services/codes";
import { Field, inputClass } from "@/components/Field";

export function FxRateForm({ defaultDate }: { defaultDate: string }) {
  const [state, formAction, pending] = useActionState<FxRateFormState, FormData>(
    createFxRateAction,
    {},
  );
  const v = state.values;

  // 기준통화 자신은 선택 대상이 아니다(환율 항상 1). 목록에서 제외.
  const quoteOptions = CURRENCIES.filter((c) => c.code !== BASE_CURRENCY);
  const initialCurrency =
    v?.quoteCurrency ?? quoteOptions[0]?.code ?? "USD";

  const [currency, setCurrency] = useState(initialCurrency);
  const [quoteUnit, setQuoteUnit] = useState(
    v?.quoteUnit ?? String(quoteUnitOf(initialCurrency)),
  );
  const [quotedRate, setQuotedRate] = useState(v?.quotedRate ?? "");

  function onCurrencyChange(next: string) {
    setCurrency(next);
    // 통화가 바뀌면 관례 고시단위로 재설정(JPY→100, 그 외 1). 수동 조정은 이후 가능.
    setQuoteUnit(String(quoteUnitOf(next)));
  }

  const unitNum = Number(quoteUnit) || 0;
  const quotedNum = Number(quotedRate) || 0;
  const normalized =
    unitNum > 0 && quotedNum > 0 ? round6(quotedNum / unitNum) : null;
  const unitLabel = unitNum === 1 ? `1 ${currency}` : `${quoteUnit} ${currency}`;

  return (
    <form action={formAction} className="space-y-6">
      {state.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      <p className="text-sm text-zinc-500">
        기준통화{" "}
        <span className="font-mono font-medium text-zinc-800">{BASE_CURRENCY}</span>{" "}
        <span className="text-zinc-400">
          — 대장에는 <strong>1단위 기준</strong>으로 저장됩니다. 은행이 100단위로
          고시하는 통화(JPY 등)는 고시값 그대로 넣으면 자동 환산됩니다.
        </span>
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="대상통화" required>
          <select
            name="quoteCurrency"
            className={inputClass}
            value={currency}
            onChange={(e) => onCurrencyChange(e.target.value)}
            required
          >
            {quoteOptions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="고시단위 (은행 고시 기준 단위)">
          <input
            name="quoteUnit"
            type="number"
            step="1"
            min="1"
            className={inputClass}
            value={quoteUnit}
            onChange={(e) => setQuoteUnit(e.target.value)}
          />
        </Field>

        <Field label={`환율 (${unitLabel}당 ${BASE_CURRENCY}, 은행 고시값 그대로)`} required>
          <input
            name="quotedRate"
            type="number"
            step="0.0001"
            min="0"
            className={inputClass}
            value={quotedRate}
            onChange={(e) => setQuotedRate(e.target.value)}
            placeholder={unitNum === 100 ? "예: 905" : "예: 1350"}
            required
          />
        </Field>

        <Field label="고시일" required>
          <input
            name="rateDate"
            type="date"
            className={inputClass}
            defaultValue={v?.rateDate ?? defaultDate}
            required
          />
        </Field>

        <Field label="출처">
          <input
            name="source"
            list="fx-source-list"
            className={inputClass}
            defaultValue={v?.source ?? ""}
            placeholder="예: 한국은행"
          />
          <datalist id="fx-source-list">
            {FX_SOURCE_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>

        <Field label="고시 시점 (선택)">
          <input
            name="quotedAt"
            type="datetime-local"
            className={inputClass}
            defaultValue={v?.quotedAt ?? ""}
          />
        </Field>

        <Field label="비고" full>
          <input name="note" className={inputClass} defaultValue={v?.note ?? ""} />
        </Field>
      </div>

      {/* ---------- 실시간 정규화 미리보기 (100배 함정 방지) ---------- */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm">
        {normalized != null ? (
          <p className="text-blue-800">
            입력 <span className="font-mono">{quotedRate}</span> ÷{" "}
            <span className="font-mono">{quoteUnit}</span> ={" "}
            <strong className="font-mono">
              1 {currency}당 {normalized} {BASE_CURRENCY}
            </strong>{" "}
            <span className="text-blue-500">← 대장 저장값</span>
          </p>
        ) : (
          <p className="text-blue-400">
            환율과 고시단위를 입력하면 대장에 저장될 1단위 환산값이 여기에 표시됩니다.
          </p>
        )}
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "저장 중…" : "환율 등록"}
        </button>
        <Link
          href="/fx-rates"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
        >
          취소
        </Link>
      </div>
    </form>
  );
}
