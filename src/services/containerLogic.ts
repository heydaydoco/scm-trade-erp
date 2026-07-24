/**
 * 적입(P5.2 · E5) 순수 로직 — I/O 없음 → 단위 테스트 대상(containerLogic.test.ts).
 *
 * ⚠️ **클라이언트 안전 모듈**이다(cargoLogic.ts 와 같은 결) — 적입 카드는 브라우저에서
 *    배분 합·비례 지표·용적률을 계산해야 하는데 services/shipmentContainers.ts 는
 *    supabase 서버 클라이언트를 import 하므로 "use client" 에서 못 부른다
 *    → 순수부만 여기 두고 shipmentContainers.ts 가 재수출한다.
 *
 * ⚠️ 여기서 나오는 적입 지표는 **라이브 테이블에는 저장되지 않는다**(P5.2 판정 ④) —
 *    화면·S/I 는 매번 파생 계산한다. VGM(입력값)과 G.W. 합(파생값)은 별개이며
 *    상호검증하지 않는다. (P5.3 부터 **발행 스냅샷**에는 서버가 계산한 값이 동결된다 —
 *    그건 '발행 시점 사실의 동결'이라는 별개 계보이지 판정 ④ 위반이 아니다.)
 *
 * ⚠️ 반올림 규약(P5.3 판정 ① 개정):
 *    · **몫**(비례 몫·용적률) = 몫의 **참값** 기준 half away from zero · 소수 6자리.
 *      double 을 경유하면 tie 가 아래로 떨어져 SQL `round(numeric,6)` 과 어긋난다
 *      (실측 40만 건 중 273건). 그래서 아래 ⓪ 처럼 **정확 십진 산술**로 구현한다 —
 *      P4.5 `mulRound2`/`allocRound2` 계보의 6자리판이다.
 *    · **합**(누적) = 현행 `docFlow.round6` 유지. 피가산 항이 전부 6자리 십진
 *      정밀값이라 참합도 6자리 → tie 가 구조적으로 생기지 않고, 업무 도메인 규모의
 *      double 누적 오차는 반올림 임계(5e-7)에 못 미친다(containerLogic.test ⑥-3).
 */
import { round6 } from "./docFlow";
import { nominalCbmOf } from "@/lib/containerSpecs";

/* ---------- ⓪ 몫의 참값 반올림 — 정확 십진 (P5.3 판정 ①) ----------
 *
 * 값의 십진 문자열 표현(DB numeric 원문과 일치)을 정수 스케일로 복원해 유리수
 * 나눗셈을 정확히 수행하고, 나머지 비교로 half away from zero 를 판정한다.
 * 부동소수 경유가 없다. 지수 표기 극단값만 float 폴백한다(업무값 도달 불가).
 */
interface ScaledInt {
  i: bigint; // 부호 포함 정수부
  s: number; // 10^s 분모 스케일
}

function scaledOrNull(n: number): ScaledInt | null {
  if (!Number.isFinite(n)) return null;
  const str = String(n);
  if (/[eE]/.test(str)) return null; // 1e-7 등 극단값 — float 폴백
  const neg = str.startsWith("-");
  const body = neg ? str.slice(1) : str;
  const [int, frac = ""] = body.split(".");
  const i = BigInt(int + frac);
  return { i: neg ? -i : i, s: frac.length };
}

// BigInt 리터럴(10n)은 target ES2017 에서 막힌다 — 함수 호출 형태만 사용.
const BIG0 = BigInt(0);
const POW10 = (s: number): bigint => BigInt(10) ** BigInt(s);

/** 정확 유리수 num/den(den>0)을 소수 6자리 half-away-from-zero 반올림. */
function roundRatio6(num: bigint, den: bigint): number {
  const abs = num < BIG0 ? -num : num;
  // floor(|num|/den × 10^6 + 0.5) — BigInt 나눗셈이 floor 라 분자에 den 을 더한다.
  const q = (abs * BigInt(2000000) + den) / (BigInt(2) * den);
  return (num < BIG0 ? -Number(q) : Number(q)) / 1e6;
}

/** round(v×p÷w, 6) — 서버 비례 몫 동치. w > 0 전제(호출부가 검사). */
function ratioRound6(v: number, p: number, w: number): number {
  const sv = scaledOrNull(v);
  const sp = scaledOrNull(p);
  const sw = scaledOrNull(w);
  if (!sv || !sp || !sw || sw.i <= BIG0) return round6((v * p) / w);
  return roundRatio6(sv.i * sp.i * POW10(sw.s), sw.i * POW10(sv.s + sp.s));
}

