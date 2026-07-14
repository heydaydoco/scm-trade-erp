import { listFxRates } from "@/services/fxRates";
import type { FxRate } from "@/services/types";
import { PageHeader } from "@/components/PageHeader";
import { BASE_CURRENCY } from "@/config/company";

// 항상 요청 시점에 최신 대장을 읽는다.
export const dynamic = "force-dynamic";

/** 환율 숫자 표기 (최대 6자리, 부동소수 잡음 정리). */
function fmtRate(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/** timestamptz(UTC) → 한국시간 표시 (분 단위). 없으면 '-'. */
function formatAt(at: string | null): string {
  if (!at) return "-";
  try {
    return new Date(at).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return at;
  }
}

export default async function FxRatesPage() {
  let rates: FxRate[] = [];
  let errorMessage: string | null = null;

  try {
    rates = await listFxRates();
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader
        title="환율 대장"
        subtitle={`FX Rates · 기준통화 ${BASE_CURRENCY}`}
        count={errorMessage ? undefined : rates.length}
        action={{ href: "/fx-rates/new", label: "+ 환율 등록" }}
      />

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">데이터를 불러오지 못했습니다.</p>
          <p className="mt-1 break-all text-red-600">{errorMessage}</p>
          <p className="mt-2 text-xs text-red-500">
            fx_rates 테이블이 아직 없다면 db/migrations/p2.3_fx_rates.sql 을
            Supabase에서 먼저 실행하세요. (무료티어 정지 시 대시보드에서 Restore)
          </p>
        </div>
      ) : rates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          아직 등록된 환율이 없습니다. 오른쪽 위{" "}
          <span className="font-medium text-zinc-700">+ 환율 등록</span> 으로
          첫 환율을 추가하면 견적·수주 폼에서 통화 선택 시 자동으로 채워집니다.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">고시일</th>
                <th className="px-4 py-3 font-medium">대상통화</th>
                <th className="px-4 py-3 text-right font-medium">원본 고시</th>
                <th className="px-4 py-3 text-right font-medium">1단위 환율</th>
                <th className="px-4 py-3 font-medium">출처</th>
                <th className="px-4 py-3 font-medium">고시 시점</th>
                <th className="px-4 py-3 font-medium">비고</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rates.map((r) => (
                <tr key={r.id} className="align-top hover:bg-zinc-50">
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-700 tabular-nums">
                    {r.rateDate ?? "-"}
                  </td>
                  <td className="px-4 py-3 font-medium text-zinc-800">
                    {r.quoteCurrency}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-zinc-600 tabular-nums">
                    {r.quoteUnit} {r.quoteCurrency} = {fmtRate(r.rate * r.quoteUnit)}{" "}
                    {r.baseCurrency}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-zinc-900 tabular-nums">
                    1 {r.quoteCurrency} = {fmtRate(r.rate)} {r.baseCurrency}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{r.source ?? "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-500 tabular-nums">
                    {formatAt(r.quotedAt)}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">{r.note ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-zinc-400">
        환율 대장은 <strong>추가 전용</strong>입니다 — 수정·삭제 버튼이 없습니다(원칙
        5). 값이 틀렸으면 올바른 값을 새 행으로 등록하세요. 문서(견적·수주)에 저장된
        환율은 대장을 참조(FK)하지 않는 <strong>스냅샷</strong>이라, 이후 대장이 바뀌어도
        과거 문서 금액은 변하지 않습니다(원칙 1-B). · 데이터 출처: Supabase
      </p>
    </div>
  );
}
