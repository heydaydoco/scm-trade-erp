import { notFound } from "next/navigation";
import { getShipment } from "@/services/shipments";
import { listPartners } from "@/services/partners";
import { listSalesOrders } from "@/services/salesOrders";
import { listPurchaseOrders } from "@/services/purchaseOrders";
import { ShipmentForm, type OrderOption } from "../ShipmentForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function EditShipmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [shipment, partners, sos, pos] = await Promise.all([
    getShipment(id),
    listPartners(),
    listSalesOrders(),
    listPurchaseOrders(),
  ]);
  if (!shipment) notFound();

  const partnerOptions = partners.map((p) => ({
    id: p.id,
    name: p.name,
    country: p.country,
  }));
  const orderOptions: OrderOption[] = [
    ...sos.map((s) => ({
      type: "SO",
      id: s.id,
      number: s.soNumber,
      partnerName: s.partnerName,
    })),
    ...pos.map((p) => ({
      type: "PO",
      id: p.id,
      number: p.poNumber,
      partnerName: p.partnerName,
    })),
  ];

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader title="선적 수정" subtitle={shipment.shipNumber} />
      <div className="mt-4">
        <ShipmentForm
          shipment={shipment}
          partners={partnerOptions}
          orderOptions={orderOptions}
        />
      </div>
    </div>
  );
}
