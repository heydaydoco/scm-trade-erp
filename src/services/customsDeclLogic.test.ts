import { describe, expect, it } from "vitest";
import {
  canSaveStatusTransition,
  dateConsistencyError,
  directionMatchError,
  effectiveLoadingDeadline,
  exclusiveFieldError,
  includeAsLoadingDeadline,
  requiredFieldError,
  taxCurrencyError,
  validateCustomsDeclSave,
  type CustomsDeclFields,
} from "./customsDeclLogic";

/* ---------- effective 적재의무기한 = coalesce(연장, 수리일+30) ---------- */

describe("effectiveLoadingDeadline", () => {
  it("연장승인일이 있으면 그대로(수리일 무시)", () => {
    expect(effectiveLoadingDeadline("2026-07-16", "2026-09-01")).toBe("2026-09-01");
  });
  it("연장 없으면 수리일 + 30", () => {
    expect(effectiveLoadingDeadline("2026-07-16", null)).toBe("2026-08-15");
  });
  it("수리일·연장 둘 다 없으면 null", () => {
    expect(effectiveLoadingDeadline(null, null)).toBeNull();
  });
  it("연장만 있고 수리일 없어도 연장일을 쓴다", () => {
    expect(effectiveLoadingDeadline(null, "2026-09-01")).toBe("2026-09-01");
  });
});

/* ---------- 상태 전이 매트릭스 (RPC 미러) ---------- */

describe("canSaveStatusTransition", () => {
  it("신규(null): draft/filed/accepted 어느 것으로도 생성 가능", () => {
    expect(canSaveStatusTransition(null, "draft")).toBe(true);
    expect(canSaveStatusTransition(null, "filed")).toBe(true);
    expect(canSaveStatusTransition(null, "accepted")).toBe(true);
  });
  it("신규라도 cancelled 로는 생성 불가(취소는 별도 RPC)", () => {
    expect(canSaveStatusTransition(null, "cancelled")).toBe(false);
  });
  it("draft → draft|filed|accepted 허용", () => {
    expect(canSaveStatusTransition("draft", "draft")).toBe(true);
    expect(canSaveStatusTransition("draft", "filed")).toBe(true);
    expect(canSaveStatusTransition("draft", "accepted")).toBe(true);
  });
  it("filed → filed|accepted 허용", () => {
    expect(canSaveStatusTransition("filed", "filed")).toBe(true);
    expect(canSaveStatusTransition("filed", "accepted")).toBe(true);
  });
  it("역행 금지: filed → draft 거부", () => {
    expect(canSaveStatusTransition("filed", "draft")).toBe(false);
  });
  it("accepted 행은 어떤 상태로도 수정 거부", () => {
    expect(canSaveStatusTransition("accepted", "accepted")).toBe(false);
    expect(canSaveStatusTransition("accepted", "filed")).toBe(false);
    expect(canSaveStatusTransition("accepted", "draft")).toBe(false);
  });
  it("cancelled 행은 수정 거부", () => {
    expect(canSaveStatusTransition("cancelled", "draft")).toBe(false);
    expect(canSaveStatusTransition("cancelled", "filed")).toBe(false);
  });
});

/* ---------- 필수 필드 3단 ---------- */

describe("requiredFieldError", () => {
  it("draft 는 날짜·번호 필요 없음", () => {
    expect(
      requiredFieldError("draft", { filingDate: null, acceptanceDate: null, customsDeclNo: null }),
    ).toBeNull();
  });
  it("filed 는 신고일 필요", () => {
    expect(
      requiredFieldError("filed", { filingDate: null, acceptanceDate: null, customsDeclNo: null }),
    ).toContain("신고일");
    expect(
      requiredFieldError("filed", {
        filingDate: "2026-07-16",
        acceptanceDate: null,
        customsDeclNo: null,
      }),
    ).toBeNull();
  });
  it("accepted 는 신고일+수리일+세관번호 필요", () => {
    expect(
      requiredFieldError("accepted", {
        filingDate: "2026-07-16",
        acceptanceDate: null,
        customsDeclNo: "X",
      }),
    ).toContain("수리일");
    expect(
      requiredFieldError("accepted", {
        filingDate: "2026-07-16",
        acceptanceDate: "2026-07-17",
        customsDeclNo: null,
      }),
    ).toContain("세관 신고번호");
    expect(
      requiredFieldError("accepted", {
        filingDate: "2026-07-16",
        acceptanceDate: "2026-07-17",
        customsDeclNo: "  ",
      }),
    ).toContain("세관 신고번호");
    expect(
      requiredFieldError("accepted", {
        filingDate: "2026-07-16",
        acceptanceDate: "2026-07-17",
        customsDeclNo: "12345-67",
      }),
    ).toBeNull();
  });
});

