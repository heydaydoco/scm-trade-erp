/**
 * 날짜·발번 기준 유틸 — I/O 없는 순수 로직(원칙 7, 단위 테스트 대상).
 *
 * ⚠️ 이 시스템의 '오늘'은 **항상 한국(Asia/Seoul) 달력 날짜**다.
 *    서버(Vercel·Supabase)는 UTC로 도는데, UTC 15:00이 KST 자정이므로
 *    `new Date().toISOString()`을 쓰면 한국 00:00~09:00 사이에 날짜가 하루 밀린다.
 *    전표번호는 발번 후 불변이라 사후 정정이 불가능하다 → 발번 경로는 반드시 여기를 통과시킨다.
 *
 * P3.3(기일 역산)에서 확립한 규칙을 P4.0-a에서 발번·폼 기본값까지 확장했다.
 */

/** 오늘의 한국(Asia/Seoul) 달력 날짜 'YYYY-MM-DD'. en-CA 로케일이 ISO 형식을 준다. */
export function todayKst(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** 발번 기간 'YYYYMM' — 한국 달력 기준의 오늘. 헤더 날짜가 없는 전표(선적)용. */
export function periodKst(now: Date = new Date()): string {
  return periodOfYmd(todayKst(now));
}

/**
 * 'YYYY-MM-DD' → 발번 기간 'YYYYMM'.
 * 사용자가 고른 날짜는 이미 KST 달력 날짜이므로 Date로 파싱하지 않고 문자열로 자른다
 * (파싱하면 UTC 해석이 끼어들어 오히려 밀린다).
 */
export function periodOfYmd(ymd: string): string {
  return ymd.slice(0, 7).replace("-", "");
}

/**
 * 두 'YYYY-MM-DD' 사이 달력 일수 차 (to − from). 양쪽을 UTC 자정으로 파싱해 로컬 TZ 드리프트 제거.
 * dDay = daysBetween(오늘KST, 기일) → 음수=지남, 0=오늘, 양수=D-n.
 */
export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}
