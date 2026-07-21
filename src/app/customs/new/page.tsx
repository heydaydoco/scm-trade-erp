import Link from "next/link";
import { notFound } from "next/navigation";
import { getShipment } from "@/services/shipments";
import { PageHeader } from "@/components/PageHeader";
import { CustomsDeclForm } from "../CustomsDeclForm";

export const dynamic = "force-dynamic";

/**
 * 통관신고 등록 — 선적 앵커(?shipment=). 선적 없이는 시작할 수 없다(hard FK).
 * 취소된 선적에는 작성 불가(RPC 도 거부하지만 진입 단계에서 안내).
 */
export default async function NewCustomsDeclarationPage({
  searchParams,
}: {
  searchParams: Promise<{ shipment?: string }>;
}) {
  const sp = await searchParams;
  const shipmentId = sp.shipment;

  if (!shipmentId) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <PageHeader title="통관신고 등록" />
        <p className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
          통관신고는 선적을 앵커로 작성합니다. 먼저 선적을 선택하세요 —{" "}
          <Link href="/shipments" className="text-blue-700 hover:underline">
            선적 목록 →
          </Link>
        </p>
      </div>
    );
  }

  const shipment = await getShipment(shipmentId);
  if (!shipment) notFound();

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <PageHeader title="통관신고 등록" subtitle={shipment.shipNumber ?? undefined} />
      <div className="-mt-2 mb-4">
        <Link
          href={`/shipments/${shipment.id}`}
          className="text-sm text-blue-700 hover:underline"
        >
          ← 선적 상세
        </Link>
      </div>

      {shipment.status === "cancelled" ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-4 text-sm text-red-700">
          취소된 선적에는 통관신고를 작성할 수 없습니다.
        </p>
      ) : (
        <CustomsDeclForm
          shipmentId={shipment.id}
          shipmentNo={shipment.shipNumber}
          shipmentDirection={shipment.direction}
        />
      )}
    </div>
  );
}
