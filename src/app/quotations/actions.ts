"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createQuotation, updateQuotation } from "@/services/quotations";
import type { QuotationInput, QuotationLineInput } from "@/services/types";

export interface QuotationFormState {
  error?: string;
  /** 에러 시 헤더 입력값을 폼에 되돌려 재시드(라인은 클라이언트 state가 유지). */
  values?: Record<string, string>;
}

const ECHO_FIELDS = [
  "inquiryId",
  "partnerId",
  "quotationDate",
  "validUntil",
  "currency",
  "exchangeRate",
  "incoterms",
  "paymentTerms",
  "destinationCountry",
  "destinationPort",
  "destinationAirport",
  "transport",
  "discount",
  "status",
  "notes",
  "termsConditions",
];

function collectValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of ECHO_FIELDS) {
    const v = formData.get(f);
    if (typeof v === "string") values[f] = v;
  }
  return values;
}

/** 클라이언트가 보낸 라인 JSON을 검증·정규화 (amount는 서버가 계산하므로 받지 않음). */
function parseLines(raw: FormDataEntryValue | null): QuotationLineInput[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("품목 라인 데이터를 읽지 못했습니다.");
  }
  if (!Array.isArray(parsed)) return [];

  const lines: QuotationLineInput[] = [];
  for (const item of parsed) {
    const r = item as Record<string, unknown>;
    const productName =
      typeof r.productName === "string" ? r.productName.trim() : "";
    if (!productName) continue; // 빈 라인 스킵

    const quantity = Number(r.quantity);
    const unitPrice = Number(r.unitPrice);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error(`'${productName}'의 수량을 0 이상 숫자로 입력하세요.`);
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error(`'${productName}'의 단가를 0 이상 숫자로 입력하세요.`);
    }

    lines.push({
      productId:
        typeof r.productId === "string" && r.productId ? r.productId : null,
      productName,
      hsCode: typeof r.hsCode === "string" && r.hsCode.trim() ? r.hsCode.trim() : null,
      description:
        typeof r.description === "string" && r.description.trim()
          ? r.description.trim()
          : null,
      quantity,
      unit: typeof r.unit === "string" && r.unit ? r.unit : null,
      unitPrice,
    });
  }
  return lines;
}

function parseQuotationForm(formData: FormData): QuotationInput {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };

  const partnerId = get("partnerId");
  if (!partnerId) throw new Error("거래처를 선택하세요.");

  const quotationDate = get("quotationDate");
  if (!quotationDate) throw new Error("견적일을 입력하세요.");

  let discount = 0;
  const discRaw = get("discount");
  if (discRaw !== null) {
    const d = Number(discRaw.replace(/,/g, ""));
    if (!Number.isFinite(d) || d < 0) {
      throw new Error("할인은 0 이상 숫자로 입력하세요.");
    }
    discount = d;
  }

  let exchangeRate = 1;
  const exRaw = get("exchangeRate");
  if (exRaw !== null) {
    const e = Number(exRaw.replace(/,/g, ""));
    if (!Number.isFinite(e) || e <= 0) {
      throw new Error("환율은 0보다 큰 숫자로 입력하세요.");
    }
    exchangeRate = e;
  }

  const lines = parseLines(formData.get("lines"));
  if (!lines.length) throw new Error("품목을 1개 이상 입력하세요.");

  return {
    inquiryId: get("inquiryId"),
    partnerId,
    quotationDate,
    validUntil: get("validUntil"),
    currency: get("currency"),
    exchangeRate,
    incoterms: get("incoterms"),
    paymentTerms: get("paymentTerms"),
    destinationCountry: get("destinationCountry"),
    destinationPort: get("destinationPort"),
    destinationAirport: get("destinationAirport"),
    transport: get("transport"),
    discount,
    status: get("status") ?? "draft",
    notes: get("notes"),
    termsConditions: get("termsConditions"),
    lines,
  };
}

/**
 * 견적 등록/수정 Server Action (등록·수정 겸용; id 있으면 수정).
 * 합계는 서비스가 라인에서 재계산한다(원칙 2). 성공 시 목록으로 이동.
 */
export async function saveQuotationAction(
  _prev: QuotationFormState,
  formData: FormData,
): Promise<QuotationFormState> {
  const values = collectValues(formData);

  let input: QuotationInput;
  try {
    input = parseQuotationForm(formData);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "입력값을 확인해주세요.",
      values,
    };
  }

  const id = formData.get("id");
  try {
    if (typeof id === "string" && id) {
      await updateQuotation(id, input);
    } else {
      await createQuotation(input);
    }
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "저장에 실패했습니다.",
      values,
    };
  }

  revalidatePath("/quotations");
  redirect("/quotations");
}
