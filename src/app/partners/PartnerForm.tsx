"use client";

import { useActionState } from "react";
import Link from "next/link";
import { savePartnerAction, type PartnerFormState } from "./actions";
import type { Partner } from "@/services/types";
import { CURRENCIES, INCOTERMS, PARTNER_TYPES } from "@/services/codes";
import { Field, inputClass } from "@/components/Field";

export function PartnerForm({ partner }: { partner?: Partner }) {
  const [state, formAction, pending] = useActionState<PartnerFormState, FormData>(
    savePartnerAction,
    {},
  );

  // 값 우선순위: 에러 후 재시드(state.values) > 수정 대상(partner) > 빈값.
  const v = state.values;
  const typeDefault = v?.type ?? partner?.type ?? "customer";
  const currencyDefault = v?.currency ?? partner?.currency ?? "";
  const incotermsDefault = v?.incoterms ?? partner?.incoterms ?? "";
  const activeDefault = v ? v.active === "on" : partner ? partner.active : true;

  // 기존 값이 코드 목록에 없으면 보존용 sticky 옵션을 더한다(저장 시 소실 방지).
  const currencyMissing =
    !!currencyDefault && !CURRENCIES.some((c) => c.code === currencyDefault);
  const incotermsMissing =
    !!incotermsDefault && !INCOTERMS.some((c) => c.code === incotermsDefault);

  return (
    <form action={formAction} className="space-y-5">
      {partner ? <input type="hidden" name="id" value={partner.id} /> : null}

      {state.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="거래처명" required>
          <input
            name="name"
            className={inputClass}
            defaultValue={v?.name ?? partner?.name ?? ""}
            required
          />
        </Field>
        <Field label="구분">
          <select name="type" className={inputClass} defaultValue={typeDefault}>
            {typeDefault === "unknown" ? (
              <option value="unknown">미분류 — 구분을 선택하세요</option>
            ) : null}
            {PARTNER_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="국가">
          <input
            name="country"
            className={inputClass}
            defaultValue={v?.country ?? partner?.country ?? ""}
          />
        </Field>
        <Field label="도시">
          <input
            name="city"
            className={inputClass}
            defaultValue={v?.city ?? partner?.city ?? ""}
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
        <Field label="인코텀즈">
          <select
            name="incoterms"
            className={inputClass}
            defaultValue={incotermsDefault}
          >
            <option value="">선택 안 함</option>
            {incotermsMissing ? (
              <option value={incotermsDefault}>{incotermsDefault} (기존 값)</option>
            ) : null}
            {INCOTERMS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="담당자">
          <input
            name="contactName"
            className={inputClass}
            defaultValue={v?.contactName ?? partner?.contactName ?? ""}
          />
        </Field>
        <Field label="이메일">
          <input
            name="contactEmail"
            type="email"
            className={inputClass}
            defaultValue={v?.contactEmail ?? partner?.contactEmail ?? ""}
          />
        </Field>
        <Field label="전화">
          <input
            name="contactPhone"
            className={inputClass}
            defaultValue={v?.contactPhone ?? partner?.contactPhone ?? ""}
          />
        </Field>
        <Field label="결제조건">
          <input
            name="paymentTerms"
            className={inputClass}
            defaultValue={v?.paymentTerms ?? partner?.paymentTerms ?? ""}
          />
        </Field>
        <Field label="주소" full>
          <input
            name="address"
            className={inputClass}
            defaultValue={v?.address ?? partner?.address ?? ""}
          />
        </Field>
        <Field label="비고" full>
          <textarea
            name="notes"
            rows={3}
            className={inputClass}
            defaultValue={v?.notes ?? partner?.notes ?? ""}
          />
        </Field>
      </div>

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
          {pending ? "저장 중…" : partner ? "수정 저장" : "등록"}
        </button>
        <Link
          href="/partners"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
        >
          취소
        </Link>
      </div>
    </form>
  );
}
