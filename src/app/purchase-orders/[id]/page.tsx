import Link from "next/link";
import { notFound } from "next/navigation";
import { getPurchaseOrder } from "@/services/purchaseOrders";
import { listPartners } from "@/services/partners";
import { listItems } from "@/services/items";
import { getLatestRates } from "@/services/fxRates";
import {
  PurchaseOrderForm,
  type ItemOption,
  type PartnerOption,
} from "../PurchaseOrderForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [purchaseOrder, partners, items, rates] = await Promise.all([
    getPurchaseOrder(id),
    listPartners(),
    listItems(),
    getLatestRates(),
  ]);
  if (!purchaseOrder) notFound();

  // PO 거래처는 공급사 — 순수 고객(customer)만 제외.
  const partnerOptions: PartnerOption[] = partners
    .filter((p) => p.type !== "customer")
    .map((p) => ({ id: p.id, name: p.name, country: p.country }));
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
        <PageHeader title="발주 수정" subtitle={purchaseOrder.poNumber} />
      </div>
      <div className="-mt-4 mb-4 flex flex-wrap gap-4">
        <Link
          href={`/purchase-orders/${purchaseOrder.id}/print`}
          className="text-sm text-blue-700 hover:underline"
        >
          🖨 발주서(Purchase Order) 보기 →
        </Link>
        {purchaseOrder.refSalesOrderId ? (
          <Link
            href={`/sales-orders/${purchaseOrder.refSalesOrderId}`}
            className="text-sm text-violet-700 hover:underline"
          >
            📄 출처 수주 보기 →
          </Link>
        ) : null}
      </div>
      <PurchaseOrderForm
        purchaseOrder={purchaseOrder}
        partners={partnerOptions}
        items={itemOptions}
        defaultDate={today}
        rates={rates}
      />
    </div>
  );
}
