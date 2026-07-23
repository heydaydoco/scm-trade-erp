"use server";

import { revalidatePath } from "next/cache";
import {
  saveShipmentContainers,
  getShipmentContainers,
  type ContainerInput,
  type ContainerAllocationInput,
} from "@/services/shipmentContainers";
import type {
  ShipmentContainer,
  ShipmentContainerAllocation,
} from "@/services/types";

/**
 * 적입(P5.2) 컨테이너·배분 저장 Server Action — 화물 카드·구 선적 폼과 **경계 분리**.
 * 이 액션은 화물 라인·당사자·화인·헤더를 건드리지 않는다(각 RPC 의 저장 경계 분리).
 *
 * 성공 시 서버가 다시 읽은 정본(컨테이너 id 포함)을 돌려준다 — 클라이언트가 이걸로
 * 상태를 동기화해야 방금 INSERT 된 컨테이너가 다음 저장에서 중복 INSERT 되지 않는다.
 */

export interface ContainerFormState {
  error?: string;
  ok?: string;
  saved?: {
    containers: ShipmentContainer[];
    allocations: ShipmentContainerAllocation[];
  };
  /** 같은 내용을 연속 저장해도 클라이언트 동기화 effect 가 다시 돌도록 하는 증가값. */
  savedAt?: number;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN; // NaN 은 아래에서 한국어로 거부
}

const PARSE_ERROR =
  "적입 payload 형식이 잘못됐습니다. 화면을 새로고침한 뒤 다시 시도하세요.";

export async function saveShipmentContainersAction(
  _prev: ContainerFormState,
  formData: FormData,
): Promise<ContainerFormState> {
  const shipmentId = str(formData.get("shipmentId"));
  if (!shipmentId) return { error: "선적이 지정되지 않았습니다." };

  let rawContainers: unknown;
  let rawAllocations: unknown;
  let rawKnown: unknown;
  try {
    rawContainers = JSON.parse(String(formData.get("containers") ?? "[]"));
    rawAllocations = JSON.parse(String(formData.get("allocations") ?? "[]"));
    rawKnown = JSON.parse(String(formData.get("knownContainerIds") ?? "[]"));
  } catch {
    return { error: "적입 payload 해석에 실패했습니다. 화면을 새로고침한 뒤 다시 시도하세요." };
  }
  if (
    !Array.isArray(rawContainers) ||
    !Array.isArray(rawAllocations) ||
    !Array.isArray(rawKnown)
  ) {
    return { error: PARSE_ERROR };
  }
  const knownContainerIds = rawKnown.filter(
    (v): v is string => typeof v === "string",
  );

  const containers: ContainerInput[] = [];
  const seenRefs = new Set<string>();
  for (let i = 0; i < rawContainers.length; i++) {
    // [null]·문자열 원소 등은 Array.isArray 를 통과한다 — 원소 단위로도 형식을 검사.
    if (typeof rawContainers[i] !== "object" || rawContainers[i] === null) {
      return { error: PARSE_ERROR };
    }
    const c = rawContainers[i] as Record<string, unknown>;
    const ref = str(c.ref);
    if (!ref) return { error: PARSE_ERROR };
    if (seenRefs.has(ref)) return { error: PARSE_ERROR }; // ref 는 payload 내 고유
    seenRefs.add(ref);

    const vgm = numOrNull(c.vgmKg);
    if (vgm !== null && (Number.isNaN(vgm) || vgm < 0)) {
      return {
        error: `VGM(kg)은 0 이상의 숫자여야 합니다. (${i + 1}번째 컨테이너, 받은 값: ${String(c.vgmKg ?? "")})`,
      };
    }
    // 텍스트 3필드는 정규화(공백 정리)만 — 대문자 강제·ISO 체크디지트 검증 금지.
    containers.push({
      ref,
      id: str(c.id),
      containerNo: str(c.containerNo),
      containerType: str(c.containerType),
      sealNo: str(c.sealNo),
      vgmKg: vgm,
    });
  }

  const allocations: ContainerAllocationInput[] = [];
  const seenPairs = new Set<string>();
  for (let i = 0; i < rawAllocations.length; i++) {
    if (typeof rawAllocations[i] !== "object" || rawAllocations[i] === null) {
      return { error: PARSE_ERROR };
    }
    const a = rawAllocations[i] as Record<string, unknown>;
    const containerRef = str(a.containerRef);
    const shipmentLineId = str(a.shipmentLineId);
    if (!containerRef || !seenRefs.has(containerRef)) {
      return {
        error: `배분이 가리키는 컨테이너를 찾을 수 없습니다. (${i + 1}번째 배분) 화면을 새로고침한 뒤 다시 시도하세요.`,
      };
    }
    if (!shipmentLineId) {
      return { error: `배분 대상 화물 라인을 선택하세요. (${i + 1}번째 배분)` };
    }
    const count = numOrNull(a.allocatedPackageCount);
    if (count === null || Number.isNaN(count) || count <= 0 || !Number.isInteger(count)) {
      return {
        error: `배분 포장수는 1 이상의 정수여야 합니다. (${i + 1}번째 배분, 받은 값: ${String(a.allocatedPackageCount ?? "")})`,
      };
    }
    // (컨테이너, 라인) 중복은 DB unique 제약 위반이다 — 날것의 예외 전에 한국어로.
    const pair = `${containerRef}|${shipmentLineId}`;
    if (seenPairs.has(pair)) {
      return {
        error: `같은 컨테이너에 같은 화물 라인을 두 번 배분했습니다. (${i + 1}번째 배분) 한 줄로 합쳐 주세요.`,
      };
    }
    seenPairs.add(pair);
    allocations.push({ containerRef, shipmentLineId, allocatedPackageCount: count });
  }

  try {
    await saveShipmentContainers({
      shipmentId,
      containers,
      allocations,
      knownContainerIds,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "적입 내역 저장에 실패했습니다." };
  }

  // 적입은 선적 상세(적입 카드)와 S/I 인쇄가 소비한다 — 기발행 무역서류는 스냅샷이라 불변.
  revalidatePath(`/shipments/${shipmentId}`);
  revalidatePath(`/shipments/${shipmentId}/print`);

  // 저장은 이미 성공했다 — 동기화용 재조회가 실패해도 크래시 대신 안내로.
  try {
    const saved = await getShipmentContainers(shipmentId);
    return { ok: "적입 내역이 저장되었습니다.", saved, savedAt: Date.now() };
  } catch {
    return {
      ok: "적입 내역이 저장되었습니다. (화면 동기화 조회에 실패했습니다 — 새로고침해 주세요)",
      savedAt: Date.now(),
    };
  }
}
