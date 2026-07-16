import Link from "next/link";
import { notFound } from "next/navigation";
import { getDelivery } from "@/services/deliveries";
import { listStockMovements } from "@/services/stock";
import { DELIVERY_STATUS, labelOf } from "@/services/codes";
import { PageHeader } from "@/components/PageHeader";
import { CancelDeliveryButton } from "./CancelDeliveryButton";

export const dynamic = "force-dynamic";

/**
 * 출고 상세 — 라인 + **이 출고가 만든 원장 행** + 취소 (P4.2 입고 상세 미러).
 * 수정 화면이 없다(원칙 1·5): 잘못 넣었으면 취소하고 다시 등록한다.
 */
export default async function DeliveryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const delivery = await getDelivery(id);
  if (!delivery) notFound();

  // 이 출고가 전기한 원장 행(취소했다면 REVERSAL 도 함께 보인다 — 사실을 그대로).
  // ⚠️ DB에서 좁힌다 — 받아서 JS로 거르면 limit 밖 행이 "없음"으로 보인다.
  //    (REVERSAL 은 원행의 ref_* 를 승계하므로 같은 조건에 함께 걸린다)
  const movements = await listStockMovements({
    refDocType: "delivery",
    refDocId: id,
  });

  const cancelled = delivery.status === "cancelled";
  const total = delivery.lines.reduce((s, l) => s + l.qty, 0);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <PageHeader title="출고 상세" subtitle={delivery.deliveryNo} />
        <span
          className={`rounded px-2 py-1 text-sm ${
            cancelled ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {labelOf(DELIVERY_STATUS, delivery.status)}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap gap-4 text-sm">
        <Link
          href={`/deliveries/${delivery.id}/print`}
          className="text-blue-700 hover:underline"
        >
          🖨 거래명세서(Delivery Note) 보기 →
        </Link>
        <Link
          href={`/sales-orders/${delivery.refDocId}`}
          className="text-violet-700 hover:underline"
        >
          📄 출처 수주 보기 ({delivery.soNumber ?? "—"}) →
        </Link>
        <Link href="/stock/movements" className="text-slate-600 hover:underline">
          📒 재고 원장 →
        </Link>
      </div>

      <dl className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">증빙일</dt>
          <dd>{delivery.deliveryDate}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">창고</dt>
          <dd>{delivery.warehouseCode}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">고객</dt>
          <dd>{delivery.partnerName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">총 수량</dt>
          <dd className="tabular-nums">{cancelled ? <s>{total}</s> : total}</dd>
        </div>
        {delivery.memo && (
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-xs text-slate-500">비고</dt>
            <dd className="text-slate-700">{delivery.memo}</dd>
          </div>
        )}
      </dl>

      <h2 className="mb-2 text-sm font-semibold text-slate-900">출고 품목</h2>
      <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">품목</th>
              <th className="px-4 py-2 text-right">수량</th>
              <th className="px-4 py-2">단위</th>
              <th className="px-4 py-2">로트</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {delivery.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2 text-slate-400">{l.lineNo}</td>
                <td className="px-4 py-2">{l.itemName ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{l.qty}</td>
                <td className="px-4 py-2 text-slate-500">{l.uom}</td>
                <td className="px-4 py-2 text-slate-500">{l.lotNo ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mb-6 text-xs text-slate-500">
        출고 라인의 수량은 항상 양수입니다 — <b>부호는 원장이 유형(DLV_OUT)으로 정합니다</b>.
        단가·금액은 출고 문서에 저장하지 않습니다(거래명세서가 수주 라인에서 참조해 표시).
      </p>

      <h2 className="mb-2 text-sm font-semibold text-slate-900">
        이 출고가 만든 재고 원장
      </h2>
      <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">증빙일</th>
              <th className="px-4 py-2">유형</th>
              <th className="px-4 py-2">품목</th>
              <th className="px-4 py-2 text-right">수량</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {movements.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-slate-400">
                  원장 행이 없습니다.
                </td>
              </tr>
            )}
            {movements.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2 text-slate-600">{m.movedAt}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      m.movementType === "REVERSAL"
                        ? "bg-slate-100 text-slate-600"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {m.movementType === "REVERSAL" ? "역분개" : "판매 출고"}
                  </span>
                </td>
                <td className="px-4 py-2">{m.itemName ?? "—"}</td>
                <td
                  className={`px-4 py-2 text-right font-medium tabular-nums ${
                    m.qty < 0 ? "text-amber-700" : "text-emerald-700"
                  }`}
                >
                  {m.qty > 0 ? `+${m.qty}` : m.qty} {m.uom}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mb-6 text-xs text-slate-500">
        {cancelled
          ? "취소된 출고입니다 — 원장의 출고 행은 지워지지 않고, 반대부호 역분개 행이 추가되어 재고가 원복되었습니다(원칙 1)."
          : "출고 저장과 원장 전기는 한 트랜잭션입니다 — 출고만 남거나 원장만 남는 상태가 존재할 수 없습니다."}
      </p>

      {!cancelled && (
        <CancelDeliveryButton
          deliveryId={delivery.id}
          deliveryNo={delivery.deliveryNo}
        />
      )}
    </div>
  );
}
