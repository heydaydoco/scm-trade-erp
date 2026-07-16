import Link from "next/link";
import { listSalesOrders } from "@/services/salesOrders";
import type { SalesOrder } from "@/services/types";
import { PageHeader } from "@/components/PageHeader";
import { Badge, type BadgeVariant } from "@/components/Badge";
// 표시엔 SO_STATUS_ALL — 기계 전용 partial(부분출고)까지 라벨이 나와야 한다.
// (폼 선택지는 SO_STATUS 로 partial 을 제외한다)
import { CURRENCY_SYMBOL, SO_STATUS_ALL, labelOf } from "@/services/codes";

// 항상 요청 시점에 최신 데이터를 읽는다.
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: "zinc",
  confirmed: "blue",
  completed: "green",
  cancelled: "red",
};

function formatMoney(amount: number, currency: string | null): string {
  const symbol = currency ? CURRENCY_SYMBOL[currency] ?? "" : "";
  return `${symbol}${amount.toLocaleString()}${currency ? ` ${currency}` : ""}`;
}

export default async function SalesOrdersPage() {
  let salesOrders: SalesOrder[] = [];
  let errorMessage: string | null = null;

  try {
    salesOrders = await listSalesOrders();
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader
        title="수주"
        subtitle="Sales Orders"
        count={errorMessage ? undefined : salesOrders.length}
        action={{ href: "/sales-orders/new", label: "+ 수주 등록" }}
      />

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">데이터를 불러오지 못했습니다.</p>
          <p className="mt-1 break-all text-red-600">{errorMessage}</p>
          <p className="mt-2 text-xs text-red-500">
            sales_orders 테이블이 아직 없다면 db/migrations/p2.2_sales_orders.sql 을
            Supabase에서 먼저 실행하세요. (무료티어 정지 시 대시보드에서 Restore)
          </p>
        </div>
      ) : salesOrders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          등록된 수주가 없습니다. 견적 화면의 &ldquo;→ 수주&rdquo; 또는 우측 상단 &ldquo;+ 수주 등록&rdquo;으로 추가하세요.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">수주번호</th>
                <th className="px-4 py-3 font-medium">거래처</th>
                <th className="px-4 py-3 font-medium">주문일</th>
                <th className="px-4 py-3 font-medium">납기 요청일</th>
                <th className="px-4 py-3 font-medium text-right">금액</th>
                <th className="px-4 py-3 font-medium">상태</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {salesOrders.map((so) => (
                <tr key={so.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/sales-orders/${so.id}`}
                      className="font-mono text-sm font-medium text-zinc-900 hover:text-blue-700 hover:underline"
                    >
                      {so.soNumber || "(번호 없음)"}
                    </Link>
                    {so.refQuotationId ? (
                      <span className="ml-2 align-middle">
                        <Badge variant="violet">견적</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {so.partnerName ?? <span className="text-zinc-300">-</span>}
                    {so.partnerCountry ? (
                      <span className="block text-xs text-zinc-400">
                        {so.partnerCountry}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 tabular-nums">
                    {so.orderDate ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 tabular-nums">
                    {so.requestedDeliveryDate ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-zinc-900 tabular-nums">
                    {formatMoney(so.total, so.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[so.status] ?? "zinc"}>
                      {labelOf(SO_STATUS_ALL, so.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/sales-orders/${so.id}/print`}
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
        P2 진행 중 · 수주번호 클릭 = 수정 · &ldquo;견적&rdquo; 배지 = 견적에서 참조 생성됨 · 데이터 출처: Supabase
      </p>
    </div>
  );
}
