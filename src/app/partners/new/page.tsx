import { PartnerForm } from "../PartnerForm";
import { PageHeader } from "@/components/PageHeader";

export default function NewPartnerPage() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <PageHeader title="거래처 등록" subtitle="New Partner" />
      <PartnerForm />
    </div>
  );
}
