import { describe, it, expect } from "vitest";
import {
  sumAllocatedByContainer,
  sumAllocatedByLine,
  lineAllocationStatus,
  prorateShare,
  containerMetrics,
  utilizationOf,
} from "./containerLogic";
import { CONTAINER_NOMINAL_CBM, nominalCbmOf } from "@/lib/containerSpecs";

/**
 * P5.2 적입(E5) — 순수 로직 정합성 테스트 (SPEC §8: "코드 전에 작성").
 *
 * 아키텍트 확정 스펙이 못박은 것들:
 *  ④ 적입 지표는 **전부 파생 계산·표시 전용** — 저장 컬럼 없음. VGM(입력)과
 *    G.W. 합(파생)은 별개이며 상호검증하지 않는다(여기 어디에도 그 비교가 없다).
 *  · 과배분(라인 포장수 초과)은 서버 무차단 → 여기서 **판정만** 하고 UI 가 경고한다.
 *  · 반올림은 cargoLogic 의 S/I 총계 규약(round6) 재사용 — 새 반올림 발명 금지.
 *  · 공칭 내용적은 **자문 표시 전용**, type 정확일치일 때만.
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

  it("반올림은 round6 규약(cargoLogic S/I 총계와 동일)", () => {
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
    expect(metrics[0].utilization).toBe(round6of(5 / 33.2));
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

function round6of(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

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
