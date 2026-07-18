"use server";

import { revalidatePath } from "next/cache";
import {
  saveShipmentCargo,
  getShipmentCargo,
  updateShipmentMarks,
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
  let rawKnown: unknown;
  try {
    rawLines = JSON.parse(String(formData.get("lines") ?? "[]"));
    rawParties = JSON.parse(String(formData.get("parties") ?? "[]"));
    rawKnown = JSON.parse(String(formData.get("knownLineIds") ?? "[]"));
  } catch {
    return { error: "화물 payload 해석에 실패했습니다. 화면을 새로고침한 뒤 다시 시도하세요." };
  }
  if (!Array.isArray(rawLines) || !Array.isArray(rawParties) || !Array.isArray(rawKnown)) {
    return { error: "화물 payload 형식이 잘못됐습니다. 화면을 새로고침한 뒤 다시 시도하세요." };
  }
  const knownLineIds = rawKnown.filter((v): v is string => typeof v === "string");

  const lines: CargoLineInput[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    // [null]·문자열 원소 등은 Array.isArray 를 통과한다 — 원소 단위로도 형식을 검사.
    if (typeof rawLines[i] !== "object" || rawLines[i] === null) {
      return { error: "화물 payload 형식이 잘못됐습니다. 화면을 새로고침한 뒤 다시 시도하세요." };
    }
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
    // 포장수는 DB 가 integer — 소수를 흘리면 영문 원문 캐스트 에러가 뜬다.
    if (pkg !== null && !Number.isInteger(pkg)) {
      return { error: `포장 수는 정수여야 합니다. (${i + 1}번째 줄, 받은 값: ${l.packageCount})` };
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
  for (const raw of rawParties) {
    if (typeof raw !== "object" || raw === null) {
      return { error: "화물 payload 형식이 잘못됐습니다. 화면을 새로고침한 뒤 다시 시도하세요." };
    }
    const p = raw as Record<string, unknown>;
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
      knownLineIds,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "화물 내역 저장에 실패했습니다." };
  }

  // 소비 가드가 SO/PO 상세의 잠금 상태를 바꾼다 → 관련 화면 재검증.
  revalidatePath(`/shipments/${shipmentId}`);
  revalidatePath("/shipments");
  revalidatePath("/sales-orders");
  revalidatePath("/purchase-orders");

  // 저장은 이미 성공했다 — 동기화용 재조회가 실패해도 크래시 대신 안내로.
  try {
    const saved = await getShipmentCargo(shipmentId);
    return { ok: "화물 내역이 저장되었습니다.", saved, savedAt: Date.now() };
  } catch {
    return {
      ok: "화물 내역이 저장되었습니다. (화면 동기화 조회에 실패했습니다 — 새로고침해 주세요)",
      savedAt: Date.now(),
    };
  }
}

/**
 * 화인(Shipping Marks)만 저장 — P4.5(c0) 전용 RPC 경로.
 * 위 일괄 저장(saveShipmentCargoAction)과 **경계 분리**: 이 액션은 라인·당사자를
 * 건드리지 않으므로 활성 무역서류가 있는 선적에서도 성공한다(가드 비대상).
 */
export interface MarksFormState {
  error?: string;
  ok?: string;
  /** 서버 정규화 결과(공백→null) — 클라이언트 상태 동기화용. */
  savedMarks?: string | null;
  savedAt?: number;
}

export async function updateShipmentMarksAction(
  _prev: MarksFormState,
  formData: FormData,
): Promise<MarksFormState> {
  const shipmentId = str(formData.get("shipmentId"));
  if (!shipmentId) return { error: "선적이 지정되지 않았습니다." };

  // 빈 값 허용 — 지우기는 정당(서버가 공백→NULL 정규화). trim 하지 않고 원문 전달.
  const raw = formData.get("shippingMarks");
  const marks = typeof raw === "string" ? raw : null;

  let savedMarks: string | null = null;
  try {
    ({ shippingMarks: savedMarks } = await updateShipmentMarks(shipmentId, marks));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "화인 저장에 실패했습니다." };
  }

  // 화인은 선적 상세(화물 카드)와 S/I 인쇄가 소비한다 — 기발행 무역서류는 스냅샷이라 불변.
  revalidatePath(`/shipments/${shipmentId}`);
  revalidatePath(`/shipments/${shipmentId}/print`);

  return {
    ok: "화인(Shipping Marks)이 저장되었습니다.",
    savedMarks,
    savedAt: Date.now(),
  };
}