/** round(a÷b, 6) — 용적률용 단순 몫. b > 0 전제(호출부가 검사). */
function quotRound6(a: number, b: number): number {
  const sa = scaledOrNull(a);
  const sb = scaledOrNull(b);
  if (!sa || !sb || sb.i <= BIG0) return round6(a / b);
  return roundRatio6(sa.i * POW10(sb.s), sb.i * POW10(sa.s));
}

/* ---------- 입력 모양 ---------- */

/**
 * 배분 1건. 컨테이너는 **ref(임시키)** 로 가리킨다 — 저장 전 신규 컨테이너와
 * 기존 컨테이너를 화면·payload·RPC 가 같은 축으로 다루기 위해서다(RPC 동일 규약).
 */
export interface AllocationLike {
  containerRef: string;
  shipmentLineId: string;
  allocatedPackageCount: number;
}

/** 배분 대상 화물 라인 — 비례 몫의 분모(포장수)와 원값(중량·CBM). */
export interface AllocatableCargoLine {
  id: string;
  packageCount: number | null;
  grossWeightKg: number | null;
  cbm: number | null;
}

/** 컨테이너 — 지표 계산에 필요한 부분만(번호·씰·VGM 은 지표와 무관). */
export interface ContainerLike {
  ref: string;
  containerType: string | null;
}

/* ---------- ① 배분 합계 ---------- */

/** 컨테이너별 배분 포장수 합. */
export function sumAllocatedByContainer(
  allocations: readonly AllocationLike[],
): Map<string, number> {
  const acc = new Map<string, number>();
  for (const a of allocations) {
    acc.set(
      a.containerRef,
      round6((acc.get(a.containerRef) ?? 0) + a.allocatedPackageCount),
    );
  }
  return acc;
}

/** 라인별 배분 포장수 합(여러 컨테이너에 나뉜 한 라인을 가로질러 합산). */
export function sumAllocatedByLine(
  allocations: readonly AllocationLike[],
): Map<string, number> {
  const acc = new Map<string, number>();
  for (const a of allocations) {
    acc.set(
      a.shipmentLineId,
      round6((acc.get(a.shipmentLineId) ?? 0) + a.allocatedPackageCount),
    );
  }
  return acc;
}

/* ---------- ② 라인 배분 현황 — 잔여·과배분(경고용 판정) ---------- */

export interface LineAllocationStatus {
  lineId: string;
  /** 라인 포장수. null 이면 잔여를 판단할 근거가 없다. */
  packageCount: number | null;
  allocated: number;
  /** 포장수 − 배분합. 포장수 미기재면 null(판단 불가). */
  remaining: number | null;
  /** 과배분 — **차단이 아니라 경고**(서버가 막지 않는 스펙, 원칙 8과 같은 결). */
  over: boolean;
}

/**
 * 라인별 배분 현황 — 라인 순서를 보존한다(화면 표시 안정).
 * 포장수가 없는 라인에도 배분은 허용된다(스펙) → 그 경우 잔여는 null 이고
 * '초과'로 단정하지 않는다(모르는 것을 위반으로 만들지 않는다).
 */
export function lineAllocationStatus(
  lines: readonly AllocatableCargoLine[],
  allocations: readonly AllocationLike[],
): LineAllocationStatus[] {
  const byLine = sumAllocatedByLine(allocations);
  return lines.map((l) => {
    const allocated = byLine.get(l.id) ?? 0;
    const known = l.packageCount != null;
    return {
      lineId: l.id,
      packageCount: l.packageCount,
      allocated,
      remaining: known ? round6(l.packageCount! - allocated) : null,
      over: known ? allocated > l.packageCount! : false,
    };
  });
}

/* ---------- ③ 비례 몫 ---------- */

/**
 * 포장수 비율의 비례 몫 — `value × part / whole`.
 * 원값이 없거나(미기재) 분모가 없으면 **null(산출 불가)**: 0 으로 단정하면
 * "0kg 짜리 컨테이너"라는 거짓 사실이 화면·인쇄에 남는다.
 *
 * 반올림은 **몫의 참값** 기준 6자리다(⓪ 참조) — SQL `round(numeric,6)` 과 동치.
 */
export function prorateShare(
  value: number | null,
  part: number,
  whole: number | null,
): number | null {
  if (value === null || whole === null || whole <= 0) return null;
  return ratioRound6(value, part, whole);
}

/* ---------- ④ 컨테이너 파생 지표 ---------- */

