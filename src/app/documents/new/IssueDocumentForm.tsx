"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  issueTradeDocumentAction,
  type IssueFormState,
} from "../actions";
import {
  allocateDiscounts,
  discountEntriesOf,
  lineAmount,
  packingFillMode,
  subtotalOf,
  totalOf,
  weightFillMode,
  zeroPriceCount,
} from "@/services/tradeDocLogic";
import { CURRENCY_SYMBOL, INCOTERMS, PAYMENT_TERMS } from "@/services/codes";
import { Field, inputClass } from "@/components/Field";
import type { IssuableLine } from "@/services/types";

/**
 * 발행 폼 (P4.5 커밋 c) — 원천 파생값(qty·uom·단가·금액·할인)은 read-only
 * 미리보기(진실은 서버 재계산), 입력은 보충 필드만: HS(주문 라인→품목 마스터
 * 프리필)·원산지(품목 마스터 프리필)·설명·N.W. 직접 입력·G.W.(선적 라인 프리필).
 * 경고는 차단이 아니라 안내(원칙 8) — 거부는 서버(RPC)가 하고 메시지를 그대로
 * 표면화한다.
 */

interface SupplementRow {
  include: boolean;
  hs: string;
  origin: string;
  description: string;
  nw: string;
  gw: string;
}

function parseWeight(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null; // 숫자 아님은 액션이 한국어로 거부
}

