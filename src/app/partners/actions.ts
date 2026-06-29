"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createPartner, updatePartner } from "@/services/partners";
import type { PartnerInput, PartnerType } from "@/services/types";
import { PARTNER_TYPES } from "@/services/codes";

export interface PartnerFormState {
  error?: string;
  /** 에러 시 입력값을 폼에 되돌려 재시드(데이터 유실 방지). */
  values?: Record<string, string>;
}

const SELECTABLE_TYPES = PARTNER_TYPES.map((c) => c.code);

const ECHO_FIELDS = [
  "name",
  "type",
  "country",
  "city",
  "currency",
  "incoterms",
  "contactName",
  "contactEmail",
  "contactPhone",
  "paymentTerms",
  "address",
  "notes",
];

/** 제출된 원본 값들을 모아 에러 시 폼 재시드에 사용. */
function collectValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of ECHO_FIELDS) {
    const v = formData.get(f);
    if (typeof v === "string") values[f] = v;
  }
  values.active = formData.get("active") === "on" ? "on" : "";
  return values;
}

function toPartnerType(raw: string): PartnerType {
  if (SELECTABLE_TYPES.includes(raw)) return raw as PartnerType;
  if (raw === "unknown") return "unknown"; // 미분류는 보존(서비스가 company_type 안 건드림)
  return "customer";
}

function parsePartnerForm(formData: FormData): PartnerInput {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };

  const name = get("name");
  if (!name) throw new Error("거래처명은 필수 항목입니다.");

  const type = toPartnerType((formData.get("type") as string) ?? "customer");

  return {
    name,
    type,
    country: get("country"),
    city: get("city"),
    currency: get("currency"),
    contactName: get("contactName"),
    contactEmail: get("contactEmail"),
    contactPhone: get("contactPhone"),
    address: get("address"),
    paymentTerms: get("paymentTerms"),
    incoterms: get("incoterms"),
    notes: get("notes"),
    active: formData.get("active") === "on",
  };
}

/**
 * 거래처 등록/수정 Server Action (등록·수정 겸용; id 있으면 수정).
 * 검증/저장 실패 시 입력값을 함께 돌려주고(values), 성공 시 목록으로 이동한다.
 */
export async function savePartnerAction(
  _prev: PartnerFormState,
  formData: FormData,
): Promise<PartnerFormState> {
  const values = collectValues(formData);

  let input: PartnerInput;
  try {
    input = parsePartnerForm(formData);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "입력값을 확인해주세요.",
      values,
    };
  }

  const id = formData.get("id");
  try {
    if (typeof id === "string" && id) {
      await updatePartner(id, input);
    } else {
      await createPartner(input);
    }
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "저장에 실패했습니다.",
      values,
    };
  }

  // 성공: 목록 캐시 갱신 후 이동 (redirect는 try 밖 — NEXT_REDIRECT를 삼키지 않게).
  revalidatePath("/partners");
  redirect("/partners");
}
