import { describe, it, expect } from "vitest";
import { todayKst, periodKst, periodOfYmd, daysBetween, addDaysYmd } from "./date";

/**
 * P4.0-a — 발번·날짜의 KST 기준 증명.
 *
 * 배경: 선적 발번이 `new Date().toISOString()`(UTC)을 써서, 한국시간 8/1 08:00에
 * 부킹하면 UTC로는 7/31이라 SHP-202607-NNN으로 한 달 밀려 발번됐다.
 * 전표번호는 발번 후 불변이라 사후 정정이 불가능하므로 경계를 테스트로 못박는다.
 *
 * KST = UTC+9 → UTC 15:00이 KST 자정. 이 경계가 모든 케이스의 핵심.
 */

describe("todayKst — 오늘의 한국 달력 날짜", () => {
  it("UTC 14:59:59 → 아직 같은 날 (KST 23:59:59)", () => {
    expect(todayKst(new Date("2026-07-31T14:59:59Z"))).toBe("2026-07-31");
  });

  it("UTC 15:00:00 → 한국은 이미 다음날 자정 (경계)", () => {
    expect(todayKst(new Date("2026-07-31T15:00:00Z"))).toBe("2026-08-01");
  });

  it("UTC 자정 직후는 한국 오전 9시 — 같은 날", () => {
    expect(todayKst(new Date("2026-07-16T00:00:00Z"))).toBe("2026-07-16");
  });

  it("연말 경계: UTC 12/31 15:00 → 한국은 새해", () => {
    expect(todayKst(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });
});

describe("periodKst — 발번 기간 YYYYMM", () => {
  it("★버그 재현 방지: 한국 8/1 08:00(=UTC 7/31 23:00)은 202608이어야 한다", () => {
    // 구 코드 new Date().toISOString().slice(0,7) 는 여기서 '202607'을 반환했다.
    expect(periodKst(new Date("2026-07-31T23:00:00Z"))).toBe("202608");
  });

  it("한국 7/31 23:00(=UTC 7/31 14:00)은 아직 202607", () => {
    expect(periodKst(new Date("2026-07-31T14:00:00Z"))).toBe("202607");
  });

  it("연말 경계: 한국 1/1 00:00(=UTC 12/31 15:00)은 202701", () => {
    expect(periodKst(new Date("2026-12-31T15:00:00Z"))).toBe("202701");
  });

  it("하이픈 없는 6자리", () => {
    expect(periodKst(new Date("2026-07-16T03:00:00Z"))).toMatch(/^\d{6}$/);
  });
});

describe("periodOfYmd — 사용자 입력 날짜에서 기간 도출", () => {
  it("YYYY-MM-DD → YYYYMM", () => {
    expect(periodOfYmd("2026-08-01")).toBe("202608");
  });

  it("사용자가 고른 날짜는 타임존 변환 없이 그대로 쓴다", () => {
    // 폼의 날짜는 이미 KST 달력 날짜다. 여기서 Date로 파싱하면 오히려 밀린다.
    expect(periodOfYmd("2026-01-01")).toBe("202601");
  });
});

describe("daysBetween — D-day 계산", () => {
  it("같은 날은 0", () => {
    expect(daysBetween("2026-07-16", "2026-07-16")).toBe(0);
  });

  it("미래는 양수(D-n)", () => {
    expect(daysBetween("2026-07-16", "2026-07-27")).toBe(11);
  });

  it("과거는 음수(지남)", () => {
    expect(daysBetween("2026-07-16", "2026-07-12")).toBe(-4);
  });

  it("월 경계를 넘어도 달력 일수", () => {
    expect(daysBetween("2026-07-31", "2026-08-01")).toBe(1);
  });

  it("서머타임 없는 KST라도 UTC 자정 파싱으로 드리프트 없음", () => {
    expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31);
  });
});

describe("addDaysYmd — 파생 기일(수리일+30 등) 계산", () => {
  it("적재의무기한 대표: 수리일 + 30 (월 넘김)", () => {
    // 7/16 + 30 = 8/15 (7월 31일)
    expect(addDaysYmd("2026-07-16", 30)).toBe("2026-08-15");
  });

  it("월 경계: 7/31 + 1 = 8/1", () => {
    expect(addDaysYmd("2026-07-31", 1)).toBe("2026-08-01");
  });

  it("연 경계: 12/31 + 1 = 다음해 1/1", () => {
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("윤년: 2028-02-28 + 1 = 2028-02-29 (2028은 윤년)", () => {
    expect(addDaysYmd("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("평년: 2027-02-28 + 1 = 2027-03-01 (2027은 평년)", () => {
    expect(addDaysYmd("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("윤년 2월을 가로지르는 +30: 2028-02-15 + 30 = 2028-03-16", () => {
    // 2/15 → 2/29까지 14일 + 3월 16일 = 30일
    expect(addDaysYmd("2028-02-15", 30)).toBe("2028-03-16");
  });

  it("0일은 그대로", () => {
    expect(addDaysYmd("2026-07-16", 0)).toBe("2026-07-16");
  });

  it("음수 일수도 지원(역산)", () => {
    expect(addDaysYmd("2026-08-01", -1)).toBe("2026-07-31");
  });
});
