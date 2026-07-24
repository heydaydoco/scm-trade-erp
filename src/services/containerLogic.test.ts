import { describe, it, expect } from "vitest";
import {
  sumAllocatedByContainer,
  sumAllocatedByLine,
  lineAllocationStatus,
  prorateShare,
  containerMetrics,
  utilizationOf,
  displayContainerNo,
} from "./containerLogic";
import { CONTAINER_NOMINAL_CBM, nominalCbmOf } from "@/lib/containerSpecs";

/**
 * P5.2 적입(E5) — 순수 로직 정합성 테스트 (SPEC §8: "코드 전에 작성").
 *
 * 아키텍트 확정 스펙이 못박은 것들:
 *  ④ 적입 지표는 **전부 파생 계산·표시 전용** — 저장 컬럼 없음. VGM(입력)과
 *    G.W. 합(파생)은 별개이며 상호검증하지 않는다(여기 어디에도 그 비교가 없다).
 *  · 과배분(라인 포장수 초과)은 서버 무차단 → 여기서 **판정만** 하고 UI 가 경고한다.
 *  · 공칭 내용적은 **자문 표시 전용**, type 정확일치일 때만.
 *
 * P5.3 판정 ① 로 반올림 규약이 개정됐다:
 *  · **몫**(비례 몫·용적률)은 참값 기준 half away from zero · 소수 6자리를
 *    **정확 십진 산술**로 구현한다(P4.5 mulRound2/allocRound2 계보의 6자리판).
 *    double 경유 round6 은 tie 케이스에서 SQL round(numeric,6) 과 어긋난다.
 *  · **합**(누적)은 현행 round6 유지 — 근거는 아래 ⑥-3 픽스처가 성문화한다.
 */

const LINES = [
  { id: "L1", packageCount: 10, grossWeightKg: 100, cbm: 5 },
  { id: "L2", packageCount: 4, grossWeightKg: 40, cbm: null },
  { id: "L3", packageCount: null, grossWeightKg: 30, cbm: 3 },
];

/* ---------- ① 배분 합계 — 컨테이너별 / 라인별 ---------- */

describe("sumAllocatedByContainer — 컨테이너별 배분 포장수 합", () => {
  it("★같은 컨테이너의 여러 라인 배분을 합산한다", () => {
    const m = sumAllocatedByContainer([
      { containerRef: "c1", shipmentLineId: "L1", allocatedPackageCount: 6 },
      { containerRef: "c1", shipmentLineId: "L2", allocatedPackageCount: 2 },
      { containerRef: "c2", shipmentLineId: "L1", allocatedPackageCount: 4 },
    ]);
    expect(m.get("c1")).toBe(8);
    expect(m.get("c2")).toBe(4);
  });

  it("배분이 없으면 빈 맵", () => {
    expect(sumAllocatedByContainer([]).size).toBe(0);
  });
});

describe("sumAllocatedByLine — 라인별 배분 포장수 합(컨테이너 가로지름)", () => {
  it("★한 라인이 여러 컨테이너에 나뉘어도 합산된다", () => {
    const m = sumAllocatedByLine([
      { containerRef: "c1", shipmentLineId: "L1", allocatedPackageCount: 6 },
      { containerRef: "c2", shipmentLineId: "L1", allocatedPackageCount: 4 },
      { containerRef: "c2", shipmentLineId: "L2", allocatedPackageCount: 1 },
    ]);
    expect(m.get("L1")).toBe(10);
    expect(m.get("L2")).toBe(1);
  });
});

/* ---------- ② 라인 배분 현황 — 잔여·과배분(경고용 판정, 차단 아님) ---------- */

