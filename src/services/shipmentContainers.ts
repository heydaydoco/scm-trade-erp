import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ShipmentContainer,
  ShipmentContainerAllocation,
} from "./types";

/**
 * 적입(P5.2 · E5) 컨테이너·배분 서비스 — SPEC E 계열.
 *
 * ⚠️ 쓰기는 SECURITY DEFINER RPC `save_shipment_containers` 하나뿐이다.
 *    앱에는 shipment_containers/shipment_container_allocations 의 INSERT 권한조차
 *    없다(출생 봉인: revoke all → grant select). 직접 테이블 쓰기 경로는 없다.
 *
 * ⚠️ **전표가 아니다** — 채번 없음·인쇄물 없음·문서흐름(chainLogic) 편입 없음.
 *    선적 하위의 실측 기록이므로 선적·화물라인 삭제 시 cascade 로 함께 사라진다.
 *
 * ⚠️ 발행(issued CI/PL) 잠금 **비대상**이다(update_shipment_marks 선례 동급) —
 *    적입 실측은 서류 발행 후에도 갱신될 수 있는 사실이다. 기발행 문서의 스냅샷은
 *    당연히 불변이다(적입은 아직 CI/PL 스냅샷에 들어가지 않는다 — 백로그).
 */

/* ---------- 순수 로직 재수출 — 단일 진실은 containerLogic(적입 고유) ---------- */
export {
  sumAllocatedByContainer,
  sumAllocatedByLine,
  lineAllocationStatus,
  prorateShare,
  containerMetrics,
  utilizationOf,
  type AllocationLike,
  type AllocatableCargoLine,
  type ContainerLike,
  type LineAllocationStatus,
  type ContainerMetrics,
} from "./containerLogic";

/* ---------- 물리 행 모양 ---------- */

interface ContainerRow {
  id: string;
  container_no: string | null;
  container_type: string | null;
  seal_no: string | null;
  vgm_kg: number | string | null;
}

interface AllocationRow {
  id: string;
  container_id: string;
  shipment_line_id: string;
  allocated_package_count: number | string;
}

/** PostgREST 기본 상한(1000행)은 **경고 없이 자른다**(P4.1f 확증 함정) — 페이지 크기. */
const PAGE = 1000;
/** .in() id 목록은 URL 로 나간다 — 길면 요청 자체가 깨지므로 잘라 보낸다. */
const IN_CHUNK = 150;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function num(v: number | string): number {
  return typeof v === "number" ? v : Number(v);
}

function numOrNull(v: number | string | null): number | null {
  if (v === null) return null;
  return typeof v === "number" ? v : Number(v);
}

/* ---------- I/O ---------- */

/**
 * 선적 1건의 컨테이너·배분.
 *
 * 배분 테이블에는 shipment_id 가 없다(컨테이너 경유가 유일 경로) → 컨테이너 id 로
 * 조회한다. 컨테이너가 0건이면 배분도 0건이다(FK cascade 로 고아가 없다).
 * 정렬 컬럼이 없으므로(스펙 확정) 번호·id 순으로 결정적 표시를 만든다.
 */
export async function getShipmentContainers(shipmentId: string): Promise<{
  containers: ShipmentContainer[];
  allocations: ShipmentContainerAllocation[];
}> {
  const supabase = createSupabaseServerClient();

  const containerRows: ContainerRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("shipment_containers")
      .select("id, container_no, container_type, seal_no, vgm_kg")
      .eq("shipment_id", shipmentId)
      .order("container_no", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }) // 전순서 타이브레이커 — 경계 중복·누락 방지
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`컨테이너 조회 실패: ${error.message}`);
    const batch = (data ?? []) as unknown as ContainerRow[];
    containerRows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const containers: ShipmentContainer[] = containerRows.map((r) => ({
    id: r.id,
    containerNo: r.container_no,
    containerType: r.container_type,
    sealNo: r.seal_no,
    vgmKg: numOrNull(r.vgm_kg),
  }));
  if (containers.length === 0) return { containers, allocations: [] };

  const allocations: ShipmentContainerAllocation[] = [];
  for (const idChunk of chunks(containers.map((c) => c.id), IN_CHUNK)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("shipment_container_allocations")
        .select("id, container_id, shipment_line_id, allocated_package_count")
        .in("container_id", idChunk)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`컨테이너 배분 조회 실패: ${error.message}`);
      const batch = (data ?? []) as unknown as AllocationRow[];
      for (const a of batch) {
        allocations.push({
          id: a.id,
          containerId: a.container_id,
          shipmentLineId: a.shipment_line_id,
          allocatedPackageCount: num(a.allocated_package_count),
        });
      }
      if (batch.length < PAGE) break;
    }
  }

  return { containers, allocations };
}

