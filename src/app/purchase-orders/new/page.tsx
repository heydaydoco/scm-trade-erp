import { listPartners } from "@/services/partners";
import { listItems } from "@/services/items";
import { getSalesOrder } from "@/services/salesOrders";
import { buildPurchaseOrderDraftFromSalesOrder } from "@/services/purchaseOrders";
import { getLatestRates } from "@/services/fxRates";
import type { PurchaseOrderInput } from "@/services/types";
import {
  PurchaseOrderForm,
  type ItemOption,
  type PartnerOption,
} from "../PurchaseOrderForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const [partners, items, rates] = await Promise.all([
    listPartners(),
    listItems(),
    getLatestRates(),
  ]);

  // 원칙 3 — 수주에서 참조 생성: ?from={salesOrderId} 면 수주 데이터로 초안 시드
  let draft: PurchaseOrderInput | undefined;
  if (from) {
    const salesOrder = await getSalesOrder(from);
    if (salesOrder) draft = buildPurchaseOrderDraftFromSalesOrder(salesOrder);
  }

  // PO 거래처는 공급사 — 순수 고객(customer)만 제외(공급사·both·미분류는 표시).
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
      <PageHeader
        title="발주 등록"
        subtitle={draft ? "수주에서 참조 생성" : "New Purchase Order"}
      />
      <PurchaseOrderForm
        draft={draft}
        partners={partnerOptions}
        items={itemOptions}
        defaultDate={today}
        rates={rates}
      />
    </div>
  );
}