describe("lineAllocationStatus — 라인 포장수 대비 배분 잔여·과배분", () => {
  it("★잔여 = 포장수 − 배분합", () => {
    const st = lineAllocationStatus(LINES, [
      { containerRef: "c1", shipmentLineId: "L1", allocatedPackageCount: 6 },
    ]);
    const l1 = st.find((s) => s.lineId === "L1")!;
    expect(l1.allocated).toBe(6);
    expect(l1.remaining).toBe(4);
    expect(l1.over).toBe(false);
  });

  it("★과배분은 판정만 한다(서버가 막지 않는다 — UI 경고용)", () => {
    const st = lineAllocationStatus(LINES, [
      { containerRef: "c1", shipmentLineId: "L2", allocatedPackageCount: 5 },
    ]);
    const l2 = st.find((s) => s.lineId === "L2")!;
    expect(l2.over).toBe(true);
    expect(l2.remaining).toBe(-1);
  });

  it("★포장수 null 라인은 잔여 판단 불가(null) — 배분 자체는 허용된 스펙", () => {
    const st = lineAllocationStatus(LINES, [
      { containerRef: "c1", shipmentLineId: "L3", allocatedPackageCount: 2 },
    ]);
    const l3 = st.find((s) => s.lineId === "L3")!;
    expect(l3.packageCount).toBeNull();
    expect(l3.allocated).toBe(2);
    expect(l3.remaining).toBeNull();
    expect(l3.over).toBe(false); // 판단 불가를 '초과'로 단정하지 않는다
  });

  it("★여러 컨테이너에 나눠 담은 합이 포장수를 넘으면 과배분 — 컨테이너별 판정이 아니다", () => {
    // 컨테이너 하나만 보면 6·6 둘 다 포장수 10 이하다. 합산해야만 초과가 드러난다.
    const st = lineAllocationStatus(LINES, [
      { containerRef: "c1", shipmentLineId: "L1", allocatedPackageCount: 6 },
      { containerRef: "c2", shipmentLineId: "L1", allocatedPackageCount: 6 },
    ]);
    const l1 = st.find((s) => s.lineId === "L1")!;
    expect(l1.allocated).toBe(12);
    expect(l1.remaining).toBe(-2);
    expect(l1.over).toBe(true);
  });

  it("배분이 없는 라인도 전량 잔여로 나온다(라인 순서 보존)", () => {
    const st = lineAllocationStatus(LINES, []);
    expect(st.map((s) => s.lineId)).toEqual(["L1", "L2", "L3"]);
    expect(st[0].allocated).toBe(0);
    expect(st[0].remaining).toBe(10);
  });
});

/* ---------- ③ 비례 몫 — 포장수 비율로만 나눈다(측정값 발명 금지) ---------- */

describe("prorateShare — 배분 포장수 비율의 비례 몫", () => {
  it("★기본 비례: 100kg 짜리 라인의 10개 중 6개 → 60kg", () => {
    expect(prorateShare(100, 6, 10)).toBe(60);
  });

  it("원값이 없으면 산출 불가(null) — 0 으로 단정하지 않는다", () => {
    expect(prorateShare(null, 6, 10)).toBeNull();
  });

  it("★라인 포장수가 없거나 0 이면 비율을 만들 수 없다(null)", () => {
    expect(prorateShare(100, 6, null)).toBeNull();
    expect(prorateShare(100, 6, 0)).toBeNull();
  });

  it("반올림은 소수 6자리 — 비종결 소수는 참값 기준으로 자른다", () => {
    expect(prorateShare(10, 1, 3)).toBe(3.333333);
  });

  it("0kg 은 유효한 값이다(미기재와 다르다)", () => {
    expect(prorateShare(0, 6, 10)).toBe(0);
  });
});

/* ---------- ④ 컨테이너 파생 지표 — 저장 없음(표시 전용) ---------- */

const CONTAINERS = [
  { ref: "c1", containerType: "20GP" },
  { ref: "c2", containerType: "일반 컨테이너" },
];

