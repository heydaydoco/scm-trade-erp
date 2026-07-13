import { listPartners } from "@/services/partners";
import { listItems } from "@/services/items";
import { getQuotation } from "@/services/quotations";
import { buildSalesOrderDraftFromQuotation } from "@/services/salesOrders";
import type { SalesOrderInput } from "@/services/types";
import {
  SalesOrderForm,
  type ItemOption,
  type PartnerOption,
} from "../SalesOrderForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function NewSalesOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const [partners, items] = await Promise.all([listPartners(), listItems()]);

  // 원칙 3 — 견적에서 참조 생성: ?from={quotationId} 면 견적 데이터로 초안 시드
  let draft: SalesOrderInput | undefined;
  if (from) {
    const quotation = await getQuotation(from);
    if (quotation) draft = buildSalesOrderDraftFromQuotation(quotation);
  }

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
      <PageHeader
        title="수주 등록"
        subtitle={draft ? "견적에서 참조 생성" : "New Sales Order"}
      />
      <SalesOrderForm
        draft={draft}
        partners={partnerOptions}
        items={itemOptions}
        defaultDate={today}
      />
    </div>
  );
}
