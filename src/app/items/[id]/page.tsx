import { notFound } from "next/navigation";
import { getItem } from "@/services/items";
import { ItemForm } from "../ItemForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await getItem(id);
  if (!item) notFound();

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <PageHeader title="품목 수정" subtitle={item.name} />
      <ItemForm item={item} />
    </div>
  );
}
