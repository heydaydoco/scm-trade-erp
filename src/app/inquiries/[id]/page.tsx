import { notFound } from "next/navigation";
import { getInquiry } from "@/services/inquiries";
import { listPartners } from "@/services/partners";
import { listItems } from "@/services/items";
import {
  InquiryForm,
  type ItemOption,
  type PartnerOption,
} from "../InquiryForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function EditInquiryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [inquiry, partners, items] = await Promise.all([
    getInquiry(id),
    listPartners(),
    listItems(),
  ]);
  if (!inquiry) notFound();

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
    }));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <PageHeader title="문의 수정" subtitle={inquiry.productName || "문의"} />
      <InquiryForm
        inquiry={inquiry}
        partners={partnerOptions}
        items={itemOptions}
        defaultDate={today}
      />
    </div>
  );
}
