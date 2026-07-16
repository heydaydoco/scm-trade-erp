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

/* ---------- ★ P4.3f: 단위(uom) 폴백 체인 — 입고·출고 공용 단일 진실 ---------- */

/**
 * 단위 해석: **선행전표 라인 uom → 품목 마스터 unit → null**.
 *
 * ⚠️ 'PCS' 를 지어내지 않는다 — 단위 불명 수량이 원장에 들어가는 것 자체가
 *    결함이다(원칙 8의 경고-허용 대상이 아니라 정합성 문제). null 이면 호출부가
 *    저장을 거부하거나(서비스: resolveUomOrThrow) 라인을 잠근다(폼).
 *
 * 공백 처리는 RPC 의 btrim 과 같은 규칙 — 화면·서비스·원장이 같은 값을 봐야
 * "폼이 예측한 단위 == 원장에 박히는 단위" 불변식이 유지된다.
 */
export function resolveUom(
  lineUom: string | null | undefined,
  masterUnit: string | null | undefined,
): string | null {
  const line = lineUom?.trim();
  if (line) return line;
  const master = masterUnit?.trim();
  if (master) return master;
  return null;
}

/** resolveUom 의 저장 경로용 — 해석 실패는 저장 거부(한국어 안내, 품목명 포함). */
export function resolveUomOrThrow(
  lineUom: string | null | undefined,
  masterUnit: string | null | undefined,
  itemName: string | null | undefined,
): string {
  const uom = resolveUom(lineUom, masterUnit);
  if (uom === null) {
    throw new Error(
      `단위를 알 수 없어 저장할 수 없습니다: ${itemName?.trim() || "(이름 없음)"} — ` +
        `전표 라인과 품목 마스터 어디에도 단위가 없습니다. ` +
        `품목 마스터에서 단위를 입력한 뒤 다시 시도하세요.`,
    );
  }
  return uom;
}

/** 선행전표 라인 한 줄의 단위 판정에 필요한 정보(발주·수주 공용 모양). */
export interface DocLineUnitInfo {
  unit: string | null;
  productId: string | null;
  productName: string | null;
}

/**
 * 저장 경로의 퍼라인 단위 판정 — **순수**(조회는 uomResolution.ts 가 한다).
 *
 * 거부(throw)는 "라인이 RPC 의 선행 게이트를 전부 통과할 것이 확실한데 단위만
 * 없는" 경우로 한정한다. 그 외에는 null 을 돌려보내 **RPC 의 더 정확한 에러에
 * 양보**한다 — RPC 는 uom 을 쓰기 전에 라인 참조·품목 연결을 먼저 검사한다:
 *   행 없음(타 전표 라인·유령 id) → '이 발주/수주의 라인이 아닙니다'
 *   품목 미연결(product_id null)  → '품목 마스터에 연결되지 않은 …'
 *   마스터 행 자체가 없음(소프트링크 단절) → '품목을 찾을 수 없습니다'
 *
 * 품목명은 DB 스냅샷(row.productName)을 우선한다 — 클라이언트가 보낸 이름을
 * 앞세우면 조작·개명된 이름으로 엉뚱한 품목을 고치라고 안내하게 된다(P4.2f 결).
 */
export function resolveDocLineUom(
  row: DocLineUnitInfo | undefined,
  masterUnits: ReadonlyMap<string, string | null>,
  clientItemName: string | null,
): string | null {
  if (!row?.productId) return resolveUom(row?.unit, null);
  const lineUnit = resolveUom(row.unit, null);
  if (lineUnit) return lineUnit;
  if (!masterUnits.has(row.productId)) return null;
  return resolveUomOrThrow(
    null,
    masterUnits.get(row.productId),
    row.productName ?? clientItemName,
  );
}
