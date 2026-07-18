/**
 * 무역서류(P4.5 CI/PL) 순수 로직 — I/O 없음 → 단위 테스트 대상(tradeDocLogic.test.ts).
 *
 * ⚠️ **클라이언트 안전 모듈**이다(cargoLogic.ts 와 같은 결) — 발행 폼은 브라우저에서
 *    조합·할인 미리보기·중량/포장 경고를 계산해야 하는데 services/tradeDocuments.ts 는
 *    supabase 서버 클라이언트를 import 하므로 "use client" 에서 못 부른다
 *    → 순수부만 여기 떼어 두고 tradeDocuments.ts 가 재수출한다.
 *
 * ⚠️ 여기의 산식은 save_trade_document RPC 의 **미러**다(화면 미리보기 = 저장값, 원칙 2).
 *    진실은 서버(RPC) — 이 모듈이 서버와 다르게 계산하면 미리보기가 거짓말을 한다.
 */
import { round2 } from "./codes";
import { round6 } from "./docFlow";

/* ---------- ⓪ pg round(numeric, 2) 동치 반올림 (적대검증 교정) ----------
 *
 * ⚠️ 왜 round2 로는 부족한가: 서버는 numeric(정확 십진)으로 qty×단가·할인 배분을
 *    계산해 round(…, 2) = **half away from zero** 로 반올림한다. JS double 곱셈은
 *    0.5×4.27 = 2.135 를 2.1349999… 로 만들고 round2 는 이를 2.13 으로 내려
 *    미리보기 ≠ 저장값(1센트)이 된다 — 원칙 2 위반. 여기서는 값의 십진 문자열
 *    표현(DB numeric 원문과 일치)을 정수 스케일로 복원해 정확 유리수 반올림을
 *    수행한다. 지수 표기 극단값만 float 경로로 폴백한다(업무값 도달 불가).
 */
interface ScaledInt {
  i: bigint; // 부호 포함 정수부
  s: number; // 10^s 분모 스케일
}

function scaledOrNull(n: number): ScaledInt | null {
  if (!Number.isFinite(n)) return null;
  const str = String(n);
  if (/[eE]/.test(str)) return null; // 1e-7 등 극단값 — float 폴백
  const neg = str.startsWith("-");
  const body = neg ? str.slice(1) : str;
  const [int, frac = ""] = body.split(".");
  const i = BigInt(int + frac);
  return { i: neg ? -i : i, s: frac.length };
}

// BigInt 리터럴(10n)은 target ES2017 에서 막힌다 — 함수 호출 형태만 사용.
const BIG0 = BigInt(0);
const POW10 = (s: number): bigint => BigInt(10) ** BigInt(s);

/** 정확 유리수 num/den(den>0)을 소수 2자리 half-away-from-zero 반올림. */
function roundRatio2(num: bigint, den: bigint): number {
  const abs = num < BIG0 ? -num : num;
  const q = (abs * BigInt(200) + den) / (BigInt(2) * den); // BigInt 나눗셈 = floor
  return (num < BIG0 ? -Number(q) : Number(q)) / 100;
}

/** round(a×b, 2) — 서버 round(v_sl.qty * v_price, 2) 동치. */
function mulRound2(a: number, b: number): number {
  const sa = scaledOrNull(a);
  const sb = scaledOrNull(b);
  if (!sa || !sb) return round2(a * b);
  return roundRatio2(sa.i * sb.i, POW10(sa.s + sb.s));
}

/** round(d×a÷t, 2) — 서버 D3 배분식 동치. t > 0 전제(호출부가 검사). */
function allocRound2(d: number, a: number, t: number): number {
  const sd = scaledOrNull(d);
  const sa = scaledOrNull(a);
  const st = scaledOrNull(t);
  if (!sd || !sa || !st || st.i <= BIG0) return round2((d * a) / t);
  return roundRatio2(sd.i * sa.i * POW10(st.s), st.i * POW10(sd.s + sa.s));
}

/** 소수 2자리 값들의 무오차 합(센트 정수 누적) — Σround2 결과 합산 전용. */
function sumCents(values: readonly number[]): number {
  let cents = 0;
  for (const v of values) cents += Math.round(v * 100);
  return cents / 100;
}

/* ---------- ① (고객×통화) 발행 조합 — D4: 생성 단위 = 선적×고객×통화 ---------- */

export interface ComboSourceLine {
  shipmentLineId: string;
  orderType: "SO" | "PO";
  customerId: string | null;
  customerName: string | null;
  currency: string | null; // sales_orders.currency 원문 (공란·공백 = 없음)
  soNumber: string | null;
}

