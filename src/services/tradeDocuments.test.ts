import { describe, expect, it } from "vitest";
import { mapContainers } from "./tradeDocuments";

/**
 * P5.3 — `containers_snapshot` 매핑 계약 (판정 D12).
 *
 * ⚠️ 이 매퍼의 존재 이유는 **하위호환**이다. P5.3 이전에 발행된 문서에는 컬럼이
 *    아예 없거나(NULL) 구조가 없다. 새 인쇄 코드가 그런 문서를 열어도 터지지
 *    않아야 하고, "적입 없음"과 "P5.3 이전"이 구분돼야 한다(판정 ② 3상태).
 *
 *  · null/undefined  → null  (= P5.3 이전 발행. 헤더는 container_no 스칼라 폴백)
 *  · { containers: [] } → 빈 구조 (= 적입 스코프 0건. 폴백 금지·섹션 생략)
 *  · 키 결손·타입 이상 → **던지지 않고** 안전한 기본값으로 접는다
 *    (인쇄물이 데이터 이상으로 500 을 내면 안 된다 — 서류는 나와야 한다)
 *
 * ⚠️ PostgREST 는 numeric 을 문자열로 줄 수 있다(mapPackages 계보) — 숫자 변환 포함.
 */

describe("mapContainers — P5.3 이전 발행(NULL)과 적입 0건을 구분한다", () => {
  it("★null 은 null — '스냅샷 이전'이지 '적입 없음'이 아니다", () => {
    expect(mapContainers(null)).toBeNull();
  });

  it("★undefined(컬럼 미선택·키 부재)도 null", () => {
    expect(mapContainers(undefined)).toBeNull();
  });

  it("★빈 구조는 null 이 아니다 — containers 빈 배열로 살아난다", () => {
    const r = mapContainers({ containers: [], totals: null });
    expect(r).not.toBeNull();
    expect(r!.containers).toEqual([]);
  });
});

describe("mapContainers — 정상 스냅샷 매핑", () => {
  const RAW = {
    containers: [
      {
        containerNo: "MSKU1234567",
        containerType: "20GP",
        sealNo: "SL-001",
        // vgmKg 키가 구 스냅샷에 남아 있어도 매퍼가 조용히 버려야 한다(P5.3 §4).
        vgmKg: "12345.5",
        allocations: [
          { shipmentLineId: "L1", allocatedPackageCount: 6 },
          { shipmentLineId: "L2", allocatedPackageCount: "2" },
        ],
        packageCount: 8,
        grossWeightKg: "60",
        gwIncomplete: false,
        cbmIncomplete: true,
        cbm: 3,
      },
    ],
    totals: {
      packageCount: 8,
      grossWeightKg: 60,
      cbm: "3",
      gwIncomplete: false,
      cbmIncomplete: true,
    },
  };

  it("★실측 3필드 + 동결 수치 + 배분을 그대로 옮긴다 (VGM 은 버린다 — §4)", () => {
    const r = mapContainers(RAW)!;
    expect(r.containers).toHaveLength(1);
    // 개정 2호: 기대 객체에서 vgmKg 제거 — 매퍼가 구 스냅샷의 vgmKg 키를 버린다.
    expect(r.containers[0]).toEqual({
      containerNo: "MSKU1234567",
      containerType: "20GP",
      sealNo: "SL-001",
      allocations: [
        { shipmentLineId: "L1", allocatedPackageCount: 6 },
        { shipmentLineId: "L2", allocatedPackageCount: 2 },
      ],
      packageCount: 8,
      grossWeightKg: 60,
      cbm: 3,
      gwIncomplete: false,
      cbmIncomplete: true,
    });
    expect(r.containers[0]).not.toHaveProperty("vgmKg");
  });

  it("★totals 도 같은 규약으로(숫자 문자열 → number)", () => {
    const r = mapContainers(RAW)!;
    expect(r.totals).toEqual({
      packageCount: 8,
      grossWeightKg: 60,
      cbm: 3,
      gwIncomplete: false,
      cbmIncomplete: true,
    });
  });
});

describe("mapContainers — 안전 생략 계약(던지지 않는다)", () => {
  it("★비객체(배열·문자열·숫자)는 null 로 접는다", () => {
    expect(mapContainers([])).toBeNull();
    expect(mapContainers("x")).toBeNull();
    expect(mapContainers(7)).toBeNull();
  });

  it("★containers 가 배열이 아니면 빈 배열", () => {
    expect(mapContainers({ containers: "nope" })!.containers).toEqual([]);
    expect(mapContainers({})!.containers).toEqual([]);
  });

  it("★totals 가 없거나 객체가 아니면 null — 인쇄가 총계행을 생략한다", () => {
    expect(mapContainers({ containers: [] })!.totals).toBeNull();
    expect(mapContainers({ containers: [], totals: "x" })!.totals).toBeNull();
  });

  it("★컨테이너 키가 전부 결손이어도 행은 살아난다(전 필드 null·배분 빈 배열)", () => {
    const r = mapContainers({ containers: [{}] })!;
    // 개정 2호: vgmKg 없음 — 매퍼가 이 키를 산출하지 않는다.
    expect(r.containers[0]).toEqual({
      containerNo: null,
      containerType: null,
      sealNo: null,
      allocations: [],
      packageCount: null,
      grossWeightKg: null,
      cbm: null,
      gwIncomplete: false,
      cbmIncomplete: false,
    });
  });

  it("★컨테이너 원소가 객체가 아니면 그 원소만 버린다", () => {
    const r = mapContainers({ containers: [null, "x", { containerNo: "A" }] })!;
    expect(r.containers).toHaveLength(1);
    expect(r.containers[0].containerNo).toBe("A");
  });

  it("★배분이 배열이 아니거나 원소가 이상하면 그만큼만 버린다", () => {
    expect(mapContainers({ containers: [{ allocations: "x" }] })!.containers[0]
      .allocations).toEqual([]);
    const r = mapContainers({
      containers: [{ allocations: [null, { shipmentLineId: "L1" }] }],
    })!;
    expect(r.containers[0].allocations).toEqual([
      { shipmentLineId: "L1", allocatedPackageCount: null },
    ]);
  });

  it("★숫자로 해석 불가한 값은 null 로 — NaN 을 인쇄에 흘리지 않는다", () => {
    const r = mapContainers({
      containers: [{ grossWeightKg: "열두톤", packageCount: {}, cbm: "3.5" }],
    })!;
    expect(r.containers[0].grossWeightKg).toBeNull();
    expect(r.containers[0].packageCount).toBeNull();
    expect(r.containers[0].cbm).toBe(3.5);
  });

  it("★불완전 플래그는 진짜 true 일 때만 true(truthy 문자열에 속지 않는다)", () => {
    const r = mapContainers({
      containers: [{ gwIncomplete: "false", cbmIncomplete: true }],
    })!;
    expect(r.containers[0].gwIncomplete).toBe(false);
    expect(r.containers[0].cbmIncomplete).toBe(true);
  });
});
