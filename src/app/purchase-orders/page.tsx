import Link from "next/link";
import { listPurchaseOrders } from "@/services/purchaseOrders";
import type { PurchaseOrder } from "@/services/types";
import { PageHeader } from "@/components/PageHeader";
import { Badge, type BadgeVariant } from "@/components/Badge";
import { CURRENCY_SYMBOL, PO_STATUS, labelOf } from "@/services/codes";

// 항상 요청 시점에 최신 데이터를 읽는다.
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: "zinc",
  sent: "amber",
  confirmed: "blue",
  completed: "green",
  cancelled: "red",
};

function formatMoney(amount: number, currency: string | null): string {
  const symbol = currency ? CURRENCY_SYMBOL[currency] ?? "" : "";
  return `${symbol}${amount.toLocaleString()}${currency ? ` ${currency}` : ""}`;
}

export default async function PurchaseOrdersPage() {
  let purchaseOrders: PurchaseOrder[] = [];
  let errorMessage: string | null = null;

  try {
    purchaseOrders = await listPurchaseOrders();
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader
        title="발주"
        subtitle="Purchase Orders"
        count={errorMessage ? undefined : purchaseOrders.length}
        action={{ href: "/purchase-orders/new", label: "+ 발주 등록" }}
      />

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">데이터를 불러오지 못했습니다.</p>
          <p className="mt-1 break-all text-red-600">{errorMessage}</p>
          <p className="mt-2 text-xs text-red-500">
            purchase_orders 테이블이 아직 없다면 db/migrations/p3.1_purchase_orders.sql 을
            Supabase에서 먼저 실행하세요. (무료티어 정지 시 대시보드에서 Restore)
          </p>
        </div>
      ) : purchaseOrders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          등록된 발주가 없습니다. 수주 화면의 &ldquo;→ 발주&rdquo; 또는 우측 상단 &ldquo;+ 발주 등록&rdquo;으로 추가하세요.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">발주번호</th>
                <th className="px-4 py-3 font-medium">공급사</th>
                <th className="px-4 py-3 font-medium">발주일</th>
                <th className="px-4 py-3 font-medium">납기 요청일</th>
                <th className="px-4 py-3 font-medium text-right">금액</th>
                <th className="px-4 py-3 font-medium">상태</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {purchaseOrders.map((po) => (
                <tr key={po.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/purchase-orders/${po.id}`}
                      className="font-mono text-sm font-medium text-zinc-900 hover:text-blue-700 hover:underline"
                    >
                      {po.poNumber || "(번호 없음)"}
                    </Link>
                    {po.refSalesOrderId ? (
                      <span className="ml-2 align-middle">
                        <Badge variant="violet">수주</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {po.partnerName ?? <span className="text-zinc-300">-</span>}
                    {po.partnerCountry ? (
                      <span className="block text-xs text-zinc-400">
                        {po.partnerCountry}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 tabular-nums">
                    {po.orderDate ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 tabular-nums">
                    {po.requestedDeliveryDate ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-zinc-900 tabular-nums">
                    {formatMoney(po.total, po.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[po.status] ?? "zinc"}>
                      {labelOf(PO_STATUS, po.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/purchase-orders/${po.id}/print`}
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
        P3 진행 중 · 발주번호 클릭 = 수정 · &ldquo;수주&rdquo; 배지 = 수주에서 참조 생성됨 · 데이터 출처: Supabase
      </p>
    </div>
  );
}