/* ---------- 저장 ---------- */

/**
 * 컨테이너 1건의 저장 입력.
 * `ref` 는 payload 안에서만 유효한 임시키다 — 배분이 **신규·기존 컨테이너를 공통으로**
 * 가리키기 위한 축(RPC 가 ref→id 로 해석한다). 저장되지 않는다.
 */
export interface ContainerInput {
  ref: string;
  /** 기존 행이면 id (diff-upsert 의 UPDATE 키). 신규는 null. */
  id: string | null;
  containerNo: string | null;
  containerType: string | null;
  sealNo: string | null;
  vgmKg: number | null;
}

/**
 * 배분 1건의 저장 입력 — **id 가 없다**. 배분은 세트 전량교체(delete-all + insert)라
 * 기존 행 id 를 재사용하지 않는다(unique(container,line) 스왑 시의 순간적 위반 차단).
 */
export interface ContainerAllocationInput {
  containerRef: string;
  shipmentLineId: string;
  allocatedPackageCount: number;
}

/**
 * 컨테이너·배분 저장 — RPC 한 트랜잭션.
 * 컨테이너는 id-diff-upsert(payload 에서 빠진 행 = 삭제), 배분은 전량교체.
 */
export async function saveShipmentContainers(input: {
  shipmentId: string;
  containers: ContainerInput[];
  allocations: ContainerAllocationInput[];
  /** 클라이언트가 화면에 갖고 있던 저장 컨테이너 id — 동시성 베이스라인(아래 검사). */
  knownContainerIds: string[];
}): Promise<{ containerCount: number; allocationCount: number }> {
  const supabase = createSupabaseServerClient();

  // ★ 동시성 베이스라인 — 컨테이너 diff-DELETE 는 "payload 에 없는 행"을 지운다.
  //   다른 화면(탭)이 그 사이 추가한 컨테이너는 이 화면의 payload 에 없으므로, 대조
  //   없이 저장하면 **경고 없이 삭제**된다(그 컨테이너의 배분까지 cascade 로).
  //   화물 카드(saveShipmentCargo)와 같은 방어다.
  //   ⚠️ 배분에는 베이스라인이 없다 — 세트 전량교체라 id 대조가 성립하지 않는다
  //     (shipment_parties 선례와 같은 성질). 컨테이너 집합이 일치하는 한, 이 화면이
  //     보낸 배분이 그 컨테이너들의 배분 정본이 된다.
  const { data: curRows, error: curErr } = await supabase
    .from("shipment_containers")
    .select("id")
    .eq("shipment_id", input.shipmentId);
  if (curErr) throw new Error(`컨테이너 조회 실패: ${curErr.message}`);
  const known = new Set(input.knownContainerIds);
  const foreign = ((curRows ?? []) as unknown as { id: string }[]).filter(
    (r) => !known.has(r.id),
  );
  if (foreign.length > 0) {
    throw new Error(
      `다른 화면에서 적입 내역이 변경되었습니다(이 화면이 모르는 컨테이너 ${foreign.length}건). ` +
        `화면을 새로고침해 최신 내역을 확인한 뒤 다시 저장하세요.`,
    );
  }

  const { data, error } = await supabase.rpc("save_shipment_containers", {
    p_shipment_id: input.shipmentId,
    p_containers: input.containers.map((c) => ({
      ref: c.ref,
      id: c.id,
      containerNo: c.containerNo,
      containerType: c.containerType,
      sealNo: c.sealNo,
      vgmKg: c.vgmKg,
    })),
    p_allocations: input.allocations.map((a) => ({
      containerRef: a.containerRef,
      shipmentLineId: a.shipmentLineId,
      allocatedPackageCount: a.allocatedPackageCount,
    })),
  });

  if (error) throw new Error(`적입 내역 저장 실패: ${error.message}`);
  const r = data as { containerCount: number; allocationCount: number };
  return { containerCount: r.containerCount, allocationCount: r.allocationCount };
}
