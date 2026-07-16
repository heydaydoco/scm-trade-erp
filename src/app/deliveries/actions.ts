"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveDelivery, cancelDelivery } from "@/services/deliveries";
import type { DeliveryLineInput } from "@/services/deliveries";

/**
 * 출고 Server Actions — 원칙 1·5 (P4.2 입고 액션 미러).
 *
 * ⚠️ 수정 액션이 없다. 출고는 저장 아니면 취소(=원장 역분개)뿐이다.
 *    잘못 넣었으면 취소하고 다시 등록한다.
 */

export interface DeliveryFormState {
  error?: string;
  ok?: string;
}

function get(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * 출고 등록 — 헤더 + 라인 + 원장 전기(DLV_OUT, −)가 한 트랜잭션(RPC).
 * 초과출고·마이너스 재고는 막지 않는다(원칙 8) — 폼이 저장 전에 확인만 받는다.
 */
export async function saveDeliveryAction(
  _prev: DeliveryFormState,
  formData: FormData,
): Promise<DeliveryFormState> {
  const soId = get(formData, "soId");
  if (!soId) return { error: "수주가 지정되지 않았습니다." };

  const memo = get(formData, "memo");
  const deliveryDate = get(formData, "deliveryDate");
  const warehouseCode = get(formData, "warehouseCode") ?? "MAIN";

  // 라인은 lines[i].* 형태로 온다. 수량이 비었거나 0인 줄은 "이번엔 안 내보낸다"로 보고 건너뛴다.
  const lines: DeliveryLineInput[] = [];
  const count = Number(get(formData, "lineCount") ?? "0");
  for (let i = 0; i < count; i++) {
    const qtyRaw = get(formData, `lines[${i}].qty`);
    if (!qtyRaw) continue;
    const qty = Number(qtyRaw.replace(/,/g, ""));
    if (!Number.isFinite(qty) || qty <= 0) continue;

    // 품목 미연결 라인은 원장이 받지 못한다 → RPC 가 거부하기 전에 한국어로 먼저 막는다.
    // (RPC 로 itemId 를 보내지는 않는다 — 품목은 수주 라인에서 가져온다. 여기선 판정용)
    const itemId = get(formData, `lines[${i}].itemId`);
    if (!itemId) {
      return {
        error:
          "품목 마스터에 연결되지 않은 수주 라인은 출고할 수 없습니다(재고 원장은 등록 품목만 받습니다). 해당 줄의 수량을 비우거나, 품목을 등록해 수주 라인에 연결하세요.",
      };
    }

    const soLineId = get(formData, `lines[${i}].soLineId`);
    if (!soLineId) {
      return {
        error:
          "출고 라인은 수주 라인을 참조해야 합니다. 화면을 새로고침한 뒤 다시 시도하세요.",
      };
    }

    // uom 은 보내지 않는다 — 서비스가 수주 라인→품목 마스터에서 해석한다(P4.3f).
    lines.push({
      soLineId,
      itemName: get(formData, `lines[${i}].itemName`),
      qty,
      lotNo: get(formData, `lines[${i}].lotNo`),
    });
  }

  if (lines.length === 0) {
    return { error: "출고할 수량을 최소 한 줄 입력하세요." };
  }

  let dlvId: string;
  try {
    const r = await saveDelivery({
      soId,
      lines,
      deliveryDate,
      warehouseCode,
      memo,
    });
    dlvId = r.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "출고 저장에 실패했습니다." };
  }

  revalidatePath("/deliveries");
  revalidatePath(`/sales-orders/${soId}`);
  revalidatePath("/sales-orders");
  revalidatePath("/stock");
  revalidatePath("/stock/movements");
  revalidatePath("/");
  redirect(`/deliveries/${dlvId}`);
}

/**
 * 출고 취소 — 삭제가 아니라 상태 + 원장 역분개(원칙 1·5).
 * 취소하면 수주 잠금이 풀리고 잔량·상태가 자동 복원된다(전이는 RPC 내부).
 */
export async function cancelDeliveryAction(
  _prev: DeliveryFormState,
  formData: FormData,
): Promise<DeliveryFormState> {
  const id = get(formData, "deliveryId");
  if (!id) return { error: "취소할 출고가 지정되지 않았습니다." };

  const memo = get(formData, "memo");
  if (!memo) return { error: "출고 취소 사유는 필수입니다. 왜 취소하는지 남겨야 합니다." };

  try {
    await cancelDelivery(id, memo);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "출고 취소에 실패했습니다." };
  }

  revalidatePath("/deliveries");
  revalidatePath(`/deliveries/${id}`);
  revalidatePath("/sales-orders");
  revalidatePath("/stock");
  revalidatePath("/stock/movements");
  revalidatePath("/");
  return { ok: "출고가 취소되었습니다. 재고는 역분개로 원복되었습니다." };
}
