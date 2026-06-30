import Link from "next/link";
import { notFound } from "next/navigation";
import { getQuotation } from "@/services/quotations";
import { listPartners } from "@/services/partners";
import { listItems } from "@/services/items";
import {
  QuotationForm,
  type ItemOption,
  type PartnerOption,
} from "../QuotationForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function EditQuotationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [quotation, partners, items] = await Promise.all([
    getQuotation(id),
    listPartners(),
    listItems(),
  ]);
  if (!quotation) notFound();

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
        <PageHeader title="견적 수정" subtitle={quotation.quotationNumber} />
      </div>
      <div className="-mt-4 mb-4">
        <Link
          href={`/quotations/${quotation.id}/print`}
          className="text-sm text-blue-700 hover:underline"
        >
          🖨 인쇄용 견적서(Proforma Invoice) 보기 →
        </Link>
      </div>
      <QuotationForm
        quotation={quotation}
        partners={partnerOptions}
        items={itemOptions}
        defaultDate={today}
      />
    </div>
  );
}
