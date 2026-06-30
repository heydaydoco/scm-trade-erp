import { listPartners } from "@/services/partners";
import { listItems } from "@/services/items";
import { getInquiry } from "@/services/inquiries";
import { buildQuotationDraftFromInquiry } from "@/services/quotations";
import type { QuotationInput } from "@/services/types";
import {
  QuotationForm,
  type ItemOption,
  type PartnerOption,
} from "../QuotationForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const [partners, items] = await Promise.all([listPartners(), listItems()]);

  // 원칙 3 — 문의에서 참조 생성: ?from={inquiryId} 면 문의 데이터로 초안 시드
  let draft: QuotationInput | undefined;
  if (from) {
    const inquiry = await getInquiry(from);
    if (inquiry) draft = buildQuotationDraftFromInquiry(inquiry);
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
        title="견적 등록"
        subtitle={draft ? "문의에서 참조 생성" : "New Quotation"}
      />
      <QuotationForm
        draft={draft}
        partners={partnerOptions}
        items={itemOptions}
        defaultDate={today}
      />
    </div>
  );
}
