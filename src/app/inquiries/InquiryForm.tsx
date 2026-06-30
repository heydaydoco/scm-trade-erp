"use client";

import { useActionState, useState, type ReactNode } from "react";
import Link from "next/link";
import { saveInquiryAction, type InquiryFormState } from "./actions";
import type { Inquiry } from "@/services/types";
import {
  INCOTERMS,
  INQUIRY_STATUS,
  PAYMENT_TERMS,
  TRANSPORT,
  UNITS,
} from "@/services/codes";
import { Field, inputClass } from "@/components/Field";

export interface PartnerOption {
  id: string;
  name: string;
  country: string | null;
}
export interface ItemOption {
  id: string;
  name: string;
  hsCode: string | null;
  baseUom: string | null;
}

/** 전체 폭 섹션 구분선 */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="sm:col-span-2">
      <p className="border-b border-zinc-100 pb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {children}
      </p>
    </div>
  );
}

export function InquiryForm({
  inquiry,
  partners,
  items,
  defaultDate,
}: {
  inquiry?: Inquiry;
  partners: PartnerOption[];
  items: ItemOption[];
  defaultDate: string;
}) {
  const [state, formAction, pending] = useActionState<
    InquiryFormState,
    FormData
  >(saveInquiryAction, {});

  // 값 우선순위: 에러 후 재시드(state.values) > 수정 대상(inquiry) > 빈값/기본.
  const v = state.values;

  // 품목 정보 — 자유텍스트 + 소프트 링크. 내부 state라 에러 재렌더에도 입력값 유지.
  const [productId, setProductId] = useState(
    v?.productId ?? inquiry?.productId ?? "",
  );
  const [productName, setProductName] = useState(
    v?.productName ?? inquiry?.productName ?? "",
  );
  const [hsCode, setHsCode] = useState(v?.hsCode ?? inquiry?.hsCode ?? "");
  const [unit, setUnit] = useState(v?.unit ?? inquiry?.unit ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);

  const query = productName.trim().toLowerCase();
  const matches = (
    query
      ? items.filter((i) => i.name.toLowerCase().includes(query))
      : items
  ).slice(0, 8);

  function selectItem(it: ItemOption) {
    setProductId(it.id);
    setProductName(it.name);
    setHsCode(it.hsCode ?? "");
    setUnit(it.baseUom ?? "");
    setPickerOpen(false);
  }

  const partnerDefault = v?.partnerId ?? inquiry?.partnerId ?? "";
  const transportDefault = v?.transport ?? inquiry?.transport ?? "";
  const incotermsDefault = v?.incoterms ?? inquiry?.incoterms ?? "";
  const paymentDefault = v?.paymentTerms ?? inquiry?.paymentTerms ?? "";
  const statusDefault = v?.status ?? inquiry?.status ?? "received";
  const sampleDefault = v ? v.sampleRequested === "on" : (inquiry?.sampleRequested ?? false);
  const ndaDefault = v ? v.ndaRequired === "on" : (inquiry?.ndaRequired ?? false);

  // 기존 값이 코드/목록에 없으면 보존용 sticky 옵션을 더한다(저장 시 소실 방지).
  const partnerMissing =
    !!partnerDefault && !partners.some((p) => p.id === partnerDefault);
  const unitMissing = !!unit && !UNITS.some((u) => u.code === unit);
  const incotermsMissing =
    !!incotermsDefault && !INCOTERMS.some((c) => c.code === incotermsDefault);
  const paymentMissing =
    !!paymentDefault && !PAYMENT_TERMS.some((c) => c.code === paymentDefault);

  return (
    <form action={formAction} className="space-y-5">
      {inquiry ? <input type="hidden" name="id" value={inquiry.id} /> : null}
      {/* 품목 소프트 링크 (선택 시 채워지고, 자유 입력 시 빈값) */}
      <input type="hidden" name="productId" value={productId} />

      {state.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SectionTitle>기본</SectionTitle>
        <Field label="거래처" required>
          <select
            name="partnerId"
            className={inputClass}
            defaultValue={partnerDefault}
            required
          >
            <option value="">거래처 선택</option>
            {partnerMissing ? (
              <option value={partnerDefault}>
                {inquiry?.partnerName ?? partnerDefault} (기존 값)
              </option>
            ) : null}
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.country ? ` (${p.country})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="접수일" required>
          <input
            name="inquiryDate"
            type="date"
            className={inputClass}
            defaultValue={v?.inquiryDate ?? inquiry?.inquiryDate ?? defaultDate}
            required
          />
        </Field>

        <SectionTitle>품목 정보</SectionTitle>
        <Field label="품목 (검색 또는 직접 입력)" required full>
          <div className="relative">
            <input
              name="productName"
              className={inputClass}
              autoComplete="off"
              placeholder="등록된 품목 검색 또는 새 품목명 직접 입력…"
              value={productName}
              onChange={(e) => {
                setProductName(e.target.value);
                setProductId(""); // 자유 입력 시 링크 해제
                setPickerOpen(true);
              }}
              onFocus={() => setPickerOpen(true)}
              onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
              required
            />
            {pickerOpen && matches.length > 0 ? (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
                {matches.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectItem(it);
                      }}
                      className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-50"
                    >
                      <span className="text-zinc-800">{it.name}</span>
                      <span className="font-mono text-xs text-zinc-400">
                        {it.hsCode ?? ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {productId ? (
              <span className="text-blue-600">
                ✓ 품목 마스터에 연결됨{" "}
                <button
                  type="button"
                  onClick={() => setProductId("")}
                  className="underline hover:text-blue-800"
                >
                  링크 해제
                </button>
              </span>
            ) : (
              "미연결(자유 입력) — 목록에서 고르면 품목 마스터에 연결됩니다."
            )}
          </p>
        </Field>
        <Field label="HS코드">
          <input
            name="hsCode"
            className={inputClass}
            value={hsCode}
            onChange={(e) => setHsCode(e.target.value)}
          />
        </Field>
        <Field label="수량">
          <input
            name="quantity"
            type="number"
            step="0.01"
            min="0"
            className={inputClass}
            defaultValue={v?.quantity ?? (inquiry?.quantity != null ? String(inquiry.quantity) : "")}
          />
        </Field>
        <Field label="단위">
          <select
            name="unit"
            className={inputClass}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          >
            <option value="">선택 안 함</option>
            {unitMissing ? <option value={unit}>{unit} (기존 값)</option> : null}
            {UNITS.map((u) => (
              <option key={u.code} value={u.code}>
                {u.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="운송 방법">
          <select
            name="transport"
            className={inputClass}
            defaultValue={transportDefault}
          >
            <option value="">선택 안 함</option>
            {TRANSPORT.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        <SectionTitle>목적지</SectionTitle>
        <Field label="목적지 국가">
          <input
            name="destinationCountry"
            className={inputClass}
            defaultValue={
              v?.destinationCountry ?? inquiry?.destinationCountry ?? ""
            }
          />
        </Field>
        <div className="hidden sm:block" />
        <Field label="목적지 항구">
          <input
            name="destinationPort"
            className={inputClass}
            placeholder="예: Genoa, Hamburg"
            defaultValue={v?.destinationPort ?? inquiry?.destinationPort ?? ""}
          />
        </Field>
        <Field label="목적지 공항">
          <input
            name="destinationAirport"
            className={inputClass}
            placeholder="예: MXP, LHR, JFK"
            defaultValue={
              v?.destinationAirport ?? inquiry?.destinationAirport ?? ""
            }
          />
        </Field>

        <SectionTitle>거래 조건</SectionTitle>
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
        <Field label="결제조건">
          <select
            name="paymentTerms"
            className={inputClass}
            defaultValue={paymentDefault}
          >
            <option value="">선택 안 함</option>
            {paymentMissing ? (
              <option value={paymentDefault}>{paymentDefault} (기존 값)</option>
            ) : null}
            {PAYMENT_TERMS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="납기 요청일">
          <input
            name="requiredDeliveryDate"
            type="date"
            className={inputClass}
            defaultValue={
              v?.requiredDeliveryDate ?? inquiry?.requiredDeliveryDate ?? ""
            }
          />
        </Field>
        <Field label="상태">
          <select
            name="status"
            className={inputClass}
            defaultValue={statusDefault}
          >
            {INQUIRY_STATUS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <SectionTitle>기타</SectionTitle>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            name="sampleRequested"
            defaultChecked={sampleDefault}
            className="h-4 w-4 rounded border-zinc-300"
          />
          샘플 요청됨
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            name="ndaRequired"
            defaultChecked={ndaDefault}
            className="h-4 w-4 rounded border-zinc-300"
          />
          NDA 필요
        </label>
        <Field label="비고" full>
          <textarea
            name="notes"
            rows={3}
            className={inputClass}
            placeholder="특이사항, 바이어 요구사항 등"
            defaultValue={v?.notes ?? inquiry?.notes ?? ""}
          />
        </Field>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "저장 중…" : inquiry ? "수정 저장" : "등록"}
        </button>
        <Link
          href="/inquiries"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
        >
          취소
        </Link>
      </div>
    </form>
  );
}