describe("containerMetrics — 배분 포장수 합·비례 G.W./CBM·용적률(전부 파생)", () => {
  it("★포장수 합과 비례 중량·부피", () => {
    const [c1] = containerMetrics(CONTAINERS, LINES, [
      { containerRef: "c1", shipmentLineId: "L1", allocatedPackageCount: 6 },
    ]);
    expect(c1.allocationCount).toBe(1);
    expect(c1.packages).toBe(6);
    expect(c1.grossWeightKg).toBe(60); // 100 × 6/10
    expect(c1.cbm).toBe(3); // 5 × 6/10
    expect(c1.gwIncomplete).toBe(false);
    expect(c1.cbmIncomplete).toBe(false);
  });

  it("★결측은 중량·부피를 따로 표시한다 — CBM 없는 라인은 CBM 만 불완전", () => {
    const [c1] = containerMetrics(CONTAINERS, LINES, [
      { containerRef: "c1", shipmentLineId: "L1", allocatedPackageCount: 5 },
      { containerRef: "c1", shipmentLineId: "L2", allocatedPackageCount: 2 },
    ]);
    expect(c1.packages).toBe(7);
    expect(c1.grossWeightKg).toBe(70); // 50 + 20
    expect(c1.gwIncomplete).toBe(false);
    expect(c1.cbm).toBe(2.5); // L2 는 CBM 미기재라 몫이 없다
    expect(c1.cbmIncomplete).toBe(true);
  });

  it("★포장수 없는 라인의 배분은 비율을 못 만든다 — 둘 다 불완전", () => {
    const [c1] = containerMetrics(CONTAINERS, LINES, [
      { containerRef: "c1", shipmentLineId: "L3", allocatedPackageCount: 2 },
    ]);
    expect(c1.packages).toBe(2);
    expect(c1.grossWeightKg).toBe(0);
    expect(c1.gwIncomplete).toBe(true);
    expect(c1.cbmIncomplete).toBe(true);
  });

  it("모르는 라인 id 를 참조한 배분도 포장수는 세되 몫은 불완전으로 표시", () => {
    const [c1] = containerMetrics(CONTAINERS, LINES, [
      { containerRef: "c1", shipmentLineId: "ghost", allocatedPackageCount: 3 },
    ]);
    expect(c1.packages).toBe(3);
    expect(c1.gwIncomplete).toBe(true);
    expect(c1.cbmIncomplete).toBe(true);
  });

  it("배분이 0건인 컨테이너도 행이 나온다(빈 컨테이너는 정상)", () => {
    const metrics = containerMetrics(CONTAINERS, LINES, []);
    expect(metrics.map((m) => m.ref)).toEqual(["c1", "c2"]);
    expect(metrics[1].packages).toBe(0);
    expect(metrics[1].gwIncomplete).toBe(false); // 배분이 없으면 결측도 없다
  });

  it("★용적률은 공칭 내용적이 정확일치할 때만 — 자유입력 타입은 null", () => {
    const metrics = containerMetrics(CONTAINERS, LINES, [
      { containerRef: "c1", shipmentLineId: "L1", allocatedPackageCount: 10 },
      { containerRef: "c2", shipmentLineId: "L1", allocatedPackageCount: 10 },
    ]);
    expect(metrics[0].nominalCbm).toBe(33.2);
    // 5 / 33.2 = 0.150602409… → 6자리 0.150602 (기대값 불변. P5.3 판정 ① 로
    // 산출 기반이 정확 십진이 됐으므로 float 헬퍼 대신 리터럴로 고정한다.)
    expect(metrics[0].utilization).toBe(0.150602);
    expect(metrics[1].nominalCbm).toBeNull();
    expect(metrics[1].utilization).toBeNull();
  });

  it("CBM 이 불완전하면 용적률도 내지 않는다(반쪽 분모로 단정 금지)", () => {
    const [c1] = containerMetrics(CONTAINERS, LINES, [
      { containerRef: "c1", shipmentLineId: "L2", allocatedPackageCount: 4 },
    ]);
    expect(c1.nominalCbm).toBe(33.2);
    expect(c1.cbmIncomplete).toBe(true);
    expect(c1.utilization).toBeNull();
  });
});

