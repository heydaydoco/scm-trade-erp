import Link from "next/link";
import { notFound } from "next/navigation";
import { getSalesOrder } from "@/services/salesOrders";
import { listPartners } from "@/services/partners";
import { listItems } from "@/services/items";
import { getLatestRates } from "@/services/fxRates";
import {
  SalesOrderForm,
  type ItemOption,
  type PartnerOption,
} from "../SalesOrderForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function EditSalesOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [salesOrder, partners, items, rates] = await Promise.all([
    getSalesOrder(id),
    listPartners(),
    listItems(),
    getLatestRates(),
  ]);
  if (!salesOrder) notFound();

  const partnerOptions: PartnerOption[] = partners.map((p) => ({
    id: p.id,
    name: p.name,
    country: p.country,
  }));
  const itemOptions: ItemOption[] = items
    .filter((i) => i.active)
    .map((i) => ({
      id: i.id,
      name: i.name,
      hsCode: i.hsCode,
      baseUom: i.baseUom,
      stdPrice: i.stdPrice,
    }));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <PageHeader title="수주 수정" subtitle={salesOrder.soNumber} />
      </div>
      <div className="-mt-4 mb-4 flex flex-wrap gap-4">
        <Link
          href={`/sales-orders/${salesOrder.id}/print`}
          className="text-sm text-blue-700 hover:underline"
        >
          🖨 주문확인서(Order Confirmation) 보기 →
        </Link>
        <Link
          href={`/purchase-orders/new?from=${salesOrder.id}`}
          className="text-sm font-medium text-emerald-700 hover:underline"
        >
          🛒 이 수주로 발주 생성 →
        </Link>
        <Link
          href={`/shipments/new?fromSo=${salesOrder.id}`}
          className="text-sm font-medium text-sky-700 hover:underline"
        >
          🚢 이 수주로 선적 부킹 →
        </Link>
        {salesOrder.refQuotationId ? (
          <Link
            href={`/quotations/${salesOrder.refQuotationId}`}
            className="text-sm text-violet-700 hover:underline"
          >
            📄 출처 견적 보기 →
          </Link>
        ) : null}
      </div>
      <SalesOrderForm
        salesOrder={salesOrder}
        partners={partnerOptions}
        items={itemOptions}
        defaultDate={today}
        rates={rates}
      />
    </div>
  );
}
