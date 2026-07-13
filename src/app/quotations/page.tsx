import Link from "next/link";
import { listQuotations } from "@/services/quotations";
import type { Quotation } from "@/services/types";
import { PageHeader } from "@/components/PageHeader";
import { Badge, type BadgeVariant } from "@/components/Badge";
import { CURRENCY_SYMBOL, QUOTATION_STATUS, labelOf } from "@/services/codes";

// 항상 요청 시점에 최신 데이터를 읽는다.
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: "zinc",
  sent: "blue",
  approved: "green",
  rejected: "red",
  expired: "amber",
};

function formatMoney(amount: number, currency: string | null): string {
  const symbol = currency ? CURRENCY_SYMBOL[currency] ?? "" : "";
  return `${symbol}${amount.toLocaleString()}${currency ? ` ${currency}` : ""}`;
}

export default async function QuotationsPage() {
  let quotations: Quotation[] = [];
  let errorMessage: string | null = null;

  try {
    quotations = await listQuotations();
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader
        title="견적"
        subtitle="Quotations"
        count={errorMessage ? undefined : quotations.length}
        action={{ href: "/quotations/new", label: "+ 견적 등록" }}
      />

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">데이터를 불러오지 못했습니다.</p>
          <p className="mt-1 break-all text-red-600">{errorMessage}</p>
        </div>
      ) : quotations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          등록된 견적이 없습니다. 문의 화면의 &ldquo;→ 견적&rdquo; 또는 우측 상단 &ldquo;+ 견적 등록&rdquo;으로 추가하세요.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">견적번호</th>
                <th className="px-4 py-3 font-medium">거래처</th>
                <th className="px-4 py-3 font-medium">견적일</th>
                <th className="px-4 py-3 font-medium">유효기일</th>
                <th className="px-4 py-3 font-medium text-right">금액</th>
                <th className="px-4 py-3 font-medium">상태</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {quotations.map((q) => (
                <tr key={q.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/quotations/${q.id}`}
                      className="font-mono text-sm font-medium text-zinc-900 hover:text-blue-700 hover:underline"
                    >
                      {q.quotationNumber || "(번호 없음)"}
                    </Link>
                    {q.inquiryId ? (
                      <span className="ml-2 align-middle">
                        <Badge variant="violet">문의</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {q.partnerName ?? <span className="text-zinc-300">-</span>}
                    {q.partnerCountry ? (
                      <span className="block text-xs text-zinc-400">
                        {q.partnerCountry}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 tabular-nums">
                    {q.quotationDate ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 tabular-nums">
                    {q.validUntil ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-zinc-900 tabular-nums">
                    {formatMoney(q.total, q.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[q.status] ?? "zinc"}>
                      {labelOf(QUOTATION_STATUS, q.status)}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Link
                      href={`/sales-orders/new?from=${q.id}`}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      → 수주
                    </Link>
                    <span className="mx-1.5 text-zinc-300">·</span>
                    <Link
                      href={`/quotations/${q.id}/print`}
                      className="text-xs text-zinc-500 hover:text-blue-700 hover:underline"
                    >
                      인쇄
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-zinc-400">
        P1 진행 중 · 견적번호 클릭 = 수정 · &ldquo;문의&rdquo; 배지 = 문의에서 참조 생성됨 · 데이터 출처: Supabase
      </p>
    </div>
  );
}
