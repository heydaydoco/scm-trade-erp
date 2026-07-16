"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveGoodsReceipt, cancelGoodsReceipt } from "@/services/receipts";
import type { ReceiptLineInput } from "@/services/receipts";

/**
 * 입고 Server Actions — 원칙 1·5.
 *
 * ⚠️ 수정 액션이 없다. 입고는 저장 아니면 취소(=원장 역분개)뿐이다.
 *    잘못 넣었으면 취소하고 다시 등록한다.
 */

export interface ReceiptFormState {
  error?: string;
  ok?: string;
}

function get(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * 입고 등록 — 헤더 + 라인 + 원장 전기(GR_IN)가 한 트랜잭션(RPC).
 * 초과입고는 막지 않는다(원칙 8) — 폼이 저장 전에 확인만 받는다.
 */
export async function saveReceiptAction(
  _prev: ReceiptFormState,
  formData: FormData,
): Promise<ReceiptFormState> {
  const poId = get(formData, "poId");
  if (!poId) return { error: "발주가 지정되지 않았습니다." };

  const memo = get(formData, "memo");
  const receiptDate = get(formData, "receiptDate");
  const warehouseCode = get(formData, "warehouseCode") ?? "MAIN";

  // 라인은 lines[i].* 형태로 온다. 수량이 비었거나 0인 줄은 "이번엔 안 받는다"로 보고 건너뛴다.
  const lines: ReceiptLineInput[] = [];
  const count = Number(get(formData, "lineCount") ?? "0");
  for (let i = 0; i < count; i++) {
    const qtyRaw = get(formData, `lines[${i}].qty`);
    if (!qtyRaw) continue;
    const qty = Number(qtyRaw.replace(/,/g, ""));
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const itemId = get(formData, `lines[${i}].itemId`);
    if (!itemId) {
      return {
        error:
          "품목 마스터에 연결되지 않은 발주 라인은 입고할 수 없습니다(재고 원장은 등록 품목만 받습니다). 해당 줄의 수량을 비우거나, 품목을 등록해 발주 라인에 연결하세요.",
      };
    }

    lines.push({
      poLineId: get(formData, `lines[${i}].poLineId`),
      itemId,
      itemName: get(formData, `lines[${i}].itemName`),
      qty,
      uom: get(formData, `lines[${i}].uom`),
      lotNo: get(formData, `lines[${i}].lotNo`),
      memo: null,
    });
  }

  if (lines.length === 0) {
    return { error: "입고할 수량을 최소 한 줄 입력하세요." };
  }

  let grId: string;
  try {
    const r = await saveGoodsReceipt({
      poId,
      lines,
      receiptDate,
      warehouseCode,
      memo,
    });
    grId = r.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "입고 저장에 실패했습니다." };
  }

  revalidatePath("/receipts");
  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/purchase-orders");
  revalidatePath("/stock");
  revalidatePath("/stock/movements");
  revalidatePath("/");
  redirect(`/receipts/${grId}`);
}

/**
 * 입고 취소 — 삭제가 아니라 상태 + 원장 역분개(원칙 1·5).
 * 취소하면 발주 잠금이 풀리고 잔량·상태가 자동 복원된다(전이는 RPC 내부).
 */
export async function cancelReceiptAction(
  _prev: ReceiptFormState,
  formData: FormData,
): Promise<ReceiptFormState> {
  const id = get(formData, "receiptId");
  if (!id) return { error: "취소할 입고가 지정되지 않았습니다." };

  const memo = get(formData, "memo");
  if (!memo) return { error: "입고 취소 사유는 필수입니다. 왜 취소하는지 남겨야 합니다." };

  try {
    await cancelGoodsReceipt(id, memo);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "입고 취소에 실패했습니다." };
  }

  revalidatePath("/receipts");
  revalidatePath(`/receipts/${id}`);
  revalidatePath("/purchase-orders");
  revalidatePath("/stock");
  revalidatePath("/stock/movements");
  revalidatePath("/");
  return { ok: "입고가 취소되었습니다. 재고는 역분개로 원복되었습니다." };
}
