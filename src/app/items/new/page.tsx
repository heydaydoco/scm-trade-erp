import { ItemForm } from "../ItemForm";
import { PageHeader } from "@/components/PageHeader";

export default function NewItemPage() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <PageHeader title="품목 등록" subtitle="New Item" />
      <ItemForm />
    </div>
  );
}