export function IssueDocumentForm({
  shipmentId,
  customerId,
  customerName,
  currency,
  lines,
  buyerAddressBlank,
  comboWarnings,
  excludedPoCount,
  defaultIssueDate,
}: {
  shipmentId: string;
  customerId: string;
  customerName: string;
  currency: string;
  lines: IssuableLine[];
  buyerAddressBlank: boolean;
  comboWarnings: string[];
  excludedPoCount: number;
  defaultIssueDate: string;
}) {
  const [state, formAction, pending] = useActionState<IssueFormState, FormData>(
    issueTradeDocumentAction,
    {},
  );
  const [rows, setRows] = useState<SupplementRow[]>(() =>
    lines.map((l) => ({
      include: true,
      hs: l.hsPrefill ?? "",
      origin: l.originPrefill ?? "",
      description: l.descriptionPrefill ?? "",
      nw: "",
      gw: l.grossWeightPrefill !== null ? String(l.grossWeightPrefill) : "",
    })),
  );
  const [issueDate, setIssueDate] = useState(defaultIssueDate);

  function patchRow(i: number, patch: Partial<SupplementRow>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  /* ---------- 미리보기·경고 (전부 (b) 순수 로직 재사용 — 서버 산식 미러) ---------- */
  const includedIdx = rows
    .map((r, i) => (r.include ? i : -1))
    .filter((i) => i >= 0);
  const included = includedIdx.map((i) => lines[i]);

  const priced = included.filter(
    (l): l is IssuableLine & { unitPrice: number } => l.unitPrice !== null,
  );
  const priceUnknownCount = included.length - priced.length;
  const zeroCount = zeroPriceCount(
    priced.map((l) => ({ unitPrice: l.unitPrice })),
  );
  const subtotal = subtotalOf(
    priced.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })),
  );
  const { discount, warnings: discountWarnings } = allocateDiscounts(
    discountEntriesOf(
      included.map((l) => ({
        soId: l.soId,
        soNumber: l.soNumber,
        qty: l.qty,
        unitPrice: l.unitPrice,
        soDiscount: l.soDiscount,
        soOrderTotal: l.soOrderTotal,
      })),
    ),
  );
  const total = totalOf(subtotal, discount);

  const nwMode = weightFillMode(includedIdx.map((i) => parseWeight(rows[i].nw)));
  const gwMode = weightFillMode(includedIdx.map((i) => parseWeight(rows[i].gw)));
  const packMode = packingFillMode(
    included.map((l) => ({
      packageCount: l.packageCount,
      packageType: l.packageType,
    })),
  );

  const badges: string[] = [];
  if (zeroCount > 0) badges.push(`단가 0원 라인 ${zeroCount}건이 포함됩니다.`);
  if (priceUnknownCount > 0)
    badges.push(
      `단가 미상 라인 ${priceUnknownCount}건 — 포함한 채 발행하면 서버가 거부합니다(주문 라인 확인 필요).`,
    );
  if (nwMode === "partial")
    badges.push("N.W. 부분 입력 — 인쇄에서 N.W. 컬럼·TOTAL 이 생략됩니다(부분합 왜곡 방지).");
  if (gwMode === "partial")
    badges.push("G.W. 부분 입력 — 인쇄에서 G.W. 컬럼·TOTAL 이 생략됩니다(부분합 왜곡 방지).");
  if (packMode === "partial")
    badges.push(
      "포장 데이터(포장수+유형) 부분 보유 — PL 포장 섹션이 생략됩니다. 발행 전이면 선적 화물 화면에서 포장 데이터를 채울 수 있습니다.",
    );
  if (buyerAddressBlank)
    badges.push("Buyer 주소 공란 — CI Buyer 블록에 주소 없이 인쇄됩니다(거래처 마스터에서 채울 수 있음).");

  const symbol = CURRENCY_SYMBOL[currency] ?? "";
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const linesPayload = JSON.stringify(
    rows.map((r, i) => ({
      shipmentLineId: lines[i].shipmentLineId,
      include: r.include,
      hsCode: r.hs,
      originCountry: r.origin,
      description: r.description,
      netWeight: r.nw,
      grossWeight: r.gw,
    })),
  );

  /* ---------- 발행 성공 — 폼 대신 결과 패널 (경고 포함) ---------- */
  if (state.ok && state.docId) {
    return (
      <div className="space-y-3">
        <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">{state.ok}</p>
          <p className="mt-1 text-xs">
            발행 시점 스냅샷으로 고정되었습니다 — 이후 원천 수정과 무관합니다.
          </p>
        </div>
        {(state.warnings ?? []).length > 0 && (
          <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="mb-1 font-medium">발행 경고 (차단 아님 — 확인 권장):</p>
            <ul className="list-disc pl-5 text-xs">
              {(state.warnings ?? []).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-4 text-sm">
          <Link
            href={`/documents/${state.docId}`}
            className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700"
          >
            문서 보기 → {state.docNumber}
          </Link>
          <Link
            href={`/shipments/${shipmentId}`}
            className="px-2 py-2 text-zinc-600 hover:text-blue-700 hover:underline"
          >
            ← 선적 상세로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <fieldset disabled={pending} className="m-0 border-0 p-0 space-y-4">
        <input type="hidden" name="shipmentId" value={shipmentId} />
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="currency" value={currency} />
        <input type="hidden" name="lines" value={linesPayload} />

        {state.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        )}

        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          한 번의 발행 = <b>CI+PL 세트</b> = 번호 1개(CI-YYYYMM-NNN). 수량·단위·
          단가·금액·할인은 서버가 원천(선적 화물→주문 라인→품목)에서 재계산합니다
          — 아래 표는 미리보기입니다(서버 동일 산식). 발행 후 이 선적의 화물
          내역·당사자 저장은 잠깁니다(화인 제외) — 해소: 문서 취소 → 수정 → 재발행.
        </p>

        {(comboWarnings.length > 0 || excludedPoCount > 0) && (
          <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            {excludedPoCount > 0 && (
              <p>
                PO(수입) 라인 {excludedPoCount}건은 무역서류 대상이 아닙니다
                (수입 서류는 공급자 발행 — 정의상 제외, 경고 아님).
              </p>
            )}
            {comboWarnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}

        {/* ---------- 헤더 보충 필드 ---------- */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="발행일 (KST)" required>
            <input
              type="date"
              name="issueDate"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Incoterms">
            <select name="incoterm" defaultValue="" className={inputClass}>
              <option value="">(선택 안 함)</option>
              {INCOTERMS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Incoterms 장소">
            <input
              name="incotermPlace"
              placeholder="예: Busan Port"
              className={inputClass}
            />
          </Field>
          <Field label="Payment Terms">
            <select name="paymentTerms" defaultValue="" className={inputClass}>
              <option value="">(선택 안 함)</option>
              {PAYMENT_TERMS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Remarks" full>
            <textarea name="remarks" rows={2} className={inputClass} />
          </Field>
        </div>

        {/* ---------- 라인 (원천 미리보기 + 보충 입력) ---------- */}
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">포함</th>
                <th className="px-2 py-2">품목 (주문)</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2">Unit</th>
                <th className="px-2 py-2 text-right">단가</th>
                <th className="px-2 py-2 text-right">금액</th>
                <th className="px-2 py-2">HS</th>
                <th className="px-2 py-2">원산지</th>
                <th className="px-2 py-2">설명</th>
                <th className="px-2 py-2 text-right">N.W.(kg)</th>
                <th className="px-2 py-2 text-right">G.W.(kg)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => {
                const r = rows[i];
                const amount =
                  l.unitPrice !== null ? lineAmount(l.qty, l.unitPrice) : null;
                return (
                  <tr key={l.shipmentLineId} className={r.include ? "" : "opacity-45"}>
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) => patchRow(i, { include: e.target.checked })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      {l.itemName}
                      <div className="text-xs text-slate-400">
                        {l.soNumber ?? "(주문 미상)"}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(l.qty)}</td>
                    <td className="px-2 py-2 text-xs">{l.uom}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {l.unitPrice !== null ? fmt(l.unitPrice) : (
                        <span className="text-amber-700">미상</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {amount !== null ? fmt(amount) : "—"}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={r.hs}
                        onChange={(e) => patchRow(i, { hs: e.target.value })}
                        placeholder="HS"
                        className="w-24 rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={r.origin}
                        onChange={(e) => patchRow(i, { origin: e.target.value })}
                        placeholder="KR"
                        className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={r.description}
                        onChange={(e) => patchRow(i, { description: e.target.value })}
                        className="w-32 rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        value={r.nw}
                        onChange={(e) => patchRow(i, { nw: e.target.value })}
                        inputMode="decimal"
                        className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-xs"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        value={r.gw}
                        onChange={(e) => patchRow(i, { gw: e.target.value })}
                        inputMode="decimal"
                        className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-xs"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          HS 는 주문 라인 → 품목 마스터 → 직접 입력, 원산지는 품목 마스터 → 직접
          입력 체인으로 프리필됩니다(없으면 공란 — 값을 지어내지 않습니다). G.W.는
          선적 화물의 라인 중량이 프리필되며 수정할 수 있습니다. N.W.는 직접
          입력입니다(공란 허용 — 전 라인 입력 시에만 인쇄).
        </p>

        {/* ---------- 경고 배지 (차단 아님 — 원칙 8) ---------- */}
        {(badges.length > 0 || discountWarnings.length > 0) && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <ul className="list-disc pl-5 text-xs">
              {badges.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
              {discountWarnings.map((w, i) => (
                <li key={`d${i}`}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ---------- 합계 미리보기 (서버 동일 산식 — D3) ---------- */}
        <div className="flex justify-end">
          <dl className="w-72 rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex justify-between py-0.5">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="tabular-nums">{`${symbol}${fmt(subtotal)} ${currency}`}</dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-slate-500">Less: Discount (비례 배분)</dt>
              <dd className="tabular-nums">{`${symbol}${fmt(discount)} ${currency}`}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 py-1 font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{`${symbol}${fmt(total)} ${currency}`}</dd>
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              미리보기 = 저장값(서버 동일 산식·round2). 포함 {included.length}건 ·{" "}
              {customerName} · {currency}
            </p>
          </dl>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending || included.length === 0}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "발행 중…" : "무역서류 발행 (CI+PL 세트)"}
          </button>
          <span className="text-xs text-slate-500">
            발행 즉시 번호가 발번되고 스냅샷이 고정됩니다.
          </span>
        </div>
      </fieldset>
    </form>
  );
}