/* ---------- 방향 일치 (일치·불일치·null 통과) ---------- */

describe("directionMatchError", () => {
  it("일치하면 통과", () => {
    expect(directionMatchError("export", "export")).toBeNull();
    expect(directionMatchError("import", "import")).toBeNull();
  });
  it("불일치하면 거부", () => {
    expect(directionMatchError("import", "export")).toContain("일치하지 않습니다");
    expect(directionMatchError("export", "import")).toContain("일치하지 않습니다");
  });
  it("선적 방향 null/공백이면 통과(라벨 성격)", () => {
    expect(directionMatchError(null, "export")).toBeNull();
    expect(directionMatchError("  ", "import")).toBeNull();
  });
});

/* ---------- 전용 필드 상호 거부 (2방향) ---------- */

const base = (over: Partial<CustomsDeclFields>): CustomsDeclFields => ({
  declType: "export",
  status: "draft",
  filingDate: null,
  acceptanceDate: null,
  customsDeclNo: null,
  taxableValue: null,
  dutyAmount: null,
  vatAmount: null,
  taxCurrency: null,
  loadingDeadlineExtended: null,
  ...over,
});

describe("exclusiveFieldError", () => {
  it("수출에 세액이 오면 거부", () => {
    expect(exclusiveFieldError(base({ declType: "export", taxableValue: 100 }))).toContain("수출신고");
  });
  it("수출에 세액 통화만 와도 거부", () => {
    expect(exclusiveFieldError(base({ declType: "export", taxCurrency: "USD" }))).toContain("수출신고");
  });
  it("수입에 적재기한 연장일이 오면 거부", () => {
    expect(
      exclusiveFieldError(base({ declType: "import", loadingDeadlineExtended: "2026-09-01" })),
    ).toContain("수입신고");
  });
  it("수출에 연장일은 허용, 수입에 세액은 허용", () => {
    expect(
      exclusiveFieldError(base({ declType: "export", loadingDeadlineExtended: "2026-09-01" })),
    ).toBeNull();
    expect(
      exclusiveFieldError(base({ declType: "import", taxableValue: 100, taxCurrency: "USD" })),
    ).toBeNull();
  });
});

/* ---------- 금액-통화 불가분 (3케이스 + 숫자 유효성) ---------- */

describe("taxCurrencyError", () => {
  it("세액이 있으면 통화 필수", () => {
    expect(
      taxCurrencyError({ taxableValue: 100, dutyAmount: null, vatAmount: null, taxCurrency: null }),
    ).toContain("통화가 필요");
  });
  it("세액 없이 통화만 오면 거부", () => {
    expect(
      taxCurrencyError({ taxableValue: null, dutyAmount: null, vatAmount: null, taxCurrency: "USD" }),
    ).toContain("통화만");
  });
  it("세액+통화 둘 다 있으면 통과", () => {
    expect(
      taxCurrencyError({ taxableValue: 100, dutyAmount: 10, vatAmount: 11, taxCurrency: "USD" }),
    ).toBeNull();
  });
  it("둘 다 없으면 통과", () => {
    expect(
      taxCurrencyError({ taxableValue: null, dutyAmount: null, vatAmount: null, taxCurrency: null }),
    ).toBeNull();
  });
  it("세액 음수·비유한 거부", () => {
    expect(
      taxCurrencyError({ taxableValue: -1, dutyAmount: null, vatAmount: null, taxCurrency: "USD" }),
    ).toContain("유효한 숫자");
    expect(
      taxCurrencyError({
        taxableValue: Infinity,
        dutyAmount: null,
        vatAmount: null,
        taxCurrency: "USD",
      }),
    ).toContain("유효한 숫자");
    expect(
      taxCurrencyError({ taxableValue: NaN, dutyAmount: null, vatAmount: null, taxCurrency: "USD" }),
    ).toContain("유효한 숫자");
  });
  it("세액 0 은 허용(음수만 거부)", () => {
    expect(
      taxCurrencyError({ taxableValue: 0, dutyAmount: 0, vatAmount: 0, taxCurrency: "USD" }),
    ).toBeNull();
  });
});

/* ---------- 날짜 정합 ---------- */

