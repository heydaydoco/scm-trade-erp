import { notFound } from "next/navigation";
import { getShipment } from "@/services/shipments";
import { listPartners } from "@/services/partners";
import { listSalesOrders } from "@/services/salesOrders";
import { listPurchaseOrders } from "@/services/purchaseOrders";
import {
  getShipmentCargo,
  listShippableOrderLines,
} from "@/services/shipmentCargo";
import type { PartnerLike, SellerLike } from "@/services/cargoLogic";
import { SELLER } from "@/config/company";
import Link from "next/link";
import { ShipmentForm, type OrderOption } from "../ShipmentForm";
import { CargoCard } from "./CargoCard";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function EditShipmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [shipment, partners, sos, pos, cargo, shippable] = await Promise.all([
    getShipment(id),
    listPartners(),
    listSalesOrders(),
    listPurchaseOrders(),
    getShipmentCargo(id),
    listShippableOrderLines(id),
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

  // ★ 화물 라인이 달린 주문은 연결 해제 불가(원칙 5 소비 가드의 UI 층 —
  //   DB 지연 트리거가 최종 방어선, 여기선 ✕ 를 잠가 날것의 예외를 예방).
  //   취소된 선적은 잠그지 않는다 — DB 가드도 취소 선적의 라인을 "살아있는" 것으로
  //   치지 않는데 UI 만 잠그면, 읽기전용 화물 카드 때문에 풀 수 없는 교착이 된다.
  const lineToOrder = new Map(
    shippable.map((s) => [s.orderLineId, `${s.orderType}::${s.orderId}`]),
  );
  const lockedOrderKeys =
    shipment.status === "cancelled"
      ? []
      : Array.from(
          new Set(
            cargo.lines
              .map((l) => (l.orderLineId ? lineToOrder.get(l.orderLineId) : null))
              .filter((v): v is string => !!v),
          ),
        );

  // 당사자 프리필용 — 스냅샷의 재료(마스터는 초기값·불러오기 버튼에만 쓰인다).
  const partnerRow = shipment.partnerId
    ? partners.find((p) => p.id === shipment.partnerId) ?? null
    : null;
  const partnerLike: PartnerLike | null = partnerRow
    ? {
        id: partnerRow.id,
        name: partnerRow.name,
        address: partnerRow.address,
        city: partnerRow.city,
        country: partnerRow.country,
        contactName: partnerRow.contactName,
        contactEmail: partnerRow.contactEmail,
        contactPhone: partnerRow.contactPhone,
      }
    : null;
  const sellerLike: SellerLike = {
    name: SELLER.name,
    addressLines: [...SELLER.addressLines],
    tel: SELLER.tel,
    email: SELLER.email,
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader title="선적 수정" subtitle={shipment.shipNumber} />
      <div className="-mt-2 mb-4">
        <Link
          href={`/shipments/${shipment.id}/print`}
          className="text-sm text-blue-700 hover:underline"
        >
          🖨 S/I (Shipping Instruction) 보기 →
        </Link>
      </div>
      <div className="mt-4">
        <ShipmentForm
          shipment={shipment}
          partners={partnerOptions}
          orderOptions={orderOptions}
          lockedOrderKeys={lockedOrderKeys}
        />
      </div>

      <CargoCard
        shipmentId={shipment.id}
        direction={shipment.direction}
        cancelled={shipment.status === "cancelled"}
        initialLines={cargo.lines}
        initialParties={cargo.parties}
        initialMarks={cargo.shippingMarks}
        shippable={shippable}
        partner={partnerLike}
        seller={sellerLike}
      />
    </div>
  );
}
