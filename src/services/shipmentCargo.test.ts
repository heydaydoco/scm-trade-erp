import { describe, it, expect } from "vitest";
import {
  planCargoLineDiff,
  defaultShipmentParties,
  qtyTotalsByUom,
  packageTotalsByType,
  sumFinite,
  openQtyOf,
  prefillQty,
  isOverShipment,
  shippedQtyOf,
  resolveUom,
  resolveDocLineUom,
  uomConflict,
  type ShipmentQtyLike,
} from "./shipmentCargo";

/**
 * P4.4 선적 화물 — 순수 로직 정합성 테스트 (SPEC §8: "코드 전에 작성").
 *
 * 아키텍트 스펙 항목 10 이 못박은 다섯 가지:
 *   diff-upsert 계획 / parties direction 프리필 / 선적잔량·초과(docFlow 재사용) /
 *   단위 TOTAL 분리(P4.3e 교훈) / uom 체인 재사용(P4.3f 규칙 그대로, 새 규칙 발명 금지).
 */

/* ---------- ① diff-upsert 계획 — RPC 의 diff 의미론 미러 ---------- */

describe("planCargoLineDiff — 들어온 id 는 UPDATE·무id 는 INSERT·빠진 기존행만 DELETE", () => {
  it("★기본 diff: 유지 1·신규 1·삭제 1", () => {
    const plan = planCargoLineDiff(["a", "b"], [{ id: "a" }, { id: null }]);
    expect(plan.updates).toEqual(["a"]);
    expect(plan.inserts).toBe(1);
    expect(plan.deletes).toEqual(["b"]);
    expect(plan.unknown).toEqual([]);
  });

  it("빈 payload = 전부 삭제 의사", () => {
    const plan = planCargoLineDiff(["a", "b"], []);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toBe(0);
    expect(plan.deletes).toEqual(["a", "b"]);
  });

  it("기존이 없으면 전부 INSERT", () => {
    const plan = planCargoLineDiff([], [{ id: null }, { id: null }]);
    expect(plan.inserts).toBe(2);
    expect(plan.deletes).toEqual([]);
  });

  it("★모르는 id 는 unknown 으로 표면화 (RPC 가 '이 선적의 화물 라인이 아닙니다'로 거부할 것)", () => {
    const plan = planCargoLineDiff(["a"], [{ id: "ghost" }]);
    expect(plan.unknown).toEqual(["ghost"]);
    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual(["a"]);
  });

  it("payload 내 같은 id 중복은 한 번으로 센다", () => {
    const plan = planCargoLineDiff(["a"], [{ id: "a" }, { id: "a" }]);
    expect(plan.updates).toEqual(["a"]);
    expect(plan.deletes).toEqual([]);
  });
});

/* ---------- ② parties direction 프리필 (스냅샷 초기값 — 전 필드 수정 가능) ---------- */

const seller = {
  name: "Your Company Co., Ltd.",
  addressLines: ["1F, 2 Teheran-ro", "Gangnam-gu, Seoul, Korea"],
  tel: "+82-2-0000-0000",
  email: "trade@example.com",
  bizRegNo: "000-00-00000", // D7: SellerLike 계약에 추가
};
const partner = {
  id: "P1",
  name: "Acme Trading",
  address: "10 High St",
  city: "London",
  country: "UK",
  contactName: "Jane",
  contactEmail: "jane@acme.example",
  contactPhone: null as string | null,
};

describe("defaultShipmentParties — export: shipper=자사·consignee=거래처 / import: 반전", () => {
  it("★export 프리필", () => {
    const p = defaultShipmentParties({ direction: "export", seller, partner });
    const shipper = p.find((x) => x.role === "shipper")!;
    const consignee = p.find((x) => x.role === "consignee")!;
    expect(shipper.name).toBe(seller.name);
    expect(shipper.companyId).toBeNull(); // 자사는 거래처 마스터가 아니다
    expect(shipper.address).toContain("Teheran-ro");
    expect(consignee.name).toBe("Acme Trading");
    expect(consignee.companyId).toBe("P1");
    expect(consignee.address).toContain("London");
    expect(consignee.contact).toContain("Jane");
  });

  it("★import 는 반전", () => {
    const p = defaultShipmentParties({ direction: "import", seller, partner });
    expect(p.find((x) => x.role === "shipper")!.name).toBe("Acme Trading");
    expect(p.find((x) => x.role === "consignee")!.name).toBe(seller.name);
  });

  it("★notify 기본값 = SAME AS CONSIGNEE", () => {
    const p = defaultShipmentParties({ direction: "export", seller, partner });
    expect(p.find((x) => x.role === "notify")!.name).toBe("SAME AS CONSIGNEE");
  });

  it("거래처 없는 선적(혼합·3자무역)은 상대편 이름이 비어 사용자 입력을 기다린다", () => {
    const p = defaultShipmentParties({ direction: "export", seller, partner: null });
    const consignee = p.find((x) => x.role === "consignee")!;
    expect(consignee.name).toBe("");
    expect(consignee.companyId).toBeNull();
  });

  it("direction 미지정(레거시 null)은 export 로 간주", () => {
    const p = defaultShipmentParties({ direction: null, seller, partner });
    expect(p.find((x) => x.role === "shipper")!.name).toBe(seller.name);
  });

  it("항상 shipper·consignee·notify 3건, 이 순서", () => {
    const p = defaultShipmentParties({ direction: "export", seller, partner });
    expect(p.map((x) => x.role)).toEqual(["shipper", "consignee", "notify"]);
  });
});

