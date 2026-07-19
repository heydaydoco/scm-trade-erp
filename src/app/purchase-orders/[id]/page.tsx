import { todayKst } from "@/lib/date";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPurchaseOrder } from "@/services/purchaseOrders";
import { listPartners } from "@/services/partners";
import { listItems } from "@/services/items";
import { getLatestRates } from "@/services/fxRates";
import {
  listPoOpenQty,
  listReceiptsForPo,
  countLiveReceiptsForPo,
} from "@/services/receipts";
import { countLiveShipmentLinesForPo } from "@/services/shipmentCargo";
import {
  PurchaseOrderForm,
  type ItemOption,
  type PartnerOption,
} from "../PurchaseOrderForm";
import { ReceiptPanel } from "./ReceiptPanel";
import { PageHeader } from "@/components/PageHeader";
import { flowHref } from "@/services/chainLogic";

export const dynamic = "force-dynamic";

export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [
    purchaseOrder,
    partners,
    items,
    rates,
    openLines,
    receipts,
    liveCount,
    shipmentLineCount,
  ] = await Promise.all([
    getPurchaseOrder(id),
    listPartners(),
    listItems(),
    getLatestRates(),
    listPoOpenQty(id),
    listReceiptsForPo(id),
    countLiveReceiptsForPo(id),
    countLiveShipmentLinesForPo(id),
  ]);
  if (!purchaseOrder) notFound();

  // 원칙 5(잔량 소비 가드) — 살아있는 입고 또는 **선적 화물 라인**(P4.4)이 참조
  // 중이면 발주는 잠긴다. DB 트리거가 최종 방어선이지만, 여기서 폼 자체를 감춰야
  // 사용자가 저장을 눌렀다가 날것의 DB 예외를 보는 일이 없다.
  const locked = liveCount > 0 || shipmentLineCount > 0;
  const lockReason = [
    liveCount > 0 ? "입고" : null,
    shipmentLineCount > 0 ? "선적 화물" : null,
  ]
    .filter(Boolean)
    .join("와 ");

  // PO 거래처는 공급사 — 순수 고객(customer)만 제외.
  const partnerOptions: PartnerOption[] = partners
    .filter((p) => p.type !== "customer")
    .map((p) => ({ id: p.id, name: p.name, country: p.country }));
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
          title={locked ? "발주 상세" : "발주 수정"}
          subtitle={purchaseOrder.poNumber}
        />
      </div>
      <div className="-mt-4 mb-4 flex flex-wrap gap-4">
        <Link
          href={`/purchase-orders/${purchaseOrder.id}/print`}
          className="text-sm text-blue-700 hover:underline"
        >
          🖨 발주서(Purchase Order) 보기 →
        </Link>
        <Link
          href={`/shipments/new?fromPo=${purchaseOrder.id}`}
          className="text-sm font-medium text-sky-700 hover:underline"
        >
          🚢 이 발주로 선적 부킹 →
        </Link>
        {purchaseOrder.refSalesOrderId ? (
          <Link
            href={`/sales-orders/${purchaseOrder.refSalesOrderId}`}
            className="text-sm text-violet-700 hover:underline"
          >
            📄 출처 수주 보기 →
          </Link>
        ) : null}
        <Link
          href={flowHref("purchaseOrder", purchaseOrder.id)}
          className="text-sm font-medium text-indigo-700 hover:underline"
        >
          🔗 문서 흐름 →
        </Link>
      </div>
      {locked ? (
        // 잠긴 발주는 폼을 렌더하지 않는다 — 고칠 수 없는 폼을 보여주는 게 더 나쁘다.
        // 내용은 아래 잔량표 + 발주서 인쇄로 확인한다.
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
          🔒 {lockReason}이 참조 중이라 수정 폼이 잠겼습니다.
          <div className="mt-1 text-xs text-slate-500">
            내용은 <Link href={`/purchase-orders/${purchaseOrder.id}/print`} className="underline">발주서 보기</Link>에서
            확인하세요. 고쳐야 하면
            {liveCount > 0 && " 아래 입고 이력에서 해당 입고를 취소"}
            {liveCount > 0 && shipmentLineCount > 0 && "하고,"}
            {shipmentLineCount > 0 &&
              " 해당 선적의 '화물 내역'에서 이 발주의 라인을 삭제"}
            하세요.
          </div>
        </div>
      ) : (
        <PurchaseOrderForm
          purchaseOrder={purchaseOrder}
          partners={partnerOptions}
          items={itemOptions}
          defaultDate={today}
          rates={rates}
        />
      )}

      <ReceiptPanel
        poId={purchaseOrder.id}
        openLines={openLines}
        receipts={receipts}
        liveCount={liveCount}
        shipmentLineCount={shipmentLineCount}
      />
    </div>
  );
}
