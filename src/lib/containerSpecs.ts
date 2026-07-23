/**
 * 컨테이너 공칭 내용적 사전 (P5.2 적입 — I/O 없는 순수 상수·조회, 클라이언트 안전).
 *
 * ⚠️ **자문 표시 전용**이다. 여기 값은 어떤 컬럼에도 저장되지 않고(SPEC 판정 ④),
 *    적입을 막지도 않는다 — "이 타입이면 대략 이 정도"라는 참고 분모일 뿐이다.
 *    실제 내용적은 선사·제조사·연식마다 다르다.
 * ⚠️ **type 정확일치일 때만** 값을 낸다. container_type 은 자유입력 텍스트이고
 *    RPC 는 btrim 정규화만 한다(대문자 강제·ISO 검증 금지) — 그래서 여기서도
 *    같은 btrim 만 미러하고, 대소문자 접기·유사 표기 추정은 하지 않는다.
 *    모르면 null 을 내는 편이 틀린 분모로 용적률을 단정하는 것보다 낫다.
 */

/** 표준 4종의 공칭 내용적(m³). 스펙 확정값 — 임의 확장 금지. */
export const CONTAINER_NOMINAL_CBM: Readonly<Record<string, number>> = {
  "20GP": 33.2,
  "40GP": 67.7,
  "40HC": 76.4,
  "45HC": 86.0,
};

/** 컨테이너 타입의 공칭 내용적(m³) — 사전에 없으면 null(자문 없음). */
export function nominalCbmOf(
  containerType: string | null | undefined,
): number | null {
  if (!containerType) return null;
  return CONTAINER_NOMINAL_CBM[containerType.trim()] ?? null;
}