export interface IssuableCombo {
  customerId: string;
  customerName: string | null;
  currency: string;
  lineCount: number;
  soNumbers: string[]; // 표시용 (중복 제거, 등장 순서)
}

/**
 * 선적 라인에서 발행 가능한 (고객×통화) 조합을 만든다.
 * - PO 라인은 조합 대상이 아니다(수입 서류는 공급자 발행 — 정의이므로 경고 없음).
 * - 통화 공란 SO·고객 미상 라인은 제외 + 경고(RPC 도 같은 이유로 거부한다).
 */
export function issuableCombos(lines: readonly ComboSourceLine[]): {
  combos: IssuableCombo[];
  warnings: string[];
} {
  const combos = new Map<string, IssuableCombo>();
  const warned = new Set<string>();
  const warnings: string[] = [];

  for (const l of lines) {
    if (l.orderType !== "SO") continue;
    const currency = l.currency?.trim() || null;
    const soLabel = l.soNumber ?? "(번호 미상)";
    if (!currency) {
      if (!warned.has(`cur:${soLabel}`)) {
        warned.add(`cur:${soLabel}`);
        warnings.push(`주문 ${soLabel}: 통화가 지정되지 않아 발행 대상에서 제외했습니다.`);
      }
      continue;
    }
    if (!l.customerId) {
      if (!warned.has(`cust:${soLabel}`)) {
        warned.add(`cust:${soLabel}`);
        warnings.push(`주문 ${soLabel}: 고객을 알 수 없어 발행 대상에서 제외했습니다.`);
      }
      continue;
    }
    const key = `${l.customerId}|${currency}`;
    const combo = combos.get(key);
    if (!combo) {
      combos.set(key, {
        customerId: l.customerId,
        customerName: l.customerName,
        currency,
        lineCount: 1,
        soNumbers: l.soNumber ? [l.soNumber] : [],
      });
    } else {
      combo.lineCount += 1;
      if (l.soNumber && !combo.soNumbers.includes(l.soNumber)) {
        combo.soNumbers.push(l.soNumber);
      }
    }
  }
  return { combos: Array.from(combos.values()), warnings };
}

/* ---------- ② D3 할인 비례 배분 — save_trade_document 산식 미러 ---------- */

export interface DiscountAllocEntry {
  soNumber: string | null;
  discount: number; // SO 헤더 할인 (null 은 호출부가 0 으로)
  docAmount: number; // 이 문서에 포함된 그 주문 라인 금액합
  orderTotal: number; // 그 주문 전체 라인 금액합 (amount null 라인은 qty×단가 재계산 합산)
}

/**
 * discount = Σ 주문별 round2(주문 discount × docAmount ÷ orderTotal).
 * orderTotal ≤ 0 이면 그 주문은 0 처리 + 경고(할인이 0이 아닐 때만 — 배분할 것이 없으면 침묵).
 * 음수 할인은 충실 배분하되 경고한다(서버도 동일 — 값 발명 금지).
 */
export function allocateDiscounts(entries: readonly DiscountAllocEntry[]): {
  discount: number;
  warnings: string[];
} {
  let discount = 0;
  const warnings: string[] = [];
  for (const e of entries) {
    const soLabel = e.soNumber ?? "(번호 미상)";
    if (e.orderTotal <= 0) {
      if (e.discount !== 0) {
        warnings.push(
          `주문 ${soLabel}: 라인 금액 합(${e.orderTotal})이 0 이하라 할인(${e.discount})을 배분하지 않았습니다.`,
        );
      }
      continue;
    }
    if (e.discount < 0) {
      warnings.push(`주문 ${soLabel}: 할인이 음수(${e.discount})입니다 — 주문 데이터 확인이 필요합니다.`);
    }
    // 서버 round(numeric, 2) 동치 — .xx5 경계·음수 half-away 포함(적대검증 교정).
    discount = sumCents([discount, allocRound2(e.discount, e.docAmount, e.orderTotal)]);
  }
  return { discount, warnings };
}

/* ---------- ②-b (커밋 c) 발행 폼 결선 — 조합 스코프·할인 엔트리 구성 ---------- */

/**
 * (선적×고객×통화) 스코프 필터의 클라이언트 미러(D4) — 발행 폼이 이 조합에
 * 속하는 라인만 보여주고 payload 에 싣는다. 서버(RPC)는 같은 스코프를 라인
 * 단위로 재검증한다(클라 값 불신).
 */
export function linesForCombo<
  T extends { orderType: "SO" | "PO"; customerId: string | null; currency: string | null },
