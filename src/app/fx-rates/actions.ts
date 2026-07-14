"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createFxRate } from "@/services/fxRates";
import { BASE_CURRENCY } from "@/config/company";
import type { FxRateInput } from "@/services/types";

export interface FxRateFormState {
  error?: string;
  /** 에러 시 입력값을 폼에 되돌려 재시드. */
  values?: Record<string, string>;
}

const ECHO_FIELDS = [
  "quoteCurrency",
  "quoteUnit",
  "quotedRate",
  "rateDate",
  "source",
  "quotedAt",
  "note",
];

function collectValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of ECHO_FIELDS) {
    const v = formData.get(f);
    if (typeof v === "string") values[f] = v;
  }
  return values;
}

function parseFxRateForm(formData: FormData): FxRateInput {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };

  const quoteCurrency = get("quoteCurrency");
  if (!quoteCurrency) throw new Error("대상통화를 선택하세요.");

  const rateDate = get("rateDate");
  if (!rateDate) throw new Error("고시일을 입력하세요.");

  // 고시단위 — 기본 1. 사람이 은행 화면값 그대로 넣으면 서비스가 이 단위로 나눈다.
  let quoteUnit = 1;
  const unitRaw = get("quoteUnit");
  if (unitRaw !== null) {
    const u = Number(unitRaw.replace(/,/g, ""));
    if (!Number.isFinite(u) || u <= 0) {
      throw new Error("고시단위는 0보다 큰 숫자여야 합니다.");
    }
    quoteUnit = u;
  }

  const quotedRaw = get("quotedRate");
  if (quotedRaw === null) throw new Error("환율을 입력하세요.");
  const quotedRate = Number(quotedRaw.replace(/,/g, ""));
  if (!Number.isFinite(quotedRate) || quotedRate <= 0) {
    throw new Error("환율은 0보다 큰 숫자로 입력하세요.");
  }

  return {
    baseCurrency: BASE_CURRENCY,
    quoteCurrency,
    quotedRate,
    quoteUnit,
    rateDate,
    source: get("source"),
    quotedAt: get("quotedAt"),
    note: get("note"),
  };
}

/**
 * 환율 등록 Server Action — 추가 전용(원칙 5). 성공 시 대장 목록으로 이동.
 * 정규화(quotedRate ÷ quoteUnit)와 검증은 서비스(createFxRate)가 수행한다.
 */
export async function createFxRateAction(
  _prev: FxRateFormState,
  formData: FormData,
): Promise<FxRateFormState> {
  const values = collectValues(formData);

  let input: FxRateInput;
  try {
    input = parseFxRateForm(formData);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "입력값을 확인해주세요.", values };
  }

  try {
    await createFxRate(input);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "저장에 실패했습니다.", values };
  }

  revalidatePath("/fx-rates");
  redirect("/fx-rates");
}
