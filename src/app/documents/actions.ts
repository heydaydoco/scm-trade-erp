"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  cancelTradeDocument,
  saveTradeDocument,
} from "@/services/tradeDocuments";
import type { TradeDocumentLineInput } from "@/services/types";

/**
 * 무역서류(P4.5 CI/PL) Server Actions — 쓰기는 SECURITY DEFINER RPC 단일 경로.
 * 발행은 서버가 원천에서 재해석·재계산(클라 값 불신) — 여기서는 보충 필드만
 * 검증·정리해 서비스로 넘기고, 서버 거부 메시지는 그대로 표면화한다.
 */

/**
 * 발행 액션 상태 — 성공은 상태가 아니라 **redirect** 다(문서 상세로).
 * revalidatePath 가 현재 페이지(/documents/new)를 재렌더하면 방금 생긴 활성
 * 문서 때문에 폼이 중복 가드 패널로 교체돼 성공 패널이 증발한다(E2E 발견) —
 * 출고 생성과 같은 관례(revalidate→redirect)로 상세에서 성공 배너+경고를 보인다.
 */
export interface IssueFormState {
  error?: string;
}

export interface CancelDocFormState {
  error?: string;
  ok?: string;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** 중량 입력 파싱 — 공란은 null(허용), 숫자 아님은 NaN(아래에서 한국어 거부). */
function weightOrNull(v: unknown): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

export async function issueTradeDocumentAction(
  _prev: IssueFormState,
  formData: FormData,
): Promise<IssueFormState> {
  const shipmentId = str(formData.get("shipmentId"));
  const customerId = str(formData.get("customerId"));
  const currency = str(formData.get("currency"));
  if (!shipmentId || !customerId || !currency) {
    return { error: "발행 대상(선적×고객×통화)이 지정되지 않았습니다. 선적 상세에서 다시 시작하세요." };
  }

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    return { error: "발행 payload 해석에 실패했습니다. 화면을 새로고침한 뒤 다시 시도하세요." };
  }
  if (!Array.isArray(rawLines)) {
    return { error: "발행 payload 형식이 잘못됐습니다. 화면을 새로고침한 뒤 다시 시도하세요." };
  }

  const lines: TradeDocumentLineInput[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (typeof rawLines[i] !== "object" || rawLines[i] === null) {
      return { error: "발행 payload 형식이 잘못됐습니다. 화면을 새로고침한 뒤 다시 시도하세요." };
    }
    const l = rawLines[i] as Record<string, unknown>;
    const shipmentLineId = str(l.shipmentLineId);
    if (!shipmentLineId) {
      return { error: `화물 라인 참조가 없습니다. (${i + 1}번째 줄)` };
    }
    const include = l.include === true;
    // 중량은 폼 직접 입력(D5·R1) — 양수만. 서버(RPC)도 같은 규칙으로 재검증한다.
    const nw = weightOrNull(String(l.netWeight ?? ""));
    const gw = weightOrNull(String(l.grossWeight ?? ""));
    if (include && nw !== null && (Number.isNaN(nw) || nw <= 0)) {
      return { error: `순중량(N.W.)은 양수여야 합니다. (${i + 1}번째 줄, 받은 값: ${l.netWeight})` };
    }
    if (include && gw !== null && (Number.isNaN(gw) || gw <= 0)) {
      return { error: `총중량(G.W.)은 양수여야 합니다. (${i + 1}번째 줄, 받은 값: ${l.grossWeight})` };
    }
    lines.push({
      shipmentLineId,
      include,
      hsCode: str(l.hsCode),
      originCountry: str(l.originCountry),
      netWeight: include ? nw : null,
      grossWeight: include ? gw : null,
      description: str(l.description),
    });
  }
  if (lines.filter((l) => l.include).length === 0) {
    return { error: "발행할 라인이 최소 1건 필요합니다(포함 체크 확인)." };
  }

  let docId: string;
  let warnings: string[];
  try {
    ({ id: docId, warnings } = await saveTradeDocument({
      shipmentId,
      customerId,
      currency,
      issueDate: str(formData.get("issueDate")),
      incoterm: str(formData.get("incoterm")),
      incotermPlace: str(formData.get("incotermPlace")),
      paymentTerms: str(formData.get("paymentTerms")),
      remarks: str(formData.get("remarks")),
      lines,
    }));
  } catch (e) {
    // 서버 거부 메시지(Seller 플레이스홀더 포함) 그대로 표면화.
    return { error: e instanceof Error ? e.message : "무역서류 발행에 실패했습니다." };
  }

  // 발행 → 잠금 가드가 선적 화물 화면을 동결한다 — 관련 화면 재검증.
  revalidatePath("/documents");
  revalidatePath(`/documents/${docId}`);
  revalidatePath(`/shipments/${shipmentId}`);

  // 성공 배너·RPC 경고는 문서 상세가 searchParams 로 받아 표시한다.
  const q =
    warnings.length > 0
      ? `&w=${encodeURIComponent(JSON.stringify(warnings))}`
      : "";
  redirect(`/documents/${docId}?issued=1${q}`);
}

export async function cancelTradeDocumentAction(
  _prev: CancelDocFormState,
  formData: FormData,
): Promise<CancelDocFormState> {
  const documentId = str(formData.get("documentId"));
  if (!documentId) return { error: "무역서류가 지정되지 않았습니다." };
  const reason = str(formData.get("reason"));
  if (!reason) return { error: "취소 사유는 필수입니다." };
  const shipmentId = str(formData.get("shipmentId"));

  try {
    await cancelTradeDocument(documentId, reason);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "무역서류 취소에 실패했습니다." };
  }

  // 취소 → 잠금 가드 해제(활성 문서 소멸 시) — 선적 화물 화면 잠금 상태 갱신.
  revalidatePath("/documents");
  revalidatePath(`/documents/${documentId}`);
  if (shipmentId) revalidatePath(`/shipments/${shipmentId}`);

  return {
    ok: "무역서류가 취소되었습니다. 문서와 번호는 이력으로 남고, 선적 화물 수정 잠금이 풀립니다(다른 활성 문서가 없다면). 재발행하면 새 번호가 발번됩니다.",
  };
}