/* ---------- ⑤ 공칭 내용적 — 자문 표시 전용(저장 금지) ---------- */

describe("nominalCbmOf — 공칭 내용적(type 정확일치만)", () => {
  it("★4종 표준 타입", () => {
    expect(nominalCbmOf("20GP")).toBe(33.2);
    expect(nominalCbmOf("40GP")).toBe(67.7);
    expect(nominalCbmOf("40HC")).toBe(76.4);
    expect(nominalCbmOf("45HC")).toBe(86.0);
  });

  it("★대소문자 변형·유사 표기는 매칭하지 않는다(정확일치)", () => {
    expect(nominalCbmOf("20gp")).toBeNull();
    expect(nominalCbmOf("20'GP")).toBeNull();
    expect(nominalCbmOf("20GP DV")).toBeNull();
  });

  it("냉동·LCL 등 사전에 없는 타입·빈값은 null", () => {
    expect(nominalCbmOf("20RF")).toBeNull();
    expect(nominalCbmOf("LCL")).toBeNull();
    expect(nominalCbmOf(null)).toBeNull();
    expect(nominalCbmOf("")).toBeNull();
  });

  it("앞뒤 공백은 저장 정규화(btrim)와 같은 처리 — 그 외 변형은 없다", () => {
    expect(nominalCbmOf("  40HC  ")).toBe(76.4);
  });

  it("★타입은 자유 입력이다 — Object.prototype 상속 키를 사전 항목으로 오인하지 않는다", () => {
    expect(nominalCbmOf("constructor")).toBeNull();
    expect(nominalCbmOf("toString")).toBeNull();
    expect(nominalCbmOf("valueOf")).toBeNull();
    expect(nominalCbmOf("hasOwnProperty")).toBeNull();
    expect(nominalCbmOf("__proto__")).toBeNull();
    // 그 함수가 분모로 새면 용적률이 NaN 이 된다 — 여기서 막혀야 한다.
    expect(utilizationOf(10, "constructor")).toBeNull();
  });

  it("사전은 4종뿐 — 임의 확장 금지(스펙 확정값)", () => {
    expect(Object.keys(CONTAINER_NOMINAL_CBM).sort()).toEqual([
      "20GP",
      "40GP",
      "40HC",
      "45HC",
    ]);
  });
});

describe("utilizationOf — 용적률(자문)", () => {
  it("★적재 CBM / 공칭 내용적", () => {
    expect(utilizationOf(16.6, "20GP")).toBe(0.5);
  });

  it("공칭을 모르면 비율도 없다", () => {
    expect(utilizationOf(16.6, "일반")).toBeNull();
    expect(utilizationOf(16.6, null)).toBeNull();
  });

  it("100% 초과도 그대로 낸다 — 차단·상한 없음(적입 실측 기록)", () => {
    expect(utilizationOf(66.4, "20GP")).toBe(2);
  });
});

/* ==========================================================================
 * ⑥ P5.3 판정 ① — 몫의 참값 반올림(정확 십진) · 합 경로 근거
 * ========================================================================== */

/* ---------- ⑥-1 회귀 픽스처 — double 경유 round6 이 틀렸던 tie 4건 ----------
 *
 * ⚠️ 이 4건은 P5.3 착수 전 실측 스캔(업무 도메인 40만 건)에서 뽑힌 실제 반례다.
 *    `Math.round(v*p/w * 1e6)/1e6` 은 double 곱셈이 참값을 tie 바로 아래로
 *    떨어뜨려 **내림**하고, PG `round(numeric,6)` 은 참값 tie 를 **올림**한다.
 *    아래 기대값은 전부 **PG 쪽(참값 half away from zero)** 이다 — 무단 수정 금지.
 */
