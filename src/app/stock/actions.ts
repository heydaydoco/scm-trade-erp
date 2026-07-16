"use server";

import { revalidatePath } from "next/cache";
import { saveStockAdjustment, reverseStockMovement } from "@/services/stock";

/**
 * 재고 원장 Server Actions — 원칙 1(원장은 append-only).
 *
 * ⚠️ 수정·삭제 액션이 없다. 만들지 않는다.
 *    정정은 역분개(반대부호 행 추가)뿐이고, 앱에는 원장 UPDATE/DELETE 권한 자체가 없다.
 */

export interface StockFormState {
  error?: string;
  ok?: string;
  /** 에러 시 입력값을 폼에 되돌려 재시드(재타이핑 방지). */
  values?: Record<string, string>;
}

const ECHO_FIELDS = [
  "itemId",
  "movementType",
  "qty",
  "warehouseCode",
  "movedAt",
  "lotNo",
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

function get(formData: FormData, k: string): string | null {
  const v = formData.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * 재고 조정 저장 — 기초재고 / 조정 증가 / 조정 감소.
 *
 * 부호는 보내지 않는다. 화면은 항상 양수를 넘기고 +/− 는 유형이 정한다
 * (서비스 signedQty · RPC 둘 다 같은 규칙 — 이중 방어).
 *
 * 마이너스 재고는 막지 않는다(원칙 8 — 경고 후 허용). 경고는 폼이 저장 전에 띄운다.
 */
export async function saveStockAdjustmentAction(
  _prev: StockFormState,
  formData: FormData,
): Promise<StockFormState> {
  const values = collectValues(formData);

  const itemId = get(formData, "itemId");
  if (!itemId) return { error: "품목을 선택하세요.", values };

  const movementType = get(formData, "movementType");
  if (!movementType) return { error: "조정 유형을 선택하세요.", values };

  const qtyRaw = get(formData, "qty");
  if (!qtyRaw) return { error: "수량을 입력하세요.", values };
  const qty = Number(qtyRaw.replace(/,/g, ""));
  if (!Number.isFinite(qty) || qty <= 0) {
    return { error: "수량은 0보다 큰 숫자로 입력하세요(증가·감소는 유형으로 정합니다).", values };
  }

  const memo = get(formData, "memo");
  if (!memo) {
    return { error: "사유(메모)는 필수입니다. 왜 조정하는지 남겨야 나중에 추적할 수 있습니다.", values };
  }

  try {
    await saveStockAdjustment({
      itemId,
      movementType,
      qty,
      warehouseCode: get(formData, "warehouseCode") ?? "MAIN",
      lotNo: get(formData, "lotNo"),
      movedAt: get(formData, "movedAt"),
      memo,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "저장에 실패했습니다.", values };
  }

  revalidatePath("/stock");
  revalidatePath("/stock/movements");
  revalidatePath("/");
  return { ok: "재고 조정이 등록되었습니다." };
}

/**
 * 역분개 — 정정의 유일한 수단(원칙 1: "수정이 아니라 역방향 이동 + 재입력").
 * 원행은 건드리지 않는다. 반대부호 행을 하나 더 쌓을 뿐이다.
 * 이중 역분개는 RPC 검사 + DB의 UNIQUE 부분 인덱스가 차단한다.
 */
export async function reverseStockMovementAction(
  _prev: StockFormState,
  formData: FormData,
): Promise<StockFormState> {
  const movementId = get(formData, "movementId");
  if (!movementId) return { error: "역분개할 원장 행이 지정되지 않았습니다." };

  const memo = get(formData, "memo");
  if (!memo) return { error: "역분개 사유는 필수입니다. 왜 되돌리는지 남겨야 합니다." };

  try {
    await reverseStockMovement(movementId, memo);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "역분개에 실패했습니다." };
  }

  revalidatePath("/stock");
  revalidatePath("/stock/movements");
  revalidatePath("/");
  return { ok: "역분개가 등록되었습니다." };
}
