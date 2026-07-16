/**
 * 선행전표 ↔ 후속전표 공용 순수 로직 (I/O 없음 → 단위 테스트 대상).
 *
 * 발주→입고(P4.2)와 수주→출고(P4.3)는 **같은 규칙**을 쓴다:
 *   잔량 = 발주/수주 수량 − Σ(취소 아닌 후속 전표 수량)
 *   초과는 차단이 아니라 경고(원칙 8과 같은 결)
 *   상태 전이: 잔량 0=완료 / 일부=partial(기계 전용) / 소비 0=세대 도장 복귀
 *
 * ⚠️ 두 벌로 복붙하면 한쪽만 고쳐져 드리프트한다 — 여기가 단일 진실이다.
 *    도메인 이름(receivedQty/shippedQty …)은 각 서비스가 재수출로 붙인다.
 */

/** 수량 합산용 최소 모양. cancelled 전표는 없던 일로 친다. */
export interface DocQtyLike {
  qty: number;
  cancelled: boolean;
}

/** 소수 수량의 부동소수 오차 정리(0.1+0.2=0.30000000000000004 함정). */
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** 살아있는(취소 아닌) 후속 전표 수량의 합. */
export function consumedQtyOf(lines: DocQtyLike[]): number {
  return round6(lines.reduce((s, l) => (l.cancelled ? s : s + l.qty), 0));
}

/**
 * 잔량 = 선행 수량 − Σ(살아있는 후속) — **원칙 1의 심장**.
 * 음수면 초과(입고/출고)다. 차단하지 않는다.
 */
export function openQtyOf(orderedQty: number, lines: DocQtyLike[]): number {
  return round6(orderedQty - consumedQtyOf(lines));
}

/** 초과 경고 판정 — **차단이 아니라 경고**(원칙 8). */
export function isOverConsume(openQty: number, qty: number): boolean {
  return qty > openQty;
}

/** 후속 전표 폼 프리필 — 잔량을 채우되 음수(이미 초과)는 0으로. */
export function prefillQty(openQty: number): number {
  return openQty > 0 ? openQty : 0;
}

/**
 * 선행 전표 상태 자동전환 규칙 — DB 전이 함수의 미러(화면 예측·테스트용).
 * null 반환 = "상태를 건드리지 마라"(세대 도장이 없는 방어 케이스).
 *
 * ⚠️ 실제 전이는 RPC 가 한다. 이 함수는 DB에 쓰지 않는다.
 */
export function nextStatusFrom(
  orderedQty: number,
  consumedQty: number,
  statusBefore: string | null,
): string | null {
  if (consumedQty === 0) return statusBefore; // 도장 값으로 복귀 (없으면 null)
  if (consumedQty >= orderedQty) return "completed";
  return "partial";
}
