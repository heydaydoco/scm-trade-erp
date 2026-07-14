import { listPartners } from "@/services/partners";
import { listSalesOrders, getSalesOrder } from "@/services/salesOrders";
import { listPurchaseOrders, getPurchaseOrder } from "@/services/purchaseOrders";
import {
  buildShipmentDraftFromSalesOrder,
  buildShipmentDraftFromPurchaseOrder,
} from "@/services/shipments";
import type { ShipmentInput } from "@/services/types";
import { ShipmentForm, type OrderOption } from "../ShipmentForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function NewShipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ fromSo?: string; fromPo?: string }>;
}) {
  const { fromSo, fromPo } = await searchParams;
  const [partners, sos, pos] = await Promise.all([
    listPartners(),
    listSalesOrders(),
    listPurchaseOrders(),
  ]);

  // 원칙 3 — 주문에서 부킹 생성: ?fromSo=(export) / ?fromPo=(import) 면 그 주문을 자동 연결
  let draft: ShipmentInput | undefined;
  if (fromSo) {
    const so = await getSalesOrder(fromSo);
    if (so) draft = buildShipmentDraftFromSalesOrder(so);
  } else if (fromPo) {
    const po = await getPurchaseOrder(fromPo);
    if (po) draft = buildShipmentDraftFromPurchaseOrder(po);
  }

  const partnerOptions = partners.map((p) => ({
    id: p.id,
    name: p.name,
    country: p.country,
  }));
  // 연결 후보 = 모든 수주·발주(direction과 무관하게 둘 다 제공 — 3자무역·직송 대응)
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
      <PageHeader
        title="선적 부킹"
        subtitle={draft ? "주문에서 생성" : "New Shipment"}
      />
      <ShipmentForm
        draft={draft}
        partners={partnerOptions}
        orderOptions={orderOptions}
      />
    </div>
  );
}
