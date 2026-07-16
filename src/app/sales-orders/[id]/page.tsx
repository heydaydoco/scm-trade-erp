import { todayKst } from "@/lib/date";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSalesOrder } from "@/services/salesOrders";
import { listPartners } from "@/services/partners";
import { listItems } from "@/services/items";
import { getLatestRates } from "@/services/fxRates";
import {
  listSoOpenQty,
  listDeliveriesForSo,
  countLiveDeliveriesForSo,
} from "@/services/deliveries";
import { countLiveShipmentLinesForSo } from "@/services/shipmentCargo";
import {
  SalesOrderForm,
  type ItemOption,
  type PartnerOption,
} from "../SalesOrderForm";
import { DeliveryPanel } from "./DeliveryPanel";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function EditSalesOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [
    salesOrder,
    partners,
    items,
    rates,
    openLines,
    deliveries,
    liveCount,
    shipmentLineCount,
  ] = await Promise.all([
    getSalesOrder(id),
    listPartners(),
    listItems(),
    getLatestRates(),
    listSoOpenQty(id),
    listDeliveriesForSo(id),
    countLiveDeliveriesForSo(id),
    countLiveShipmentLinesForSo(id),
  ]);
  if (!salesOrder) notFound();

  // 원칙 5(잔량 소비 가드) — 살아있는 출고 또는 **선적 화물 라인**(P4.4)이 참조
  // 중이면 수주는 잠긴다. DB 트리거가 최종 방어선이지만, 여기서 폼 자체를 감춰야
  // 사용자가 저장을 눌렀다가 날것의 DB 예외를 보는 일이 없다.
  const locked = liveCount > 0 || shipmentLineCount > 0;
  const lockReason = [
    liveCount > 0 ? "출고" : null,
    shipmentLineCount > 0 ? "선적 화물" : null,
  ]
    .filter(Boolean)
    .join("와 ");

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
      stdPrice: i.stdPrice,
    }));
  const today = todayKst();

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <PageHeader
          title={locked ? "수주 상세" : "수주 수정"}
          subtitle={salesOrder.soNumber}
        />
      </div>
      <div className="-mt-4 mb-4 flex flex-wrap gap-4">
        <Link
          href={`/sales-orders/${salesOrder.id}/print`}
          className="text-sm text-blue-700 hover:underline"
        >
          🖨 주문확인서(Order Confirmation) 보기 →
        </Link>
        <Link
          href={`/purchase-orders/new?from=${salesOrder.id}`}
          className="text-sm font-medium text-emerald-700 hover:underline"
        >
          🛒 이 수주로 발주 생성 →
        </Link>
        <Link
          href={`/shipments/new?fromSo=${salesOrder.id}`}
          className="text-sm font-medium text-sky-700 hover:underline"
        >
          🚢 이 수주로 선적 부킹 →
        </Link>
        {salesOrder.refQuotationId ? (
          <Link
            href={`/quotations/${salesOrder.refQuotationId}`}
            className="text-sm text-violet-700 hover:underline"
          >
            📄 출처 견적 보기 →
          </Link>
        ) : null}
      </div>

      {locked ? (
        // 잠긴 수주는 폼을 렌더하지 않는다 — 고칠 수 없는 폼을 보여주는 게 더 나쁘다.
        // 내용은 아래 잔량표 + 주문확인서 인쇄로 확인한다.
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
          🔒 {lockReason}이 참조 중이라 수정 폼이 잠겼습니다.
          <div className="mt-1 text-xs text-slate-500">
            내용은{" "}
            <Link href={`/sales-orders/${salesOrder.id}/print`} className="underline">
              주문확인서 보기
            </Link>
            에서 확인하세요. 고쳐야 하면
            {liveCount > 0 && " 아래 출고 이력에서 해당 출고를 취소"}
            {liveCount > 0 && shipmentLineCount > 0 && "하고,"}
            {shipmentLineCount > 0 &&
              " 해당 선적의 '화물 내역'에서 이 수주의 라인을 삭제"}
            하세요.
          </div>
        </div>
      ) : (
        <SalesOrderForm
          salesOrder={salesOrder}
          partners={partnerOptions}
          items={itemOptions}
          defaultDate={today}
          rates={rates}
        />
      )}

      <DeliveryPanel
        soId={salesOrder.id}
        openLines={openLines}
        deliveries={deliveries}
        liveCount={liveCount}
        shipmentLineCount={shipmentLineCount}
      />
    </div>
  );
}