export interface ContainerMetrics {
  ref: string;
  allocationCount: number;
  /** 배분 포장수 합. */
  packages: number;
  /** 비례 G.W.(kg) — 산출 가능한 몫만 더한 값. */
  grossWeightKg: number;
  /** 산출 불가한 배분이 하나라도 있으면 true(합계가 '전부'가 아님을 표시). */
  gwIncomplete: boolean;
  /** 비례 CBM(m³) — 산출 가능한 몫만 더한 값. */
  cbm: number;
  cbmIncomplete: boolean;
  /** 공칭 내용적(m³) — type 정확일치일 때만(자문). */
  nominalCbm: number | null;
  /** 용적률 = 비례 CBM / 공칭 내용적. 자문 표시 전용 · 상한 없음. */
  utilization: number | null;
}

/**
 * 컨테이너별 파생 지표 — 저장 없음(표시 전용).
 *
 * · 모르는 라인 id 를 참조한 배분도 **포장수는 센다**(사용자가 선언한 수량이므로).
 *   다만 중량·CBM 몫은 만들 수 없으므로 불완전으로 표시한다.
 * · CBM 이 불완전하면 용적률을 내지 않는다 — 반쪽 분자로 적재율을 단정하면
 *   "아직 여유 있음"이라는 틀린 안심을 준다.
 */
export function containerMetrics(
  containers: readonly ContainerLike[],
  lines: readonly AllocatableCargoLine[],
  allocations: readonly AllocationLike[],
): ContainerMetrics[] {
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const byRef = new Map<string, AllocationLike[]>();
  for (const a of allocations) {
    byRef.set(a.containerRef, [...(byRef.get(a.containerRef) ?? []), a]);
  }

  return containers.map((c) => {
    const mine = byRef.get(c.ref) ?? [];
    let packages = 0;
    let gw = 0;
    let cbm = 0;
    let gwIncomplete = false;
    let cbmIncomplete = false;

    for (const a of mine) {
      packages = round6(packages + a.allocatedPackageCount);
      const line = lineById.get(a.shipmentLineId) ?? null;
      const whole = line?.packageCount ?? null;
      const gwShare = prorateShare(line?.grossWeightKg ?? null, a.allocatedPackageCount, whole);
      const cbmShare = prorateShare(line?.cbm ?? null, a.allocatedPackageCount, whole);
      if (gwShare === null) gwIncomplete = true;
      else gw = round6(gw + gwShare);
      if (cbmShare === null) cbmIncomplete = true;
      else cbm = round6(cbm + cbmShare);
    }

    const nominalCbm = nominalCbmOf(c.containerType);
    return {
      ref: c.ref,
      allocationCount: mine.length,
      packages,
      grossWeightKg: gw,
      gwIncomplete,
      cbm,
      cbmIncomplete,
      nominalCbm,
      utilization: cbmIncomplete ? null : utilizationRatio(cbm, nominalCbm),
    };
  });
}

/** 용적률 = 적재 CBM / 공칭 내용적 — 공칭을 모르면 null. 상한 없음(100% 초과도 그대로). */
export function utilizationOf(
  cbm: number,
  containerType: string | null | undefined,
): number | null {
  return utilizationRatio(cbm, nominalCbmOf(containerType));
}

function utilizationRatio(cbm: number, nominal: number | null): number | null {
  // Number.isFinite 이중 방어 — 분모가 숫자가 아니면 NaN% 를 화면에 내보내지 않는다.
  if (nominal === null || !Number.isFinite(nominal) || nominal <= 0) return null;
  return quotRound6(cbm, nominal);
}

/* ---------- ⑤ 표시 규칙 — 인쇄·화면이 같은 어휘를 쓰도록 (P5.3 판정 P4) ---------- */

/** 번호 미확정 컨테이너의 표기. 이 문자열은 여기 한 곳에만 산다. */
const CONTAINER_NO_TBA = "TBA";

/**
 * 컨테이너 번호 표시값 — 미확정이면 `TBA`.
 *
 * · 판별은 null/undefined 와 `trim() === ''` 다. **표시층 전용 방어**이며
 *   DB·`save_shipment_containers` 는 건드리지 않는다(PG `btrim` 은 스페이스만
 *   지우므로 탭·개행·전각공백만 담긴 번호가 이론상 저장될 수 있다).
 * · 번호가 있으면 **원문 그대로** 낸다 — 대문자 강제·정규화 금지(P5.2 입력 기록
 *   원칙), 인쇄물은 스냅샷 원문만 출력한다(재인쇄 불변 계약).
 * · '배분 미실시'는 이 규칙의 대상이 아니다 — 그건 수치 셀의 `-` 로 남는다.
 */
export function displayContainerNo(v: string | null | undefined): string {
  return v == null || v.trim() === "" ? CONTAINER_NO_TBA : v;
}