describe("dateConsistencyError", () => {
  it("수리일 < 신고일 거부", () => {
    expect(dateConsistencyError("2026-07-16", "2026-07-15")).toContain("빠를 수 없습니다");
  });
  it("같은 날 허용", () => {
    expect(dateConsistencyError("2026-07-16", "2026-07-16")).toBeNull();
  });
  it("수리일 > 신고일 허용", () => {
    expect(dateConsistencyError("2026-07-16", "2026-07-20")).toBeNull();
  });
  it("한쪽이라도 없으면 통과", () => {
    expect(dateConsistencyError(null, "2026-07-16")).toBeNull();
    expect(dateConsistencyError("2026-07-16", null)).toBeNull();
  });
});

/* ---------- 기일 소스 필터 (accepted만·shipped 제외·cancelled 제외) ---------- */

describe("includeAsLoadingDeadline", () => {
  const d = (over: Partial<Parameters<typeof includeAsLoadingDeadline>[0]>) => ({
    declType: "export",
    status: "accepted",
    acceptanceDate: "2026-07-16",
    shipmentStatus: "booked",
    ...over,
  });
  it("수출·수리·수리일有·선적 booked → 편입", () => {
    expect(includeAsLoadingDeadline(d({}))).toBe(true);
  });
  it("수입은 제외", () => {
    expect(includeAsLoadingDeadline(d({ declType: "import" }))).toBe(false);
  });
  it("수리 전(filed/draft)은 제외", () => {
    expect(includeAsLoadingDeadline(d({ status: "filed" }))).toBe(false);
    expect(includeAsLoadingDeadline(d({ status: "draft" }))).toBe(false);
  });
  it("수리일 없으면 제외", () => {
    expect(includeAsLoadingDeadline(d({ acceptanceDate: null }))).toBe(false);
  });
  it("선적이 shipped/arrived/cancelled 면 제외", () => {
    expect(includeAsLoadingDeadline(d({ shipmentStatus: "shipped" }))).toBe(false);
    expect(includeAsLoadingDeadline(d({ shipmentStatus: "arrived" }))).toBe(false);
    expect(includeAsLoadingDeadline(d({ shipmentStatus: "cancelled" }))).toBe(false);
  });
  it("선적 status null 이어도(살아있음) 편입", () => {
    expect(includeAsLoadingDeadline(d({ shipmentStatus: null }))).toBe(true);
  });
});

/* ---------- 종합 검증 (validateCustomsDeclSave) ---------- */

describe("validateCustomsDeclSave — RPC 순서 미러", () => {
  const ctx = {
    currentStatus: null as string | null,
    shipmentStatus: "booked" as string | null,
    shipmentDirection: "export" as string | null,
  };
  it("정상 신규 draft 는 통과", () => {
    expect(validateCustomsDeclSave(base({ declType: "export", status: "draft" }), ctx)).toBeNull();
  });
  it("정상 수입 accepted (세액+통화+필수날짜)", () => {
    expect(
      validateCustomsDeclSave(
        base({
          declType: "import",
          status: "accepted",
          filingDate: "2026-07-16",
          acceptanceDate: "2026-07-17",
          customsDeclNo: "IMP-1",
          taxableValue: 1000,
          dutyAmount: 80,
          vatAmount: 108,
          taxCurrency: "USD",
        }),
        { currentStatus: null, shipmentStatus: "booked", shipmentDirection: "import" },
      ),
    ).toBeNull();
  });
  it("취소된 선적이면 최우선 거부", () => {
    expect(
      validateCustomsDeclSave(base({ status: "draft" }), { ...ctx, shipmentStatus: "cancelled" }),
    ).toContain("취소된 선적");
  });
  it("accepted 행 수정은 거부 메시지", () => {
    expect(
      validateCustomsDeclSave(
        base({
          declType: "export",
          status: "accepted",
          filingDate: "2026-07-16",
          acceptanceDate: "2026-07-17",
          customsDeclNo: "E-1",
        }),
        { currentStatus: "accepted", shipmentStatus: "booked", shipmentDirection: "export" },
      ),
    ).toContain("수리 완료");
  });
  it("filed→draft 역행 거부 메시지", () => {
    expect(
      validateCustomsDeclSave(base({ status: "draft" }), {
        currentStatus: "filed",
        shipmentStatus: "booked",
        shipmentDirection: "export",
      }),
    ).toContain("되돌릴 수 없습니다");
  });
  it("방향 불일치 거부", () => {
    expect(
      validateCustomsDeclSave(base({ declType: "import", status: "draft" }), {
        currentStatus: null,
        shipmentStatus: "booked",
        shipmentDirection: "export",
      }),
    ).toContain("일치하지 않습니다");
  });
});
