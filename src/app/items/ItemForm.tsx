"use client";

import { useActionState } from "react";
import Link from "next/link";
import { saveItemAction, type ItemFormState } from "./actions";
import type { Item } from "@/services/types";
import { CURRENCIES, UNITS } from "@/services/codes";
import { Field, inputClass } from "@/components/Field";

export function ItemForm({ item }: { item?: Item }) {
  const [state, formAction, pending] = useActionState<ItemFormState, FormData>(
    saveItemAction,
    {},
  );

  // 값 우선순위: 에러 후 재시드(state.values) > 수정 대상(item) > 빈값.
  const v = state.values;
  const baseUomDefault = v?.baseUom ?? item?.baseUom ?? "";
  const currencyDefault = v?.currency ?? item?.currency ?? "";
  const stdPriceDefault =
    v?.stdPrice ?? (item?.stdPrice != null ? String(item.stdPrice) : "");
  const isDangerousDefault = v
    ? v.isDangerous === "on"
    : item
      ? item.isDangerous
      : false;
  const lotManagedDefault = v
    ? v.lotManaged === "on"
    : item
      ? item.lotManaged
      : false;
  const serialManagedDefault = v
    ? v.serialManaged === "on"
    : item
      ? item.serialManaged
      : false;
  const activeDefault = v ? v.active === "on" : item ? item.active : true;

  // 기존 값이 코드 목록에 없으면 보존용 sticky 옵션을 더한다(저장 시 소실 방지).
  const baseUomMissing =
    !!baseUomDefault && !UNITS.some((u) => u.code === baseUomDefault);
  const currencyMissing =
    !!currencyDefault && !CURRENCIES.some((c) => c.code === currencyDefault);

  return (
    <form action={formAction} className="space-y-5">
      {item ? <input type="hidden" name="id" value={item.id} /> : null}

      {state.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="품목코드">
          <input
            name="code"
            className={inputClass}
            placeholder="비워두면 자동 미지정 (입력 시 중복 불가)"
            defaultValue={v?.code ?? item?.code ?? ""}
          />
        </Field>
        <Field label="품목명" required>
          <input
            name="name"
            className={inputClass}
            defaultValue={v?.name ?? item?.name ?? ""}
            required
          />
        </Field>
        <Field label="HS코드">
          <input
            name="hsCode"
            className={inputClass}
            defaultValue={v?.hsCode ?? item?.hsCode ?? ""}
          />
        </Field>
        <Field label="단위">
          <select
            name="baseUom"
            className={inputClass}
            defaultValue={baseUomDefault}
          >
            <option value="">선택 안 함</option>
            {baseUomMissing ? (
              <option value={baseUomDefault}>{baseUomDefault} (기존 값)</option>
            ) : null}
            {UNITS.map((u) => (
              <option key={u.code} value={u.code}>
                {u.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="표준단가">
          <input
            name="stdPrice"
            type="number"
            step="0.01"
            min="0"
            className={inputClass}
            defaultValue={stdPriceDefault}
          />
        </Field>
        <Field label="통화">
          <select
            name="currency"
            className={inputClass}
            defaultValue={currencyDefault}
          >
            <option value="">선택 안 함</option>
            {currencyMissing ? (
              <option value={currencyDefault}>{currencyDefault} (기존 값)</option>
            ) : null}
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="원산지">
          <input
            name="originCountry"
            className={inputClass}
            defaultValue={v?.originCountry ?? item?.originCountry ?? ""}
          />
        </Field>
        <Field label="설명" full>
          <textarea
            name="description"
            rows={3}
            className={inputClass}
            defaultValue={v?.description ?? item?.description ?? ""}
          />
        </Field>
      </div>

      {/* 관리 옵션 — 통관/재고 단계에서 쓰는 플래그. 품목 등록 시 함께 받아둔다(소급 불가). */}
      <fieldset className="rounded-lg border border-zinc-200 bg-white p-4">
        <legend className="px-1 text-xs font-medium uppercase tracking-wider text-zinc-400">
          관리 옵션
        </legend>
        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:gap-6">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              name="isDangerous"
              defaultChecked={isDangerousDefault}
              className="h-4 w-4 rounded border-zinc-300"
            />
            위험물 (DG)
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              name="lotManaged"
              defaultChecked={lotManagedDefault}
              className="h-4 w-4 rounded border-zinc-300"
            />
            로트 관리
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              name="serialManaged"
              defaultChecked={serialManagedDefault}
              className="h-4 w-4 rounded border-zinc-300"
            />
            시리얼 관리
          </label>
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          name="active"
          defaultChecked={activeDefault}
          className="h-4 w-4 rounded border-zinc-300"
        />
        활성 (체크 해제 = 비활성. 삭제 대신 비활성으로 보관)
      </label>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "저장 중…" : item ? "수정 저장" : "등록"}
        </button>
        <Link
          href="/items"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
        >
          취소
        </Link>
      </div>
    </form>
  );
}
