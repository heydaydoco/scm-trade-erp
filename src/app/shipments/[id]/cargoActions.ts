"use server";

import { revalidatePath } from "next/cache";
import {
  saveShipmentCargo,
  getShipmentCargo,
  type CargoLineInput,
  type ShipmentPartyInput,
} from "@/services/shipmentCargo";
import type {
  ShipmentCargoLine,
  ShipmentParty,
} from "@/services/types";

/**
 * 화물 내역·당사자·마킹 저장 Server Action — 구 폼(saveShipmentAction)과 **경계 분리**.
 * 이 액션은 헤더·주문연결·마일스톤을 건드리지 않고, 구 액션은 화물·당사자·마킹을
 * 건드리지 않는다(전량교체 RPC 와 diff-upsert RPC 의 충돌 방지 경계).
 *
 * 성공 시 서버가 다시 읽은 정본(라인 id 포함)을 돌려준다 — 클라이언트가 이걸로
 * 상태를 동기화해야 방금 INSERT 된 행이 다음 저장에서 중복 INSERT 되지 않는다.
 */

export interface CargoFormState {
  error?: string;
  ok?: string;
  saved?: {
    lines: ShipmentCargoLine[];
    parties: ShipmentParty[];
    shippingMarks: string | null;
  };
  /** 같은 내용을 연속 저장해도 클라이언트 동기화 effect 가 다시 돌도록 하는 증가값. */
  savedAt?: number;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN; // NaN 은 아래에서 한국어로 거부
}

export async function saveShipmentCargoAction(
  _prev: CargoFormState,
  formData: FormData,
): Promise<CargoFormState> {
  const shipmentId = str(formData.get("shipmentId"));
  if (!shipmentId) return { error: "선적이 지정되지 않았습니다." };

  let rawLines: unknown;
  let rawParties: unknown;
  try {
    rawLines = JSON.parse(String(formData.get("lines") ?? "[]"));
    rawParties = JSON.parse(String(formData.get("parties") ?? "[]"));
  } catch {
    return { error: "화물 payload 해석에 실패했습니다. 화면을 새로고침한 뒤 다시 시도하세요." };
  }
  if (!Array.isArray(rawLines) || !Array.isArray(rawParties)) {
    return { error: "화물 payload 형식이 잘못됐습니다. 화면을 새로고침한 뒤 다시 시도하세요." };
  }

  const lines: CargoLineInput[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i] as Record<string, unknown>;
    const qty = numOrNull(String(l.qty ?? ""));
    if (qty === null || Number.isNaN(qty) || qty <= 0) {
      return { error: `선적 수량은 0보다 큰 숫자여야 합니다. (${i + 1}번째 줄)` };
    }
    const orderType = l.orderType === "PO" ? "PO" : l.orderType === "SO" ? "SO" : null;
    const orderLineId = str(l.orderLineId);
    if (!orderType || !orderLineId) {
      return { error: `선적 화물 라인은 주문 라인을 참조해야 합니다. (${i + 1}번째 줄)` };
    }
    const pkg = numOrNull(String(l.packageCount ?? ""));
    const wt = numOrNull(String(l.grossWeightKg ?? ""));
    const cbm = numOrNull(String(l.cbm ?? ""));
    if ([pkg, wt, cbm].some((n) => n !== null && (Number.isNaN(n) || n < 0))) {
      return { error: `포장수·중량·CBM 은 0 이상의 숫자여야 합니다. (${i + 1}번째 줄)` };
    }
    // uom 은 보내지 않는다 — 서비스가 주문 라인→품목 마스터에서 해석한다(P4.3f).
    lines.push({
      id: str(l.id),
      orderType,
      orderLineId,
      itemName: str(l.itemName),
      qty,
      packageCount: pkg,
      packageType: str(l.packageType),
      grossWeightKg: wt,
      cbm,
      memo: str(l.memo),
    });
  }

  const parties: ShipmentPartyInput[] = [];
  for (const p of rawParties as Record<string, unknown>[]) {
    const role =
      p.role === "shipper" || p.role === "consignee" || p.role === "notify"
        ? p.role
        : null;
    if (!role) return { error: "당사자 역할 값이 잘못됐습니다. 화면을 새로고침하세요." };
    const name = str(p.name);
    if (!name) continue; // 이름이 빈 블록은 "이번엔 저장 안 함" — 스냅샷을 강요하지 않는다
    parties.push({
      role,
      companyId: str(p.companyId),
      name,
      address: str(p.address),
      contact: str(p.contact),
    });
  }

  try {
    await saveShipmentCargo({
      shipmentId,
      lines,
      parties,
      shippingMarks: str(formData.get("shippingMarks")),
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "화물 내역 저장에 실패했습니다." };
  }

  // 소비 가드가 SO/PO 상세의 잠금 상태를 바꾼다 → 관련 화면 재검증.
  revalidatePath(`/shipments/${shipmentId}`);
  revalidatePath("/shipments");
  revalidatePath("/sales-orders");
  revalidatePath("/purchase-orders");

  const saved = await getShipmentCargo(shipmentId);
  return {
    ok: "화물 내역이 저장되었습니다.",
    saved,
    savedAt: Date.now(),
  };
}
