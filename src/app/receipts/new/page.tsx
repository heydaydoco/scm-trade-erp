import Link from "next/link";
import { notFound } from "next/navigation";
import { getPurchaseOrder } from "@/services/purchaseOrders";
import {
  listPoOpenQty,
  prefillQty,
  countLiveReceiptsForPo,
} from "@/services/receipts";
import { resolveOpenLineUoms } from "@/services/items";
import { listStockOnHand } from "@/services/stock";
import { todayKst } from "@/lib/date";
import { PageHeader } from "@/components/PageHeader";
import { ReceiptForm, type ReceiptFormLine } from "../ReceiptForm";

export const dynamic = "force-dynamic";

/**
 * 입고 등록 — 발주 **참조 생성**(원칙 3, `?fromPo=`).
 * 발주 없이 단독 입고는 만들지 않는다: 재고 증가는 반드시 선행 전표를 갖는다.
 */
export default async function NewReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ fromPo?: string }>;
}) {
  const sp = await searchParams;
  const poId = sp.fromPo;
  if (!poId) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <PageHeader title="입고 등록" subtitle="Goods Receipt" />
        <p className="rounded-md bg-slate-50 px-4 py-6 text-sm text-slate-600">
          입고는 발주에서 시작합니다. <Link href="/purchase-orders" className="underline">발주 목록</Link>에서
          발주를 열고 <b>[이 발주로 입고 등록]</b>을 누르세요.
          <div className="mt-1 text-xs text-slate-500">
            수기 재입력 화면을 만들지 않는 것이 ERP 사고방식의 핵심입니다(원칙 3).
          </div>
        </p>
      </div>
    );
  }

  const [po, openLines, liveCount, onHand] = await Promise.all([
    getPurchaseOrder(poId),
    listPoOpenQty(poId),
    countLiveReceiptsForPo(poId),
    listStockOnHand({ includeZero: true }),
  ]);
  if (!po) notFound();

  if (po.status === "cancelled") {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <PageHeader title="입고 등록" subtitle={po.poNumber} />
        <p className="rounded-md bg-red-50 px-4 py-6 text-sm text-red-700">
          취소된 발주는 입고할 수 없습니다.
        </p>
      </div>
    );
  }

  // ★ P4.3f 단위 해석 — 라인 uom → 품목 마스터 unit ('PCS' 를 지어내지 않는다).
  //   저장 시 서비스가 같은 체인으로 다시 해석하므로, 여기 값 == 원장에 박히는 값.
  //   둘 다 없으면 null → 그 줄은 입고 불가로 잠근다(단위 불명 수량은 원장에 못 들어간다).
  const uoms = await resolveOpenLineUoms(openLines);
  const lines: ReceiptFormLine[] = openLines.map((l, i) => ({
    poLineId: l.poLineId,
    itemId: l.productId,
    itemName: l.productName ?? "(이름 없음)",
    uom: uoms[i],
    orderedQty: l.orderedQty,
    receivedQty: l.receivedQty,
    openQty: l.openQty,
    prefill: prefillQty(l.openQty),
  }));

  const warehouses = Array.from(
    new Set(["MAIN", ...onHand.map((r) => r.warehouseCode)]),
  ).sort();

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader title="입고 등록" subtitle={`${po.poNumber} 참조`} />
      <div className="-mt-4 mb-4">
        <Link
          href={`/purchase-orders/${po.id}`}
          className="text-sm text-violet-700 hover:underline"
        >
          📄 출처 발주 보기 →
        </Link>
        {liveCount > 0 && (
          <span className="ml-3 text-xs text-slate-500">
            이 발주에 이미 살아있는 입고 {liveCount}건 (부분입고 이어서 등록)
          </span>
        )}
      </div>

      <ReceiptForm
        poId={po.id}
        poNumber={po.poNumber ?? "(번호 없음)"}
        lines={lines}
        defaultDate={todayKst()}
        warehouses={warehouses}
      />
    </div>
  );
}
