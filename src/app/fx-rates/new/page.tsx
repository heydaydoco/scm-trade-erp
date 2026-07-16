import { todayKst } from "@/lib/date";
import { FxRateForm } from "../FxRateForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default function NewFxRatePage() {
  const today = todayKst();
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <PageHeader title="환율 등록" subtitle="New FX Rate" />
      <FxRateForm defaultDate={today} />
    </div>
  );
}