describe("prorateShare — 참값 tie 는 올림(SQL round(numeric,6) 동치)", () => {
  it("★83.357 × 20 / 64 = 26.0490625 → 26.049063 (double 경유는 …062 로 내렸다)", () => {
    expect(prorateShare(83.357, 20, 64)).toBe(26.049063);
  });

  it("★88.450588 × 25 / 40 = 55.2816175 → 55.281618", () => {
    expect(prorateShare(88.450588, 25, 40)).toBe(55.281618);
  });

  it("★2355.499 × 75 / 240 = 736.0934375 → 736.093438", () => {
    expect(prorateShare(2355.499, 75, 240)).toBe(736.093438);
  });

  it("★16.487 × 49 / 560 = 1.4426125 → 1.442613", () => {
    expect(prorateShare(16.487, 49, 560)).toBe(1.442613);
  });

  it("tie 가 아닌 값은 기존과 동일하다(교정이 평범한 값을 흔들지 않는다)", () => {
    expect(prorateShare(100, 6, 10)).toBe(60);
    expect(prorateShare(40, 2, 4)).toBe(20);
    expect(prorateShare(5, 6, 10)).toBe(3);
  });
});

describe("utilizationOf — 용적률도 몫이라 같은 참값 반올림을 쓴다", () => {
  it("★5 / 33.2 = 0.150602409… → 0.150602", () => {
    expect(utilizationOf(5, "20GP")).toBe(0.150602);
  });
});

/* ---------- ⑥-2 TBA 표기 규칙 (P5.3 판정 P4) ----------
 *
 * · 판별 = null / undefined / trim() === ''  (공백만 번호 방어는 **표시층 전용** —
 *   DB·save_shipment_containers 는 무접촉이다)
 * · 표기는 "TBA" 대문자 3자 고정. 상수는 이 규칙 함수 한 곳에만 산다.
 * · 번호가 있으면 **원문 그대로** 낸다(입력 기록 원칙 + 인쇄물 원문 계약).
 */
describe("displayContainerNo — 번호 미확정은 TBA", () => {
  it("★null 은 TBA", () => {
    expect(displayContainerNo(null)).toBe("TBA");
  });

  it("★undefined 도 TBA(키 결손 스냅샷 방어)", () => {
    expect(displayContainerNo(undefined)).toBe("TBA");
  });

  it("★빈 문자열은 TBA", () => {
    expect(displayContainerNo("")).toBe("TBA");
  });

  it("★공백만 있는 번호도 TBA — PG btrim 은 스페이스만 지운다(탭·개행 방어)", () => {
    expect(displayContainerNo("   ")).toBe("TBA");
    expect(displayContainerNo("\t")).toBe("TBA");
    expect(displayContainerNo("\n")).toBe("TBA");
    expect(displayContainerNo("　")).toBe("TBA"); // 전각 공백
  });

  it("★번호가 있으면 원문 그대로 — 대문자 강제·정규화 금지(P5.2 입력 기록 원칙)", () => {
    expect(displayContainerNo("ABCD1234567")).toBe("ABCD1234567");
    expect(displayContainerNo("abcd1234567")).toBe("abcd1234567");
    expect(displayContainerNo(" ABCD1234567 ")).toBe(" ABCD1234567 ");
  });
});

/* ---------- ⑥-3 합 경로는 현행 round6 유지 — 근거 성문화 ----------
 *
 * 몫만 정확 십진으로 바꾸고 합은 그대로 두는 근거는 두 가지다.
 *  (a) 피가산 항이 전부 6자리 십진 정밀값이므로 **참합도 6자리** — 7자리
 *      반올림 경계(tie)가 구조적으로 생기지 않는다. 반올림이 항등이 된다.
 *  (b) 업무 도메인 규모에서 double 누적 오차는 반올림 임계(5e-7)에 못 미친다.
 */
