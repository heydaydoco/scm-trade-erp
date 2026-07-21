"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveCustomsDeclarationAction, type CustomsDeclFormState } from "./actions";
import type { CustomsDeclaration } from "@/services/types";
import { CURRENCIES, CUSTOMS_DECL_STATUS, DECL_TYPE, labelOf } from "@/services/codes";
import { Field, inputClass } from "@/components/Field";

/**
 * 통관신고 등록/수정 폼(겸용) — 신고 유형별 전용 필드 조건부 표시
 * (수출=적재의무기한 연장일 / 수입=세액 4필드). 검증은 RPC 가 최종 권위.
 *
 * ⚠️ accepted/cancelled 행은 이 폼을 쓰지 않는다(상세 페이지가 읽기 전용으로 표시).
 *    편집 대상은 draft/filed 뿐 — 유형은 생성 후 불변(수정 시 select 없이 고정).
 */
const SAVE_STATUS_CODES = ["draft", "filed", "accepted"];

function numStr(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n);
}

export function CustomsDeclForm({
  shipmentId,
  shipmentNo,
  shipmentDirection,
  declaration,
}: {
  shipmentId: string;
  shipmentNo: string | null;
  shipmentDirection: string | null;
  declaration?: CustomsDeclaration;
}) {
  const [state, formAction, pending] = useActionState<CustomsDeclFormState, FormData>(
    saveCustomsDeclarationAction,
    {},
  );
  const v = state.values;
  const isEdit = !!declaration;

  // 신고 유형: 수정이면 불변(생성값), 신규면 선택(선적 방향 기본). 전용 필드 토글용 state.
  const initialDeclType =
    v?.declType ??
    declaration?.declType ??
    (shipmentDirection === "export" || shipmentDirection === "import" ? shipmentDirection : "export");
  const [declType, setDeclType] = useState(initialDeclType);
  const effectiveDeclType = isEdit ? declaration!.declType : declType;

  // 상태 전이 옵션(RPC 매트릭스 미러): 신규/draft=셋 다, filed=filed·accepted.
  const allowedStatuses =
    isEdit && declaration!.status === "filed"
      ? ["filed", "accepted"]
      : SAVE_STATUS_CODES;
  const statusDefault = v?.status ?? declaration?.status ?? "draft";

  return (
    <form action={formAction} className="space-y-5">
      {isEdit ? <input type="hidden" name="id" value={declaration!.id} /> : null}
      <input type="hidden" name="shipmentId" value={shipmentId} />
      {isEdit ? <input type="hidden" name="declType" value={effectiveDeclType} /> : null}

      {state.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="연결 선적">
          <input className={inputClass} value={shipmentNo ?? shipmentId} disabled />
        </Field>

        <Field label="신고 유형" required>
          {isEdit ? (
            <input
              className={inputClass}
              value={labelOf(DECL_TYPE, effectiveDeclType)}
              disabled
            />
          ) : (
            <select
              name="declType"
              className={inputClass}
              value={declType}
              onChange={(e) => setDeclType(e.target.value)}
            >
              {DECL_TYPE.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="상태" required>
          <select name="status" className={inputClass} defaultValue={statusDefault}>
            {CUSTOMS_DECL_STATUS.filter((s) => allowedStatuses.includes(s.code)).map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="세관 신고번호">
          <input
            name="customsDeclNo"
            className={inputClass}
            placeholder="세관 발급 번호(수리 시 필수)"
            defaultValue={v?.customsDeclNo ?? declaration?.customsDeclNo ?? ""}
          />
        </Field>

        <Field label="신고일">
          <input
            type="date"
            name="filingDate"
            className={inputClass}
            defaultValue={v?.filingDate ?? declaration?.filingDate ?? ""}
          />
        </Field>

        <Field label="수리일">
          <input
            type="date"
            name="acceptanceDate"
            className={inputClass}
            defaultValue={v?.acceptanceDate ?? declaration?.acceptanceDate ?? ""}
          />
        </Field>

        <Field label="관세사">
          <input
            name="brokerName"
            className={inputClass}
            placeholder="관세사명(자유 입력)"
            defaultValue={v?.brokerName ?? declaration?.brokerName ?? ""}
          />
        </Field>

        {/* 수출 전용 — 적재의무기한 연장승인일 */}
        {effectiveDeclType === "export" ? (
          <Field label="적재의무기한 연장승인일">
            <input
              type="date"
              name="loadingDeadlineExtended"
              className={inputClass}
              defaultValue={v?.loadingDeadlineExtended ?? declaration?.loadingDeadlineExtended ?? ""}
            />
            <span className="mt-1 block text-xs text-slate-400">
              미입력 시 적재의무기한 = 수리일 + 30일로 계산됩니다(저장하지 않음).
            </span>
          </Field>
        ) : null}

        {/* 수입 전용 — 세액 4필드(관세사 통지값 기록용) */}
        {effectiveDeclType === "import" ? (
          <>
            <Field label="과세가격">
              <input
                type="number"
                step="any"
                name="taxableValue"
                className={inputClass}
                defaultValue={v?.taxableValue ?? numStr(declaration?.taxableValue)}
              />
            </Field>
            <Field label="관세액">
              <input
                type="number"
                step="any"
                name="dutyAmount"
                className={inputClass}
                defaultValue={v?.dutyAmount ?? numStr(declaration?.dutyAmount)}
              />
            </Field>
            <Field label="부가세액">
              <input
                type="number"
                step="any"
                name="vatAmount"
                className={inputClass}
                defaultValue={v?.vatAmount ?? numStr(declaration?.vatAmount)}
              />
            </Field>
            <Field label="세액 통화">
              <select
                name="taxCurrency"
                className={inputClass}
                defaultValue={v?.taxCurrency ?? declaration?.taxCurrency ?? ""}
              >
                <option value="">선택 안 함</option>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : null}

        <Field label="메모" full>
          <textarea
            name="memo"
            rows={2}
            className={inputClass}
            defaultValue={v?.memo ?? declaration?.memo ?? ""}
          />
        </Field>
      </div>

      <p className="text-xs text-slate-500">
        세액(관세·부가세)은 관세사 통지값을 <b>기록만</b> 합니다 — 시스템이 계산·단정하지
        않습니다. 세관 신고번호도 입력값만 사용합니다. 수출은 세액·통화를, 수입은 적재기한
        연장일을 입력할 수 없습니다. 신고/수리 상태는 신고일·수리일·세관번호가 필요합니다.
      </p>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "저장 중…" : isEdit ? "수정 저장" : "통관신고 등록"}
        </button>
        <Link
          href={isEdit ? `/customs/${declaration!.id}` : `/shipments/${shipmentId}`}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
        >
          취소
        </Link>
      </div>
    </form>
  );
}