>(lines: readonly T[], customerId: string, currency: string): T[] {
  return lines.filter(
    (l) =>
      l.orderType === "SO" &&
      l.customerId === customerId &&
      (l.currency?.trim() || null) === currency,
  );
}

/** 할인 미리보기 재료 1줄 — listIssuableLines 파생 행의 부분집합. */
export interface DiscountSourceLine {
  soId: string | null;
  soNumber: string | null;
  qty: number;
  unitPrice: number | null; // null = 단가 미상(서버가 발행 거부할 라인 — 미리보기 제외)
  soDiscount: number;
  soOrderTotal: number;
}

/**
 * 포함 라인 → 주문별 DiscountAllocEntry (서버 v_so_ids/v_so_amounts 누적 미러).
 * docAmount = Σ lineAmount(qty×단가) — 주문 등장 순서 유지(array_position 미러).
 * soId·unitPrice 미상 라인은 뺀다(그 라인이 포함되면 서버가 발행 자체를 거부한다).
 */
export function discountEntriesOf(
  lines: readonly DiscountSourceLine[],
): DiscountAllocEntry[] {
  const order: string[] = [];
  const bySo = new Map<string, DiscountAllocEntry>();
  for (const l of lines) {
    if (l.soId === null || l.unitPrice === null) continue;
    const amount = lineAmount(l.qty, l.unitPrice);
    const entry = bySo.get(l.soId);
    if (!entry) {
      order.push(l.soId);
      bySo.set(l.soId, {
        soNumber: l.soNumber,
        discount: l.soDiscount,
        docAmount: amount,
        orderTotal: l.soOrderTotal,
      });
    } else {
      entry.docAmount = sumCents([entry.docAmount, amount]);
    }
  }
  return order.map((id) => bySo.get(id)!);
}

/* ---------- ③ 라인 금액·합계 — D2: amount = round2(qty × 단가) ---------- */

/** 라인 금액 — 서버 round(qty×단가, 2) 동치(.xx5 경계 포함). 미리보기 = 저장값(원칙 2). */
export function lineAmount(qty: number, unitPrice: number): number {
  return mulRound2(qty, unitPrice);
}

export function subtotalOf(lines: readonly { qty: number; unitPrice: number }[]): number {
  return sumCents(lines.map((l) => lineAmount(l.qty, l.unitPrice)));
}

export function totalOf(subtotal: number, discount: number): number {
  return sumCents([subtotal, -discount]);
}

/** 단가 0(qty>0) 라인 수 — 폼 경고 "0원 라인 n건"의 근거(차단 아님, 원칙 8). */
export function zeroPriceCount(lines: readonly { unitPrice: number }[]): number {
  return lines.filter((l) => l.unitPrice === 0).length;
}

/* ---------- ④ D5·R1 중량 — all-or-nothing 인쇄 규칙 ---------- */

/** all = 전 라인 입력(컬럼+TOTAL 인쇄) / partial = 컬럼 생략+폼 경고 / none = 생략. */
export type AllOrNothing = "all" | "none" | "partial";

export function weightFillMode(values: readonly (number | null)[]): AllOrNothing {
  if (values.length === 0) return "none";
  const filled = values.filter((v) => v !== null).length;
  if (filled === 0) return "none";
  return filled === values.length ? "all" : "partial";
}

/** 중량 TOTAL — kg 고정 단위 단일 합(S/I sumFinite 와 같은 round6). 'all' 일 때만 인쇄. */
export function weightTotal(values: readonly (number | null)[]): number {
  return round6(values.reduce<number>((s, v) => (v === null ? s : s + v), 0));
}

/* ---------- ⑤ R-정정 포장 섹션 — 포함 라인 스코프 all-or-nothing ---------- */

export interface PackingLike {
  packageCount: number | null;
  packageType: string | null;
}

/**
 * 포장 데이터 "보유" = packageCount > 0 그리고 packageType 비공란(S/I 총계 규칙과 동일).
 * 전원 보유 = all(섹션 인쇄 — 유형별 TOTAL 은 cargoLogic.packageTotalsByType 재사용),
 * 일부 보유 = partial(섹션 생략 + 폼 경고: "발행 전에는 선적 화물 화면에서 채울 수 있다"),
 * 전무 = none(섹션 생략).
 */
export function packingFillMode(lines: readonly PackingLike[]): AllOrNothing {
  if (lines.length === 0) return "none";
  const has = (l: PackingLike) =>
    l.packageCount !== null && l.packageCount > 0 && !!l.packageType?.trim();
  const filled = lines.filter(has).length;
  if (filled === 0) return "none";
  return filled === lines.length ? "all" : "partial";
}
