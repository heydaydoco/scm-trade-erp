"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createShipment, updateShipment } from "@/services/shipments";
import type {
  Milestone,
  ShipmentInput,
  ShipmentOrderLink,
} from "@/services/types";

export interface ShipmentFormState {
  error?: string;
  /** 에러 시 헤더 입력값을 폼에 되돌려 재시드(연결주문·마일스톤은 클라이언트 state가 유지). */
  values?: Record<string, string>;
}

const ECHO_FIELDS = [
  "direction",
  "partnerId",
  "forwarder",
  "carrier",
  "transport",
  "vesselVoyage",
  "pol",
  "pod",
  "bookingNo",
  "blNo",
  // containerNo 없음(P5.2 사장) — 컨테이너는 적입 카드(save_shipment_containers)로.
  "incoterms",
  "status",
  "notes",
];

function collectValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of ECHO_FIELDS) {
    const v = formData.get(f);
    if (typeof v === "string") values[f] = v;
  }
  return values;
}

function parseOrders(raw: FormDataEntryValue | null): ShipmentOrderLink[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("연결 주문 데이터를 읽지 못했습니다.");
  }
  if (!Array.isArray(parsed)) return [];

  const orders: ShipmentOrderLink[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const r = item as Record<string, unknown>;
    const orderType = typeof r.orderType === "string" ? r.orderType : "";
    const orderId = typeof r.orderId === "string" && r.orderId ? r.orderId : null;
    if (!orderType || !orderId) continue;
    const key = `${orderType}::${orderId}`;
    if (seen.has(key)) {
      throw new Error("같은 주문이 한 선적에 중복으로 연결되었습니다.");
    }
    seen.add(key);
    orders.push({
      orderType,
      orderId,
      orderNumber:
        typeof r.orderNumber === "string" && r.orderNumber ? r.orderNumber : null,
    });
  }
  return orders;
}

function parseMilestones(raw: FormDataEntryValue | null): Milestone[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("마일스톤 데이터를 읽지 못했습니다.");
  }
  if (!Array.isArray(parsed)) return [];

  const milestones: Milestone[] = [];
  for (const item of parsed) {
    const r = item as Record<string, unknown>;
    const type = typeof r.type === "string" ? r.type.trim() : "";
    if (!type) continue; // 유형 없는 행 스킵
    milestones.push({
      type,
      plannedDate:
        typeof r.plannedDate === "string" && r.plannedDate ? r.plannedDate : null,
      actualDate:
        typeof r.actualDate === "string" && r.actualDate ? r.actualDate : null,
      memo: typeof r.memo === "string" && r.memo.trim() ? r.memo.trim() : null,
    });
  }
  return milestones;
}

function parseShipmentForm(formData: FormData): ShipmentInput {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };

  return {
    direction: get("direction"),
    partnerId: get("partnerId"),
    forwarder: get("forwarder"),
    carrier: get("carrier"),
    transport: get("transport"),
    vesselVoyage: get("vesselVoyage"),
    pol: get("pol"),
    pod: get("pod"),
    bookingNo: get("bookingNo"),
    blNo: get("blNo"),
    incoterms: get("incoterms"),
    status: get("status") ?? "draft",
    notes: get("notes"),
    orders: parseOrders(formData.get("orders")),
    milestones: parseMilestones(formData.get("milestones")),
  };
}

/**
 * 선적 등록/수정 Server Action (등록·수정 겸용; id 있으면 수정).
 * 주문연결·마일스톤은 헤더와 함께 원자 저장된다(save_shipment). 성공 시 목록으로 이동.
 */
export async function saveShipmentAction(
  _prev: ShipmentFormState,
  formData: FormData,
): Promise<ShipmentFormState> {
  const values = collectValues(formData);

  let input: ShipmentInput;
  try {
    input = parseShipmentForm(formData);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "입력값을 확인해주세요.",
      values,
    };
  }

  const id = formData.get("id");
  try {
    if (typeof id === "string" && id) {
      await updateShipment(id, input);
    } else {
      await createShipment(input);
    }
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "저장에 실패했습니다.",
      values,
    };
  }

  revalidatePath("/shipments");
  redirect("/shipments");
}
