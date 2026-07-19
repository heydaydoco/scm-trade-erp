import { todayKst } from "@/lib/date";
import Link from "next/link";
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
import { flowHref } from "@/services/chainLogic";

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
  const today = todayKst();

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <PageHeader title="문의 수정" subtitle={inquiry.productName || "문의"} />
      <div className="-mt-4 mb-4 flex flex-wrap items-center gap-4">
        <Link
          href={`/quotations/new?from=${inquiry.id}`}
          className="inline-block rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
        >
          → 이 문의로 견적 생성 (참조 생성)
        </Link>
        <Link
          href={flowHref("inquiry", inquiry.id)}
          className="text-sm font-medium text-indigo-700 hover:underline"
        >
          🔗 문서 흐름 →
        </Link>
      </div>
      <InquiryForm
        inquiry={inquiry}
        partners={partnerOptions}
        items={itemOptions}
        defaultDate={today}
      />
    </div>
  );
}