describe("합 경로(누적 round6) — tie 가 생기지 않음을 픽스처로 고정", () => {
  it("★6자리 정밀 항들의 참합은 6자리다 — 7자리 경계에 놓일 수 없다", () => {
    const shares = [3.333333, 3.333333, 3.333334]; // 전부 round6 된 몫
    const sum = shares.reduce((s, v) => s + v, 0);
    expect(Math.round(sum * 1e6)).toBe(10000000); // 참합 10.000000 — tie 아님
  });

  it("★1000 항 누적의 double 오차 < 5e-7(반올림 임계)", () => {
    const shares = Array.from({ length: 1000 }, () => 0.000001);
    const sum = shares.reduce((s, v) => s + v, 0);
    expect(Math.abs(sum - 0.001)).toBeLessThan(5e-7);
  });

  it("★컨테이너 누적도 몫 교정 이후 값으로 쌓인다(26.049063 × 2)", () => {
    const [c] = containerMetrics(
      [{ ref: "c1", containerType: null }],
      [
        { id: "T1", packageCount: 64, grossWeightKg: 83.357, cbm: null },
        { id: "T2", packageCount: 64, grossWeightKg: 83.357, cbm: null },
      ],
      [
        { containerRef: "c1", shipmentLineId: "T1", allocatedPackageCount: 20 },
        { containerRef: "c1", shipmentLineId: "T2", allocatedPackageCount: 20 },
      ],
    );
    expect(c.grossWeightKg).toBe(52.098126);
  });
});

/* ==========================================================================
 * ⑦ P5.3 판정 P2 — 문서 스코프 산식 동치 픽스처 (STAGE 2 SQL 의 계약)
 * ==========================================================================
 *
 * ⚠️ **이 섹션은 save_trade_document 가 기록할 containers_snapshot 의 계약이다.**
 *    SQL 이 같은 입력에서 같은 수치를 내야 한다. 기대값 변경은 스펙 개정 사항.
 * ⚠️ **양방향 상호참조(적대검증 반영)**: 이 픽스처 수치를 바꾸면 발행 RPC 의
 *    스냅샷 산식(db/migrations 의 살아있는 save_trade_document 정의 —
 *    p5.3_doc_container_snapshot.sql 의 per_container CTE, 이후 개정판이 있으면
 *    그 파일)도 **함께** 고쳐야 한다. Vitest 는 SQL 을 실행하지 않으므로(Supabase
 *    대시보드 전용·PG 접속 금지) 이 회귀 가드는 TS 편측이다 — SQL 변경 시 수동 대조 필수.
 *
 * P2 스코프 규칙:
 *  · '이 문서에 포함된 라인'에 배분이 **1건 이상** 걸린 컨테이너만 담는다.
 *  · 각 컨테이너에는 **그 문서 라인의 배분만** 담는다(타 라인 배분은 탈락).
 *  · 배분 0건 컨테이너, 타 라인만 배분된 컨테이너는 **제외**.
 *    → 혼합 선적에서 타 고객 물량 정보가 상대 문서로 새는 경로를 원천 차단.
 *  · S/I(라이브)는 전량 표시로 현행 유지 — 스코프 필터는 문서 전용이다.
 */

/** 선적 전체 화물 라인 — L1·L2 는 고객A(문서 포함), L3 은 고객B(문서 제외). */
const MIXED_LINES = [
  { id: "L1", packageCount: 10, grossWeightKg: 100, cbm: 5 },
  { id: "L2", packageCount: 4, grossWeightKg: 40, cbm: null },
  { id: "L3", packageCount: null, grossWeightKg: 30, cbm: 3 },
];

