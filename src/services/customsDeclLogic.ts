/**
 * 통관신고(P5.1 E6/E9) 순수 로직 — I/O 없음 → 단위 테스트 대상(customsDeclLogic.test.ts).
 *
 * ⚠️ **클라이언트 안전 모듈**(tradeDocLogic.ts 와 같은 결, I/O·서버 import 없음).
 *    현재 소비자: (1) 기일엔진 deadlines.ts — includeAsLoadingDeadline·effectiveLoadingDeadline,
 *    (2) 상세 화면 [id]/page.tsx — effectiveLoadingDeadline, (3) 단위 테스트. 클라 폼에서
 *    바로 import 할 수 있다(services/customsDeclarations.ts 는 서버 클라를 끌어와 불가).
 *
 * ⚠️ 여기의 규칙은 save_customs_declaration RPC 의 **규칙 미러**다 — 진실은 서버(RPC).
 *    각 술어의 pass/reject 는 RPC 와 동치지만, 검사 '순서'는 RPC 와 다를 수 있어
 *    다중 위반 시 첫 메시지가 갈릴 수 있다(결과는 항상 동일). 폼 사전차단에 쓸 때 참고.
 */
import { addDaysYmd, daysBetween } from "@/lib/date";

/** 저장 가능한 상태(취소 제외 — 취소는 cancel_customs_declaration RPC). */
export type CustomsSaveStatus = "draft" | "filed" | "accepted";

/** 검증에 필요한 통관신고 값 부분집합(폼·입력 공통). */
export interface CustomsDeclFields {
  declType: string;
  status: string;
  filingDate: string | null;
  acceptanceDate: string | null;
  customsDeclNo: string | null;
  taxableValue: number | null;
  dutyAmount: number | null;
  vatAmount: number | null;
  taxCurrency: string | null;
  loadingDeadlineExtended: string | null;
}

/** 저장 검증 컨텍스트 — 기존 행/선적 상태(신규면 currentStatus=null). */
export interface CustomsDeclValidationContext {
  currentStatus: string | null; // 기존 행의 현재 상태(신규면 null)
  shipmentStatus: string | null; // 소속 선적 status (cancelled 거부용)
  shipmentDirection: string | null; // 선적 방향(null 이면 방향 검사 통과)
}

/**
 * 적재의무기한(effective) = coalesce(연장승인일, 수리일 + 30일). 저장하지 않고 계산만(파생 저장 금지).
 * 둘 다 없으면 null(수리 전이거나 수출 아님).
 */
export function effectiveLoadingDeadline(
  acceptanceDate: string | null,
  loadingDeadlineExtended: string | null,
): string | null {
  if (loadingDeadlineExtended) return loadingDeadlineExtended;
  if (acceptanceDate) return addDaysYmd(acceptanceDate, 30);
  return null;
}

/**
 * 저장 시 상태 전이 허용 여부(RPC 매트릭스 미러).
 * - next 는 draft/filed/accepted 만(cancelled·기타 = 거부, 취소는 별도 RPC).
 * - current=null(신규): 셋 다 허용.
 * - draft → draft|filed|accepted.
 * - filed → filed|accepted (역행 draft 금지).
 * - accepted → 전면 거부(수정 없음, 취소만).
 * - cancelled → 거부.
 */
export function canSaveStatusTransition(current: string | null, next: string): boolean {
  const allowed: CustomsSaveStatus[] = ["draft", "filed", "accepted"];
  if (!allowed.includes(next as CustomsSaveStatus)) return false;
  if (current === null) return true;
  switch (current) {
    case "draft":
      return true;
    case "filed":
      return next === "filed" || next === "accepted";
    default: // accepted, cancelled, 기타
      return false;
  }
}

/** 상태별 필수 필드 — filed 이상=신고일, accepted=+수리일+세관번호. 위반 시 메시지, 없으면 null. */
export function requiredFieldError(
  status: string,
  fields: { filingDate: string | null; acceptanceDate: string | null; customsDeclNo: string | null },
): string | null {
  if ((status === "filed" || status === "accepted") && !fields.filingDate) {
    return "신고(filed) 이상 상태에는 신고일이 필요합니다.";
  }
  if (status === "accepted") {
    if (!fields.acceptanceDate) return "수리(accepted) 상태에는 수리일이 필요합니다.";
    if (!fields.customsDeclNo || fields.customsDeclNo.trim() === "") {
      return "수리(accepted) 상태에는 세관 신고번호가 필요합니다.";
    }
  }
  return null;
}

/** 방향 일치 — 선적 방향이 있고 decl_type 과 다르면 거부. null 이면 통과. */
export function directionMatchError(
  shipmentDirection: string | null,
  declType: string,
): string | null {
  const dir = shipmentDirection?.trim() || null;
  if (dir !== null && dir !== declType) {
    return `선적 방향(${dir})과 신고 유형(${declType})이 일치하지 않습니다.`;
  }
  return null;
}

