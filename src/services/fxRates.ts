import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BASE_CURRENCY } from "@/config/company";
import { round6 } from "./codes";
import type { FxRate, FxRateInput, LatestRate } from "./types";

/**
 * 환율 대장(FX Rates) 서비스 — SPEC F5, 원칙 1-B(돈=금액+통화)·원칙 5(불변)·원칙 7(로직/화면 분리).
 *
 * ⚠️ 추가 전용: update/delete 함수가 없다(대장은 정정도 새 행으로). fx_rates 권한은
 *    SELECT만 — INSERT 도 P4.4h 에서 봉인, 쓰기는 save_fx_rate RPC 로만.
 * ⚠️ 100단위 고시 함정: 입력은 은행 고시값 그대로(quotedRate) 받고, 여기서 quoteUnit으로 나눠
 *    1단위 정규화값(rate)을 저장한다 — 정규화를 이 한 곳에 가둬 다운스트림 100배 오류를 원천 차단.
 * 참조: db/migrations/p2.3_fx_rates.sql
 */

/* ---------- 물리 테이블 행 모양 (이 파일 바깥으로 노출 안 함) ---------- */

interface FxRateRow {
  id: string;
  base_currency: string;
  quote_currency: string;
  rate: number | string | null;
  quote_unit: number | string | null;
  rate_date: string | null;
  source: string | null;
  quoted_at: string | null;
  note: string | null;
  created_at: string | null;
}

const FX_COLUMNS =
  "id, base_currency, quote_currency, rate, quote_unit, rate_date, source, quoted_at, note, created_at";

/* ---------- 순수 매핑 (I/O 없음 → 단위 테스트 가능) ---------- */

/** fx_rates 행 → 도메인 FxRate. */
export function mapRowToFxRate(row: FxRateRow): FxRate {
  return {
    id: row.id,
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rate: Number(row.rate ?? 0),
    quoteUnit: Number(row.quote_unit ?? 1),
    rateDate: row.rate_date,
    source: row.source,
    quotedAt: row.quoted_at,
    note: row.note,
    createdAt: row.created_at,
  };
}

/**
 * 은행 고시값 → 대장 저장값 정규화 (1단위 기준). 예) 905/100 → 9.05 (1엔당).
 * ★ P4.4h 부터 저장값 계산은 save_fx_rate RPC 가 수행한다(round 6자리 — 같은 규칙).
 *   이 함수는 그 계산의 **순수 미러**로 남아 폼 미리보기·테스트가 쓴다.
 */
export function normalizeRate(quotedRate: number, quoteUnit: number): number {
  return round6(quotedRate / quoteUnit);
}

/**
 * save_fx_rate RPC 검증의 **순수 미러** — DB 왕복 없이 즉시 거부한다.
 * 메시지는 RPC 의 RAISE 와 동일하게 유지할 것(어느 겹에서 걸려도 같은 안내).
 */
export function fxRateInputError(input: {
  baseCurrency: string;
  quoteCurrency: string;
  quotedRate: number;
  quoteUnit: number;
}): string | null {
  const base = input.baseCurrency.trim();
  const quote = input.quoteCurrency.trim();
  if (!quote) return "대상통화를 선택하세요.";
  if (quote === base) {
    return `기준통화(${base})는 대장에 등록할 필요가 없습니다 — 환율은 항상 1입니다.`;
  }
  if (!Number.isFinite(input.quoteUnit) || input.quoteUnit <= 0) {
    return "고시단위는 0보다 큰 숫자여야 합니다.";
  }
  if (!Number.isFinite(input.quotedRate) || input.quotedRate <= 0) {
    return "환율은 0보다 큰 숫자로 입력하세요.";
  }
  const rate = normalizeRate(input.quotedRate, input.quoteUnit);
  if (!Number.isFinite(rate) || rate <= 0) {
    return "정규화된 환율이 올바르지 않습니다.";
  }
  return null;
}

/* ---------- I/O (서비스). 화면은 이 함수들만 호출한다. ---------- */

/** 환율 대장 전체 (최신순). 목록 화면용. */
export async function listFxRates(): Promise<FxRate[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("fx_rates")
    .select(FX_COLUMNS)
    .order("rate_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw new Error(`환율 대장 조회 실패: ${error.message}`);
  const rows = (data ?? []) as unknown as FxRateRow[];
  return rows.map(mapRowToFxRate);
}

/**
 * 통화별 최신 환율 맵 (프리필용). 기준통화(base)에 대한 각 대상통화의 최신 1행.
 * DB 뷰 fx_rates_latest(=DISTINCT ON, 통화별 rate_date desc·created_at desc 1행)를 조회한다 —
 * 전역 limit 윈도우에 의존하지 않아 대장이 커져도 통화별 최신이 누락되지 않고, 정정(나중 행)이 이긴다.
 * rate는 1단위 정규화값이라 문서 exchangeRate에 그대로 넣으면 된다.
 * 반환: { USD: {rate,quoteUnit,source,quotedAt,rateDate}, ... } (기준통화 자신은 제외 — 항상 1).
 */
export async function getLatestRates(
  base: string = BASE_CURRENCY,
): Promise<Record<string, LatestRate>> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("fx_rates_latest")
    .select(FX_COLUMNS)
    .eq("base_currency", base);

  if (error) throw new Error(`최신 환율 조회 실패: ${error.message}`);
  const rows = (data ?? []) as unknown as FxRateRow[];

  // 뷰가 (base,quote)별 1행을 보장 → base 필터 후 통화별 1행. 방어적으로 첫 등장만 채택.
  const latest: Record<string, LatestRate> = {};
  for (const row of rows) {
    const q = row.quote_currency;
    if (q in latest) continue;
    latest[q] = {
      rate: Number(row.rate ?? 0),
      quoteUnit: Number(row.quote_unit ?? 1),
      source: row.source,
      quotedAt: row.quoted_at,
      rateDate: row.rate_date,
    };
  }
  return latest;
}

/**
 * 환율 등록 — 추가 전용(원칙 5). 쓰기는 save_fx_rate RPC 경유(P4.4h: fx_rates
 * INSERT 봉인 — 환율은 모든 금액 계산의 입력값이라 위조 주입 경로를 닫는다).
 * 정규화(quotedRate ÷ quoteUnit)와 최종 검증은 RPC 가 수행하고, 여기서는 같은
 * 규칙의 순수 미러(fxRateInputError)로 선검증만 한다.
 */
export async function createFxRate(input: FxRateInput): Promise<FxRate> {
  const base = (input.baseCurrency || BASE_CURRENCY).trim();
  const unit = Number(input.quoteUnit);
  const quoted = Number(input.quotedRate);

  const inputError = fxRateInputError({
    baseCurrency: base,
    quoteCurrency: input.quoteCurrency ?? "",
    quotedRate: quoted,
    quoteUnit: unit,
  });
  if (inputError) throw new Error(inputError);

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("save_fx_rate", {
    p_base_currency: base,
    p_quote_currency: input.quoteCurrency.trim(),
    p_quoted_rate: quoted,
    p_quote_unit: unit,
    p_rate_date: input.rateDate,
    p_source: input.source,
    p_quoted_at: input.quotedAt,
    p_note: input.note,
  });

  if (error) throw new Error(`환율 등록 실패: ${error.message}`);
  return mapRowToFxRate(data as unknown as FxRateRow);
}