/** 선적 전체 컨테이너(적입 카드가 저장한 정본) — created_at,id 순. */
const MIXED_CONTAINERS = [
  { ref: "c1", containerType: "20GP" },
  { ref: "c2", containerType: "40HC" },
  { ref: "c3", containerType: "20GP" }, // 타 고객 라인만 적입
  { ref: "c4", containerType: "20GP" }, // 배분 0건(빈 컨테이너)
  { ref: "c5", containerType: null }, // 양 고객 혼재
];

const MIXED_ALLOCS = [
  { containerRef: "c1", shipmentLineId: "L1", allocatedPackageCount: 6 },
  { containerRef: "c2", shipmentLineId: "L1", allocatedPackageCount: 4 },
  { containerRef: "c2", shipmentLineId: "L2", allocatedPackageCount: 2 },
  { containerRef: "c3", shipmentLineId: "L3", allocatedPackageCount: 3 },
  { containerRef: "c5", shipmentLineId: "L2", allocatedPackageCount: 1 },
  { containerRef: "c5", shipmentLineId: "L3", allocatedPackageCount: 2 },
];

/** 이 문서(고객A)에 포함된 라인 = trade_document_lines.shipment_line_id 집합. */
const DOC_LINE_IDS = new Set(["L1", "L2"]);

describe("문서 스코프 스냅샷 — containerMetrics(필터 입력) = SQL 기대값", () => {
  // P2 필터 — SQL 이 재현해야 하는 두 단계다.
  const scopedAllocs = MIXED_ALLOCS.filter((a) =>
    DOC_LINE_IDS.has(a.shipmentLineId),
  );
  const scopedRefs = new Set(scopedAllocs.map((a) => a.containerRef));
  const scopedContainers = MIXED_CONTAINERS.filter((c) => scopedRefs.has(c.ref));

  it("★타 고객 라인만 적입된 컨테이너(c3)와 빈 컨테이너(c4)는 스냅샷에서 빠진다", () => {
    expect(scopedContainers.map((c) => c.ref)).toEqual(["c1", "c2", "c5"]);
  });

  it("★혼재 컨테이너(c5)는 남되 타 고객 라인 배분(L3×2)은 탈락한다", () => {
    const c5 = scopedAllocs.filter((a) => a.containerRef === "c5");
    expect(c5).toEqual([
      { containerRef: "c5", shipmentLineId: "L2", allocatedPackageCount: 1 },
    ]);
  });

  it("★컨테이너별 동결 수치 — SQL 이 내야 할 값 그대로", () => {
    const m = containerMetrics(scopedContainers, MIXED_LINES, scopedAllocs);

    // c1: L1×6 → 100×6/10 = 60kg · 5×6/10 = 3m³
    expect(m[0]).toMatchObject({
      ref: "c1",
      packages: 6,
      grossWeightKg: 60,
      cbm: 3,
      gwIncomplete: false,
      cbmIncomplete: false,
    });

    // c2: L1×4 + L2×2 → 40+20 = 60kg · 2 + (L2 CBM 미기재) = 2m³ · CBM 불완전
    expect(m[1]).toMatchObject({
      ref: "c2",
      packages: 6,
      grossWeightKg: 60,
      cbm: 2,
      gwIncomplete: false,
      cbmIncomplete: true,
    });

    // c5: L2×1 만 → 40×1/4 = 10kg · L2 CBM 미기재 → 0m³ · CBM 불완전
    expect(m[2]).toMatchObject({
      ref: "c5",
      packages: 1,
      grossWeightKg: 10,
      cbm: 0,
      gwIncomplete: false,
      cbmIncomplete: true,
    });
  });

  it("★전체 총계 — 합은 round6 누적, 불완전 플래그는 OR", () => {
    const m = containerMetrics(scopedContainers, MIXED_LINES, scopedAllocs);
    const sum = (xs: number[]) =>
      Math.round(xs.reduce((s, v) => s + v, 0) * 1e6) / 1e6;

    expect(sum(m.map((x) => x.packages))).toBe(13);
    expect(sum(m.map((x) => x.grossWeightKg))).toBe(130);
    expect(sum(m.map((x) => x.cbm))).toBe(5);
    expect(m.some((x) => x.gwIncomplete)).toBe(false);
    expect(m.some((x) => x.cbmIncomplete)).toBe(true);
  });

  it("★스코프가 0건이면 빈 구조다 — 스칼라 폴백 대상이 아니다(판정 ②)", () => {
    const noneAllocs = MIXED_ALLOCS.filter((a) => a.shipmentLineId === "__none__");
    const noneRefs = new Set(noneAllocs.map((a) => a.containerRef));
    expect(MIXED_CONTAINERS.filter((c) => noneRefs.has(c.ref))).toEqual([]);
  });

  it("★tie 값도 문서 스코프 경로를 그대로 통과한다(몫 교정이 스냅샷까지 도달)", () => {
    const [c] = containerMetrics(
      [{ ref: "t1", containerType: null }],
      [{ id: "T1", packageCount: 64, grossWeightKg: 83.357, cbm: null }],
      [{ containerRef: "t1", shipmentLineId: "T1", allocatedPackageCount: 20 }],
    );
    expect(c.grossWeightKg).toBe(26.049063);
  });
});