/** 전용 필드 상호 거부 — 수출에 세액·통화, 수입에 적재기한 연장일이 오면 거부. */
export function exclusiveFieldError(fields: CustomsDeclFields): string | null {
  const hasTax =
    fields.taxableValue !== null || fields.dutyAmount !== null || fields.vatAmount !== null;
  const hasCcy = !!fields.taxCurrency && fields.taxCurrency.trim() !== "";
  if (fields.declType === "export") {
    if (hasTax || hasCcy) return "수출신고에는 세액·통화를 입력할 수 없습니다(수입 전용).";
  } else if (fields.declType === "import") {
    if (fields.loadingDeadlineExtended) {
      return "수입신고에는 적재의무기한 연장승인일을 입력할 수 없습니다(수출 전용).";
    }
  }
  return null;
}

/** 금액-통화 불가분 + 세액 숫자 유효성(음수·비유한 거부). */
export function taxCurrencyError(fields: {
  taxableValue: number | null;
  dutyAmount: number | null;
  vatAmount: number | null;
  taxCurrency: string | null;
}): string | null {
  const amounts = [fields.taxableValue, fields.dutyAmount, fields.vatAmount];
  for (const a of amounts) {
    if (a !== null && (!Number.isFinite(a) || a < 0)) {
      return "세액은 0 이상의 유효한 숫자여야 합니다.";
    }
  }
  const hasTax = amounts.some((a) => a !== null);
  const ccy = fields.taxCurrency?.trim() || null;
  if (hasTax && !ccy) return "세액을 입력하면 통화가 필요합니다.";
  if (!hasTax && ccy) return "세액이 없는데 통화만 입력되었습니다.";
  return null;
}

/** 날짜 정합 — 수리일 < 신고일 거부(같은 날 허용). 둘 다 있을 때만 검사. */
export function dateConsistencyError(
  filingDate: string | null,
  acceptanceDate: string | null,
): string | null {
  if (filingDate && acceptanceDate && daysBetween(filingDate, acceptanceDate) < 0) {
    return `수리일(${acceptanceDate})은 신고일(${filingDate})보다 빠를 수 없습니다.`;
  }
  return null;
}

/**
 * 저장 종합 검증(폼 사전차단용) — RPC 규칙 미러. 첫 위반 메시지, 통과면 null.
 * ⚠️ 검사 순서는 RPC 와 다르다(결과 동치·첫 메시지만 갈릴 수 있음). 또한 shipment_id null·
 *    기존행의 shipment_id/decl_type 불변 검사는 여기 없다(폼이 수정 모드에서 유형을 고정) — 서버만.
 *    서버가 최종 권위이므로 여기 통과가 저장 성공을 보장하진 않는다(락·중복·발번 등은 서버만).
 */
export function validateCustomsDeclSave(
  fields: CustomsDeclFields,
  ctx: CustomsDeclValidationContext,
): string | null {
  if (ctx.shipmentStatus === "cancelled") {
    return "취소된 선적에는 통관신고를 작성할 수 없습니다.";
  }
  if (fields.declType !== "export" && fields.declType !== "import") {
    return "신고 유형은 수출(export) 또는 수입(import)만 가능합니다.";
  }
  if (fields.status === "cancelled") {
    return "취소는 취소 기능으로만 가능합니다.";
  }
  if (!canSaveStatusTransition(ctx.currentStatus, fields.status)) {
    if (ctx.currentStatus === "accepted") return "수리 완료된 통관신고는 수정할 수 없습니다(취소만 가능).";
    if (ctx.currentStatus === "cancelled") return "취소된 통관신고는 수정할 수 없습니다.";
    if (ctx.currentStatus === "filed" && fields.status === "draft") {
      return "신고 상태에서 작성중으로 되돌릴 수 없습니다. 취소 후 새로 작성하세요.";
    }
    return "상태 값이 올바르지 않습니다.";
  }
  const de = directionMatchError(ctx.shipmentDirection, fields.declType);
  if (de) return de;
  const ee = exclusiveFieldError(fields);
  if (ee) return ee;
  const te = taxCurrencyError(fields);
  if (te) return te;
  const re = requiredFieldError(fields.status, fields);
  if (re) return re;
  return dateConsistencyError(fields.filingDate, fields.acceptanceDate);
}

/**
 * 기일엔진 '적재의무기한' 소스 편입 여부(P5.1 5번째 소스, 커밋 d 사용).
 * 수출·수리·수리일有 그리고 소속 선적이 아직 안 나갔고 살아있을 때만(shipped/arrived/cancelled 제외).
 */
export function includeAsLoadingDeadline(d: {
  declType: string;
  status: string;
  acceptanceDate: string | null;
  shipmentStatus: string | null;
}): boolean {
  if (!(d.declType === "export" && d.status === "accepted" && d.acceptanceDate !== null)) {
    return false;
  }
  const ss = d.shipmentStatus;
  return ss !== "shipped" && ss !== "arrived" && ss !== "cancelled";
}
