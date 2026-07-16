import Link from "next/link";
import { notFound } from "next/navigation";
import { getSalesOrder } from "@/services/salesOrders";
import {
  listSoOpenQty,
  prefillQty,
  countLiveDeliveriesForSo,
} from "@/services/deliveries";
import { listStockOnHand } from "@/services/stock";
import { todayKst } from "@/lib/date";
import { PageHeader } from "@/components/PageHeader";
import {
  DeliveryForm,
  type DeliveryFormLine,
  type OnHandRow,
} from "../DeliveryForm";

export const dynamic = "force-dynamic";

/**
 * 출고 등록 — 수주 **참조 생성**(원칙 3, `?fromSo=`).
 * 수주 없이 단독 출고는 만들지 않는다: 재고 감소는 반드시 선행 전표를 갖는다.
 */
export default async function NewDeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ fromSo?: string }>;
}) {
  const sp = await searchParams;
  const soId = sp.fromSo;
  if (!soId) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <PageHeader title="출고 등록" subtitle="Delivery" />
        <p className="rounded-md bg-slate-50 px-4 py-6 text-sm text-slate-600">
          출고는 수주에서 시작합니다.{" "}
          <Link href="/sales-orders" className="underline">
            수주 목록
          </Link>
          에서 수주를 열고 <b>[이 수주로 출고 등록]</b>을 누르세요.
          <div className="mt-1 text-xs text-slate-500">
            수기 재입력 화면을 만들지 않는 것이 ERP 사고방식의 핵심입니다(원칙 3).
          </div>
        </p>
      </div>
    );
  }

  const [so, openLines, liveCount, onHand] = await Promise.all([
    getSalesOrder(soId),
    listSoOpenQty(soId),
    countLiveDeliveriesForSo(soId),
    listStockOnHand({ includeZero: true }),
  ]);
  if (!so) notFound();

  if (so.status === "cancelled") {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <PageHeader title="출고 등록" subtitle={so.soNumber} />
        <p className="rounded-md bg-red-50 px-4 py-6 text-sm text-red-700">
          취소된 수주는 출고할 수 없습니다.
        </p>
      </div>
    );
  }

  const lines: DeliveryFormLine[] = openLines.map((l) => ({
    soLineId: l.soLineId,
    itemId: l.productId,
    itemName: l.productName ?? "(이름 없음)",
    uom: l.unit ?? "PCS",
    orderedQty: l.orderedQty,
    shippedQty: l.shippedQty,
    openQty: l.openQty,
    prefill: prefillQty(l.openQty),
  }));

  const warehouses = Array.from(
    new Set(["MAIN", ...onHand.map((r) => r.warehouseCode)]),
  ).sort();

  // 예상재고 계산용 현재고 — 이 수주에 걸린 품목만 넘긴다(전 품목을 브라우저로 보낼 이유가 없다).
  // ⚠️ 단위(uom)를 그대로 들고 간다. 뷰의 입도가 품목×창고×단위라 여기서 뭉개면
  //    `100 PCS − 10 KG = 90` 같은 거짓 예상재고가 나온다(P4.1f 함정).
  const lineItemIds = new Set(lines.map((l) => l.itemId).filter(Boolean));
  const onHandRows: OnHandRow[] = onHand
    .filter((r) => lineItemIds.has(r.itemId))
    .map((r) => ({
      itemId: r.itemId,
      warehouseCode: r.warehouseCode,
      uom: r.uom,
      onHand: r.onHand,
    }));

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader title="출고 등록" subtitle={`${so.soNumber} 참조`} />
      <div className="-mt-4 mb-4">
        <Link
          href={`/sales-orders/${so.id}`}
          className="text-sm text-violet-700 hover:underline"
        >
          📄 출처 수주 보기 →
        </Link>
        {liveCount > 0 && (
          <span className="ml-3 text-xs text-slate-500">
            이 수주에 이미 살아있는 출고 {liveCount}건 (부분출고 이어서 등록)
          </span>
        )}
      </div>

      <DeliveryForm
        soId={so.id}
        soNumber={so.soNumber ?? "(번호 없음)"}
        lines={lines}
        defaultDate={todayKst()}
        warehouses={warehouses}
        onHand={onHandRows}
      />
    </div>
  );
}