/* ---------- ③ 선적잔량·초과 — docFlow 재사용 (새 산식 발명 금지) ---------- */

const live = (qty: number): ShipmentQtyLike => ({ qty, cancelled: false });
const dead = (qty: number): ShipmentQtyLike => ({ qty, cancelled: true });

describe("선적잔량 = 주문라인 수량 − Σ(살아있는 선적 라인) — docFlow openQtyOf 재사용", () => {
  it("★주문 10 → 선적 4+6 → 잔량 0", () => {
    expect(openQtyOf(10, [live(4)])).toBe(6);
    expect(openQtyOf(10, [live(4), live(6)])).toBe(0);
  });

  it("★취소된 선적은 없던 일 → 잔량 복원", () => {
    expect(shippedQtyOf([live(4), dead(6)])).toBe(4);
    expect(openQtyOf(10, [live(4), dead(6)])).toBe(6);
  });

  it("초과 선적은 경고 판정(차단 아님 — 원칙 8)", () => {
    expect(isOverShipment(6, 7)).toBe(true);
    expect(isOverShipment(6, 6)).toBe(false);
  });

  it("프리필은 잔량, 음수(이미 초과)는 0", () => {
    expect(prefillQty(6)).toBe(6);
    expect(prefillQty(-2)).toBe(0);
  });
});

/* ---------- ④ 단위 TOTAL 분리 — P4.3e 교훈 그대로 (거짓 총수량 금지) ---------- */

describe("qtyTotalsByUom — 수량 총계는 단위별로 쪼갠다", () => {
  it("★100 M + 50 EA 는 150 이 아니라 [100 M, 50 EA]", () => {
    const t = qtyTotalsByUom([
      { qty: 100, uom: "M" },
      { qty: 50, uom: "EA" },
    ]);
    expect(t).toEqual([
      { uom: "M", qty: 100 },
      { uom: "EA", qty: 50 },
    ]);
  });

  it("같은 단위는 합산(부동소수 오차 없이)", () => {
    const t = qtyTotalsByUom([
      { qty: 0.1, uom: "KG" },
      { qty: 0.2, uom: "KG" },
    ]);
    expect(t).toEqual([{ uom: "KG", qty: 0.3 }]);
  });

  it("등장 순서를 보존한다(인쇄 표기 안정성)", () => {
    const t = qtyTotalsByUom([
      { qty: 1, uom: "SET" },
      { qty: 2, uom: "KG" },
      { qty: 3, uom: "SET" },
    ]);
    expect(t.map((x) => x.uom)).toEqual(["SET", "KG"]);
  });
});

describe("packageTotalsByType — 포장수 총계는 포장 유형별로 쪼갠다", () => {
  it("★10 CTN + 2 PLT 는 12 가 아니라 [10 CTN, 2 PLT]", () => {
    const t = packageTotalsByType([
      { packageCount: 10, packageType: "CTN" },
      { packageCount: 2, packageType: "PLT" },
    ]);
    expect(t).toEqual([
      { packageType: "CTN", count: 10 },
      { packageType: "PLT", count: 2 },
    ]);
  });

  it("유형 미지정은 '(미지정)' 버킷으로, 수량 없는 줄은 제외", () => {
    const t = packageTotalsByType([
      { packageCount: 3, packageType: null },
      { packageCount: null, packageType: "CTN" },
      { packageCount: 0, packageType: "CTN" },
    ]);
    expect(t).toEqual([{ packageType: "(미지정)", count: 3 }]);
  });
});

describe("sumFinite — 중량(kg)·CBM 은 고정 단위라 단일 합계", () => {
  it("null 은 건너뛰고 합산(부동소수 정리)", () => {
    expect(sumFinite([1.1, null, 2.2])).toBe(3.3);
  });

  it("전부 null 이면 0", () => {
    expect(sumFinite([null, null])).toBe(0);
  });
});

/* ---------- ⑤ uom 체인 재사용 — P4.3f 규칙 그대로 ---------- */

describe("uom 체인(P4.3f) 재사용 — 주문라인 uom → products.unit → 거부/양보", () => {
  it("라인 단위 있으면 라인 값 (자유텍스트 품목도 선적 가능 — item 소프트)", () => {
    expect(
      resolveDocLineUom(
        { unit: "EA", productId: null, productName: "자유품목" },
        new Map(),
        null,
      ),
    ).toBe("EA");
  });

  it("라인 비면 마스터 단위", () => {
    expect(
      resolveDocLineUom(
        { unit: null, productId: "P1", productName: "볼트" },
        new Map([["P1", "KG"]]),
        null,
      ),
    ).toBe("KG");
  });

  it("★둘 다 없으면 'PCS' 를 지어내지 않는다", () => {
    expect(resolveUom(null, null)).toBeNull();
    expect(
      resolveDocLineUom(
        { unit: null, productId: null, productName: "자유품목" },
        new Map(),
        null,
      ),
    ).toBeNull(); // → RPC 가 '단위를 알 수 없어 저장할 수 없습니다' 로 거부
  });

  it("★P4.4h 클라-서버 단위 불일치는 저장 거부 — 화물 RPC 도 서버 재해석으로 격상", () => {
    // P4.4 의 '공란만 거부'에서, 주문 라인 uom → products.unit 서버 재해석 +
    // 클라 uom 일치 검사로 격상됐다(불일치 = stale 폼 → 새로고침 안내).
    expect(uomConflict("KG", "EA")).toBe(true);
    expect(uomConflict(null, "EA")).toBe(false);
    expect(uomConflict("", "EA")).toBe(false);
  });
});
