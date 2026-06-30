"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createItem, updateItem } from "@/services/items";
import type { ItemInput } from "@/services/types";

export interface ItemFormState {
  error?: string;
  /** 에러 시 입력값을 폼에 되돌려 재시드(데이터 유실 방지). */
  values?: Record<string, string>;
}

const ECHO_FIELDS = [
  "code",
  "name",
  "hsCode",
  "baseUom",
  "stdPrice",
  "currency",
  "originCountry",
  "description",
];

const CHECKBOX_FIELDS = ["isDangerous", "lotManaged", "serialManaged", "active"];

/** 제출된 원본 값들을 모아 에러 시 폼 재시드에 사용. */
function collectValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of ECHO_FIELDS) {
    const v = formData.get(f);
    if (typeof v === "string") values[f] = v;
  }
  for (const cb of CHECKBOX_FIELDS) {
    values[cb] = formData.get(cb) === "on" ? "on" : "";
  }
  return values;
}

function parseItemForm(formData: FormData): ItemInput {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };

  const name = get("name");
  if (!name) throw new Error("품목명은 필수 항목입니다.");

  let stdPrice: number | null = null;
  const priceRaw = get("stdPrice");
  if (priceRaw !== null) {
    const parsed = Number(priceRaw.replace(/,/g, ""));
    if (!Number.isFinite(parsed)) {
      throw new Error("표준단가는 숫자로 입력하세요.");
    }
    stdPrice = parsed;
  }

  return {
    code: get("code"),
    name,
    hsCode: get("hsCode"),
    baseUom: get("baseUom"),
    stdPrice,
    currency: get("currency"),
    originCountry: get("originCountry"),
    isDangerous: formData.get("isDangerous") === "on",
    lotManaged: formData.get("lotManaged") === "on",
    serialManaged: formData.get("serialManaged") === "on",
    description: get("description"),
    active: formData.get("active") === "on",
  };
}

/**
 * 품목 등록/수정 Server Action (등록·수정 겸용; id 있으면 수정).
 * 검증/저장 실패 시 입력값을 함께 돌려주고(values), 성공 시 목록으로 이동한다.
 */
export async function saveItemAction(
  _prev: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const values = collectValues(formData);

  let input: ItemInput;
  try {
    input = parseItemForm(formData);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "입력값을 확인해주세요.",
      values,
    };
  }

  const id = formData.get("id");
  try {
    if (typeof id === "string" && id) {
      await updateItem(id, input);
    } else {
      await createItem(input);
    }
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "저장에 실패했습니다.",
      values,
    };
  }

  // 성공: 목록 캐시 갱신 후 이동 (redirect는 try 밖 — NEXT_REDIRECT를 삼키지 않게).
  revalidatePath("/items");
  redirect("/items");
}
