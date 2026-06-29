import { notFound } from "next/navigation";
import { getPartner } from "@/services/partners";
import { PartnerForm } from "../PartnerForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function EditPartnerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const partner = await getPartner(id);
  if (!partner) notFound();

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <PageHeader title="거래처 수정" subtitle={partner.name} />
      <PartnerForm partner={partner} />
    </div>
  );
}
