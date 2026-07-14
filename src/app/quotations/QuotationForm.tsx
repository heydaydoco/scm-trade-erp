"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { saveQuotationAction, type QuotationFormState } from "./actions";
import type { LatestRate, Quotation, QuotationInput } from "@/services/types";
import {
  CURRENCIES,
  CURRENCY_SYMBOL,
  DEFAULT_QUOTATION_TERMS,
  INCOTERMS,
  PAYMENT_TERMS,
  QUOTATION_STATUS,
  round2,
  TRANSPORT,
  UNITS,
} from "@/services/codes";
import { BASE_CURRENCY } from "@/config/company";
import { useFxPrefill } from "@/lib/useFxPrefill";
import { Field, inputClass } from "@/components/Field";
import { FxHint } from "@/components/FxHint";

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
  stdPrice: number | null;
}

/** 라인 에디터 내부 행 (수량·단가는 입력 문자열로 보관). */
interface LineRow {
  key: string;
  productId: string;
  productName: string;
  hsCode: string;
  unit: string;
  quantity: string;
  unitPrice: string;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="sm:col-span-2">
      <p className="border-b border-zinc-100 pb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {children}
      </p>
    </div>
  );
}

function fmt(n: number): string {
  // 고정 로케일 — SSR(서버)과 클라이언트 출력이 결정적이어야 하이드레이션 불일치가 없다.
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function QuotationForm({
  quotation,
  draft,
  partners,
  items,
  defaultDate,
  rates,
}: {
  quotation?: Quotation;
  draft?: QuotationInput;
  partners: PartnerOption[];
  items: ItemOption[];
  defaultDate: string;
  rates: Record<string, LatestRate>;
}) {
  const [state, formAction, pending] = useActionState<
    QuotationFormState,
    FormData
  >(saveQuotationAction, {});
  const v = state.values;

  // 빈 라인 (key는 호출부에서 결정)
  const blankLine = (key: string): LineRow => ({
    key,
    productId: "",
    productName: "",
    hsCode: "",
    unit: "",
    quantity: "",
    unitPrice: "",
  });

  // 라인 초기값: 수정(quotation) > 참조생성(draft) > 빈 1행.
  // 초기 key는 결정적(ln-init-*) — 렌더 중 ref 접근 금지.
  const [lines, setLines] = useState<LineRow[]>(() => {
    const src = quotation?.lines?.length
      ? quotation.lines
      : draft?.lines?.length
        ? draft.lines
        : null;
    if (!src) return [blankLine("ln-init-0")];
    return src.map((l, i) => ({
      key: `ln-init-${i}`,
      productId: l.productId ?? "",
      productName: l.productName ?? "",
      hsCode: l.hsCode ?? "",
      unit: l.unit ?? "",
      quantity: l.quantity != null ? String(l.quantity) : "",
      unitPrice: l.unitPrice != null ? String(l.unitPrice) : "",
    }));
  });
  // 추가 행 key는 ref 카운터 — 이벤트 핸들러(addLine)에서만 접근.
  const keyCounter = useRef(0);
  const makeKey = () => `ln-${keyCounter.current++}`;
  const [openKey, setOpenKey] = useState<string | null>(null);

  // 통화·할인은 실시간 합계 표시를 위해 controlled
  const initialCurrency =
    v?.currency ?? quotation?.currency ?? draft?.currency ?? "USD";
  const [currency, setCurrency] = useState(initialCurrency);
  const [discount, setDiscount] = useState(
    v?.discount ??
      (quotation ? String(quotation.discount) : draft ? String(draft.discount) : "0"),
  );

  // 환율 프리필(원칙 1-B) — 통화 선택 시 대장 최신값 자동 채움, 수동 수정 가능.
  // 견적은 확정 환율 스냅샷이 따로 없으므로(문의엔 환율 없음) 신규·문의드래프트 모두 프리필 대상.
  // 기존 견적 수정(quotation)·에러재시드(v)는 저장된 값을 존중해 덮지 않는다.
  // ※ 견적 RPC(save_quotation)는 출처 컬럼이 없어 rate만 저장한다(출처/고시시점 미저장 — 힌트는 세션 표시용).
  const fx = useFxPrefill({
    rates,
    initialCurrency,
    initialRate:
      v?.exchangeRate ??
      (quotation?.exchangeRate != null ? String(quotation.exchangeRate) : "1"),
    initialSource: "",
    initialQuotedAt: "",
    autoPrefill: !quotation && !v,
  });
  const latest = fx.latestFor(currency);

  function patchLine(key: string, patch: Partial<LineRow>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine(makeKey())]);
  }
  function removeLine(key: string) {
    setLines((prev) =>
      prev.length > 1 ? prev.filter((l) => l.key !== key) : prev,
    );
  }
  function selectItem(key: string, it: ItemOption) {
    patchLine(key, {
      productId: it.id,
      productName: it.name,
      hsCode: it.hsCode ?? "",
      unit: it.baseUom ?? "",
      unitPrice: it.stdPrice != null ? String(it.stdPrice) : "",
    });
    setOpenKey(null);
  }

  // 서버 lineAmount/computeTotals와 동일하게 라인별 반올림 후 합산(원칙 2: 화면=저장=인쇄).
  const rowAmount = (l: LineRow) =>
    round2((parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0));
  const subtotal = round2(lines.reduce((s, l) => s + rowAmount(l), 0));
  const discountNum = parseFloat(discount) || 0;
  const total = round2(subtotal - discountNum);
  const symbol = CURRENCY_SYMBOL[currency] ?? "";

  // 서버로 보낼 라인 JSON (빈 라인 제외; amount는 서버가 계산)
  const linesPayload = JSON.stringify(
    lines
      .filter((l) => l.productName.trim())
      .map((l) => ({
        productId: l.productId || null,
        productName: l.productName.trim(),
        hsCode: l.hsCode.trim() || null,
        description: null,
        quantity: parseFloat(l.quantity) || 0,
        unit: l.unit || null,
        unitPrice: parseFloat(l.unitPrice) || 0,
      })),
  );

  const partnerDefault = v?.partnerId ?? quotation?.partnerId ?? draft?.partnerId ?? "";
  const partnerMissing =
    !!partnerDefault && !partners.some((p) => p.id === partnerDefault);

  return (
    <form action={formAction} className="space-y-6">
      {quotation ? <input type="hidden" name="id" value={quotation.id} /> : null}
      <input
        type="hidden"
        name="inquiryId"
        value={v?.inquiryId ?? quotation?.inquiryId ?? draft?.inquiryId ?? ""}
      />
      <input type="hidden" name="lines" value={linesPayload} />

      {state.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      {quotation ? (
        <p className="text-sm text-zinc-500">
          견적번호{" "}
          <span className="font-mono font-medium text-zinc-800">
            {quotation.quotationNumber}
          </span>{" "}
          <span className="text-zinc-400">(발번 후 불변 — 원칙 6)</span>
        </p>
      ) : (
        <p className="text-sm text-zinc-400">
          견적번호는 저장 시 자동 발번됩니다 (QT-YYYYMM-NNN).
        </p>
      )}

      {/* ---------- 헤더 ---------- */}
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
                {quotation?.partnerName ?? partnerDefault} (기존 값)
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
        <Field label="견적일" required>
          <input
            name="quotationDate"
            type="date"
            className={inputClass}
            defaultValue={
              v?.quotationDate ?? quotation?.quotationDate ?? defaultDate
            }
            required
          />
        </Field>
        <Field label="유효기일">
          <input
            name="validUntil"
            type="date"
            className={inputClass}
            defaultValue={v?.validUntil ?? quotation?.validUntil ?? ""}
          />
        </Field>
        <Field label="상태">
          <select
            name="status"
            className={inputClass}
            defaultValue={v?.status ?? quotation?.status ?? draft?.status ?? "draft"}
          >
            {QUOTATION_STATUS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="통화">
          <select
            name="currency"
            className={inputClass}
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              fx.onCurrencyChange(e.target.value); // 대장 최신 환율 자동 채움
            }}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`환율 (1 ${currency} → ${BASE_CURRENCY} 환산)`}>
          <input
            name="exchangeRate"
            type="number"
            step="0.0001"
            min="0"
            className={inputClass}
            value={fx.rate}
            onChange={(e) => fx.onRateEdit(e.target.value)}
          />
          <FxHint currency={currency} latest={latest} source={fx.source} />
        </Field>

        <SectionTitle>거래 조건</SectionTitle>
        <Field label="인코텀즈">
          <select
            name="incoterms"
            className={inputClass}
            defaultValue={v?.incoterms ?? quotation?.incoterms ?? draft?.incoterms ?? ""}
          >
            <option value="">선택 안 함</option>
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
            defaultValue={
              v?.paymentTerms ?? quotation?.paymentTerms ?? draft?.paymentTerms ?? ""
            }
          >
            <option value="">선택 안 함</option>
            {PAYMENT_TERMS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="운송 방법">
          <select
            name="transport"
            className={inputClass}
            defaultValue={v?.transport ?? quotation?.transport ?? draft?.transport ?? ""}
          >
            <option value="">선택 안 함</option>
            {TRANSPORT.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="hidden sm:block" />
        <Field label="목적지 국가">
          <input
            name="destinationCountry"
            className={inputClass}
            defaultValue={
              v?.destinationCountry ?? quotation?.destinationCountry ?? draft?.destinationCountry ?? ""
            }
          />
        </Field>
        <div className="hidden sm:block" />
        <Field label="목적지 항구">
          <input
            name="destinationPort"
            className={inputClass}
            defaultValue={
              v?.destinationPort ?? quotation?.destinationPort ?? draft?.destinationPort ?? ""
            }
          />
        </Field>
        <Field label="목적지 공항">
          <input
            name="destinationAirport"
            className={inputClass}
            defaultValue={
              v?.destinationAirport ?? quotation?.destinationAirport ?? draft?.destinationAirport ?? ""
            }
          />
        </Field>
      </div>

      {/* ---------- 라인 에디터 ---------- */}
      <div>
        <p className="mb-2 border-b border-zinc-100 pb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          품목 (라인) — 합계는 라인에서 자동 계산
        </p>
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="w-8 px-2 py-2 text-left font-medium">#</th>
                <th className="px-2 py-2 text-left font-medium">품목명</th>
                <th className="w-28 px-2 py-2 text-left font-medium">HS코드</th>
                <th className="w-20 px-2 py-2 text-right font-medium">수량</th>
                <th className="w-20 px-2 py-2 text-left font-medium">단위</th>
                <th className="w-28 px-2 py-2 text-right font-medium">단가</th>
                <th className="w-32 px-2 py-2 text-right font-medium">금액</th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {lines.map((l, idx) => {
                const q = l.productName.trim().toLowerCase();
                const matches = (
                  q
                    ? items.filter((i) => i.name.toLowerCase().includes(q))
                    : items
                ).slice(0, 8);
                return (
                  <tr key={l.key} className="align-top">
                    <td className="px-2 py-1.5 text-zinc-400">{idx + 1}</td>
                    <td className="px-2 py-1.5">
                      <div className="relative">
                        <input
                          className={inputClass}
                          autoComplete="off"
                          placeholder="품목 검색 또는 직접 입력"
                          value={l.productName}
                          onChange={(e) => {
                            patchLine(l.key, {
                              productName: e.target.value,
                              productId: "",
                            });
                            setOpenKey(l.key);
                          }}
                          onFocus={() => setOpenKey(l.key)}
                          onBlur={() =>
                            setTimeout(
                              () => setOpenKey((k) => (k === l.key ? null : k)),
                              150,
                            )
                          }
                        />
                        {openKey === l.key && matches.length > 0 ? (
                          <ul className="absolute z-20 mt-1 max-h-56 w-72 overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
                            {matches.map((it) => (
                              <li key={it.id}>
                                <button
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    selectItem(l.key, it);
                                  }}
                                  className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left hover:bg-zinc-50"
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
                        {l.productId ? (
                          <span className="mt-0.5 block text-[11px] text-blue-600">
                            ✓ 품목 연결됨
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className={inputClass}
                        value={l.hsCode}
                        onChange={(e) => patchLine(l.key, { hsCode: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className={`${inputClass} text-right`}
                        value={l.quantity}
                        onChange={(e) =>
                          patchLine(l.key, { quantity: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        className={inputClass}
                        value={l.unit}
                        onChange={(e) => patchLine(l.key, { unit: e.target.value })}
                      >
                        <option value="">-</option>
                        {!UNITS.some((u) => u.code === l.unit) && l.unit ? (
                          <option value={l.unit}>{l.unit}</option>
                        ) : null}
                        {UNITS.map((u) => (
                          <option key={u.code} value={u.code}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className={`${inputClass} text-right`}
                        value={l.unitPrice}
                        onChange={(e) =>
                          patchLine(l.key, { unitPrice: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium text-zinc-800 tabular-nums">
                      {symbol}
                      {fmt(rowAmount(l))}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(l.key)}
                        className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                        title="행 삭제"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={addLine}
          className="mt-2 w-full rounded-lg border border-dashed border-zinc-300 bg-zinc-50 py-2 text-sm text-zinc-500 hover:bg-zinc-100"
        >
          + 품목 행 추가
        </button>

        {/* ---------- 합계 ---------- */}
        <div className="mt-4 flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 rounded-lg bg-zinc-50 p-4 text-sm">
            <div className="flex justify-between text-zinc-600">
              <span>소계 (Subtotal)</span>
              <span className="tabular-nums">
                {symbol}
                {fmt(subtotal)}
              </span>
            </div>
            <div className="flex items-center justify-between text-zinc-600">
              <span>할인 (Discount)</span>
              <input
                name="discount"
                type="number"
                step="0.01"
                min="0"
                className="w-28 rounded border border-zinc-300 px-2 py-1 text-right text-sm"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
            <div className="flex justify-between border-t border-zinc-300 pt-2 text-base font-semibold text-zinc-900">
              <span>합계 (Total)</span>
              <span className="tabular-nums">
                {symbol}
                {fmt(total)} {currency}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- 약관·비고 ---------- */}
      <div className="grid grid-cols-1 gap-4">
        <Field label="약관 (Terms & Conditions)" full>
          <textarea
            name="termsConditions"
            rows={3}
            className={inputClass}
            defaultValue={
              v?.termsConditions ??
              quotation?.termsConditions ??
              draft?.termsConditions ??
              DEFAULT_QUOTATION_TERMS
            }
          />
        </Field>
        <Field label="비고 (Notes)" full>
          <textarea
            name="notes"
            rows={2}
            className={inputClass}
            defaultValue={v?.notes ?? quotation?.notes ?? draft?.notes ?? ""}
          />
        </Field>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "저장 중…" : quotation ? "수정 저장" : "등록"}
        </button>
        <Link
          href="/quotations"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
        >
          취소
        </Link>
      </div>
    </form>
  );
}