/* ---------- ⑥-4 대량 동치 스캔 — 결정적 의사난수(시드 고정) ----------
 *
 * P5.3 착수 전 실측 스캔이 40만 건 중 273건 불일치를 냈다. 교정 후 **0건**이어야
 * 한다. 여기서는 같은 도메인을 결정적 LCG 로 2만 건 훑어 회귀를 막는다.
 * 참조값은 이 테스트가 BigInt 로 직접 계산한다 — 구현과 독립된 두 번째 산식이다.
 *
 * ⚠️ 이 참조는 구현과 **같은 가정**(PG numeric round = half away from zero·정확
 *    십진)을 공유한다 → double 경로 회귀(float 버그)의 오라클로는 강하지만
 *    **스펙 오라클은 아니다**(둘이 같은 잘못된 가정을 해도 통과). 스펙의 진짜 앵커는
 *    ⑥-1 의 손검증 tie 리터럴 4건이다(PG numeric round 가 실제 half-away 임을 확인).
 */
describe("prorateShare — 참값 반올림 대량 동치(회귀 방지)", () => {
  /** PG round(numeric,6) 의미론을 BigInt 로 직접 구현한 독립 참조. */
  function referenceProrate(v: number, p: number, w: number): number {
    const dec = (x: number): [bigint, number] => {
      const s = String(x);
      const i = s.indexOf(".");
      return i < 0 ? [BigInt(s), 0] : [BigInt(s.replace(".", "")), s.length - i - 1];
    };
    const [vi, vs] = dec(v);
    const [pi, ps] = dec(p);
    const [wi, ws] = dec(w);
    const num = vi * pi * BigInt(10) ** BigInt(ws) * BigInt(1000000);
    const den = wi * BigInt(10) ** BigInt(vs + ps);
    const q = num / den;
    const rem = num % den;
    return Number(rem * BigInt(2) >= den ? q + BigInt(1) : q) / 1e6;
  }

  it("★업무 도메인 2만 건에서 불일치 0건", () => {
    let seed = 20260724; // 시드 고정 — 테스트는 결정적이어야 한다
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const mismatches: string[] = [];
    for (let k = 0; k < 20000; k++) {
      const decimals = [1, 2, 3, 4, 5, 6, 7][k % 7];
      const value = Number((next() * (k % 2 ? 5000 : 100)).toFixed(decimals));
      const whole = 1 + Math.floor(next() * 1000);
      const part = 1 + Math.floor(next() * whole);
      const got = prorateShare(value, part, whole);
      const want = referenceProrate(value, part, whole);
      if (got !== want) mismatches.push(`${value}×${part}/${whole} ${got}≠${want}`);
    }
    expect(mismatches).toEqual([]);
  });
});
