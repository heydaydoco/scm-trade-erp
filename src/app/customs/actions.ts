"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  cancelCustomsDeclaration,
  saveCustomsDeclaration,
} from "@/services/customsDeclarations";
import type { CustomsDeclarationInput } from "@/services/types";

/**
 * 통관신고(P5.1 E6/E9) Server Actions — 쓰기는 SECURITY DEFINER RPC 단일 경로.
 * 방향 일치·상태 전이·필수/전용 필드·금액통화·날짜 정합은 RPC 가 최종 검증한다 —
 * 여기서는 폼 값을 정리해 넘기고 서버 거부 메시지를 그대로 표면화한다(입력값 재시드).
 */

export interface CustomsDeclFormState {
  error?: string;
  /** 에러 시 입력값을 폼에 되돌려 재시드(데이터 유실 방지). */
  values?: Record<string, string>;
}

export interface CancelDeclFormState {
  error?: string;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** 금액 입력 파싱 — 공란은 null, 숫자 아님/음수는 명시적 에러(NaN 은 JSON 전송 중 null 로 삼켜지므로 여기서 차단). */
function parseMoney(v: unknown, label: string): { value: number | null; error?: string } {
  if (typeof v !== "string" || v.trim() === "") return { value: null };
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isFinite(n)) return { value: null, error: `${label}은(는) 숫자여야 합니다. (받은 값: ${v})` };
  if (n < 0) return { value: null, error: `${label}은(는) 0 이상이어야 합니다. (받은 값: ${v})` };
  return { value: n };
}

const ECHO_FIELDS = [
  "declType",
  "status",
  "customsDeclNo",
  "filingDate",
  "acceptanceDate",
  "brokerName",
  "taxableValue",
  "dutyAmount",
  "vatAmount",
  "taxCurrency",
  "loadingDeadlineExtended",
  "memo",
];

function collectValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of ECHO_FIELDS) {
    const v = formData.get(f);
    if (typeof v === "string") values[f] = v;
  }
  return values;
}

/**
 * 등록/수정 액션(겸용; id 있으면 수정). 성공은 상태가 아니라 상세로 **redirect**
 * (revalidate 로 목록·선적·기일 화면 갱신 후). 에러는 입력값과 함께 폼에 되돌린다.
 */
export async function saveCustomsDeclarationAction(
  _prev: CustomsDeclFormState,
  formData: FormData,
): Promise<CustomsDeclFormState> {
  const values = collectValues(formData);

  const shipmentId = str(formData.get("shipmentId"));
  if (!shipmentId) {
    return { error: "선적이 지정되지 않았습니다. 선적 상세에서 다시 시작하세요.", values };
  }
  const declType = str(formData.get("declType"));
  if (declType !== "export" && declType !== "import") {
    return { error: "신고 유형(수출/수입)을 선택하세요.", values };
  }
  const status = str(formData.get("status")) ?? "draft";

  const taxable = parseMoney(formData.get("taxableValue"), "과세가격");
  if (taxable.error) return { error: taxable.error, values };
  const duty = parseMoney(formData.get("dutyAmount"), "관세액");
  if (duty.error) return { error: duty.error, values };
  const vat = parseMoney(formData.get("vatAmount"), "부가세액");
  if (vat.error) return { error: vat.error, values };

  const input: CustomsDeclarationInput = {
    id: str(formData.get("id")),
    shipmentId,
    declType,
    status,
    customsDeclNo: str(formData.get("customsDeclNo")),
    filingDate: str(formData.get("filingDate")),
    acceptanceDate: str(formData.get("acceptanceDate")),
    brokerName: str(formData.get("brokerName")),
    taxableValue: taxable.value,
    dutyAmount: duty.value,
    vatAmount: vat.value,
    taxCurrency: str(formData.get("taxCurrency")),
    loadingDeadlineExtended: str(formData.get("loadingDeadlineExtended")),
    memo: str(formData.get("memo")),
  };

  let saved: { id: string; declDocNo: string; status: string };
  try {
    saved = await saveCustomsDeclaration(input);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "통관신고 저장에 실패했습니다.", values };
  }

  // 수리(accepted) 수출 신고는 적재의무기한 기일 소스이므로 기일 화면도 갱신.
  revalidatePath("/customs");
  revalidatePath(`/customs/${saved.id}`);
  revalidatePath(`/shipments/${shipmentId}`);
  revalidatePath("/deadlines");
  redirect(`/customs/${saved.id}?saved=1`);
}

export async function cancelCustomsDeclarationAction(
  _prev: CancelDeclFormState,
  formData: FormData,
): Promise<CancelDeclFormState> {
  const id = str(formData.get("declarationId"));
  if (!id) return { error: "통관신고가 지정되지 않았습니다." };
  const reason = str(formData.get("reason"));
  if (!reason) return { error: "취소 사유는 필수입니다." };
  const shipmentId = str(formData.get("shipmentId"));

  try {
    await cancelCustomsDeclaration(id, reason);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "통관신고 취소에 실패했습니다." };
  }

  // 성공은 상태가 아니라 redirect — revalidate 재렌더가 상세를 취소 읽기전용 분기로 바꾸면
  // 취소 버튼(과 그 성공 상태)이 언마운트돼 배너가 증발한다(P4.5 함정). 상세의 CANCELLED
  // 배너로 결과를 보인다. redirect 는 try 밖(NEXT_REDIRECT 삼킴 방지).
  revalidatePath("/customs");
  revalidatePath(`/customs/${id}`);
  if (shipmentId) revalidatePath(`/shipments/${shipmentId}`);
  revalidatePath("/deadlines");
  redirect(`/customs/${id}`);
}
