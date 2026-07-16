import Link from "next/link";
import { notFound } from "next/navigation";
import { getDelivery } from "@/services/deliveries";
import { getSalesOrder } from "@/services/salesOrders";
import { getPartner } from "@/services/partners";
import {
  CURRENCY_SYMBOL,
  INCOTERMS,
  PAYMENT_TERMS,
  labelOf,
  round2,
} from "@/services/codes";
import { SELLER } from "@/config/company";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

/**
 * 거래명세서 (Delivery Note / Transaction Statement) — SPEC B8.
 *
 * ★ 이 문서의 중심은 **거래처 · 품목 · 수량**이다(무엇을 언제 얼마나 보냈는가).
 *   단가·금액은 **수주 라인에서 읽어 표시만** 한다 — 출고 문서에는 저장하지 않는다.
 *   (원칙 1·2: 돈의 진실은 수주 라인 하나뿐이다. 출고에 복사해 두면 수주 단가가
 *    정정될 때 두 숫자가 갈라지고, 어느 쪽이 맞는지 아무도 모르게 된다.)
 */
function money(amount: number, currency: string | null): string {
  const symbol = currency ? (CURRENCY_SYMBOL[currency] ?? "") : "";
  return `${symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function DeliveryPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const delivery = await getDelivery(id);
  if (!delivery) notFound();

  const salesOrder = await getSalesOrder(delivery.refDocId);
  const buyer = salesOrder?.partnerId
    ? await getPartner(salesOrder.partnerId)
    : null;
  const cur = salesOrder?.currency ?? null;
  const cancelled = delivery.status === "cancelled";

  // 수주 라인 → 단가 참조(표시 전용). soLineId 는 소프트 포인터라 못 찾을 수 있다 → "-".
  const priceOf = new Map(
    (salesOrder?.lines ?? []).map((l) => [l.id, l.unitPrice]),
  );
  const rows = delivery.lines.map((l) => {
    const unitPrice = l.soLineId ? priceOf.get(l.soLineId) : undefined;
    return {
      ...l,
      unitPrice: unitPrice ?? null,
      // 금액도 저장하지 않는다 — 이번에 보낸 수량 × 수주 단가로 여기서 계산해 보여줄 뿐.
      amount: unitPrice !== undefined ? round2(l.qty * unitPrice) : null,
    };
  });
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalAmount = round2(
    rows.reduce((s, r) => s + (r.amount ?? 0), 0),
  );
  const anyPrice = rows.some((r) => r.amount !== null);

  return (
    <div className="min-h-screen bg-zinc-100 py-8">
      {/* 화면 전용 툴바 (인쇄 시 숨김) */}
      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between px-4">
        <Link
          href={`/deliveries/${delivery.id}`}
          className="text-sm text-zinc-500 hover:text-blue-700 hover:underline"
        >
          ← 출고 상세로
        </Link>
        <PrintButton />
      </div>

      {/* 인쇄 영역 (Delivery Note) */}
      <div className="mx-auto max-w-3xl bg-white px-12 py-12 text-sm leading-relaxed text-zinc-900 shadow-sm print:max-w-none print:shadow-none">
        {cancelled && (
          // 취소된 출고의 명세서가 유효한 서류처럼 보이면 안 된다 — 인쇄물에도 남긴다.
          <div className="mb-6 border-2 border-red-600 px-4 py-2 text-center">
            <p className="text-xl font-bold tracking-widest text-red-600">
              CANCELLED · 취소된 출고
            </p>
            <p className="text-xs text-red-600">
              이 출고는 취소되었고 재고는 역분개로 원복되었습니다. 유효한 거래명세서가
              아닙니다.
            </p>
          </div>
        )}

        <h1 className="text-3xl font-bold tracking-tight text-blue-800">
          DELIVERY NOTE
        </h1>
        <p className="mb-1 text-xs font-medium uppercase tracking-widest text-zinc-400">
          거래명세서
        </p>
        <p className="mb-8 font-mono text-sm text-zinc-500">
          {delivery.deliveryNo}
        </p>

        <div className="mb-8 grid grid-cols-3 gap-6">
          <div>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              From (Shipper)
            </h3>
            <p className="font-semibold">{SELLER.name}</p>
            {SELLER.addressLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <p>Tel: {SELLER.tel}</p>
            <p>Email: {SELLER.email}</p>
            <p>Biz Reg: {SELLER.bizRegNo}</p>
          </div>
          <div>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              To (Consignee)
            </h3>
            <p className="font-semibold">
              {buyer?.name ?? delivery.partnerName ?? "-"}
            </p>
            {buyer?.address ? <p>{buyer.address}</p> : null}
            <p>{[buyer?.city, buyer?.country].filter(Boolean).join(", ")}</p>
            {buyer?.contactName ? <p>Attn: {buyer.contactName}</p> : null}
            {buyer?.contactEmail ? <p>{buyer.contactEmail}</p> : null}
          </div>
          <div>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Details
            </h3>
            <p>
              <strong>Delivery Date:</strong> {delivery.deliveryDate}
            </p>
            <p>
              <strong>Sales Order:</strong> {delivery.soNumber ?? "-"}
            </p>
            <p>
              <strong>Order Date:</strong> {salesOrder?.orderDate ?? "-"}
            </p>
            <p>
              <strong>Warehouse:</strong> {delivery.warehouseCode}
            </p>
            <p>
              <strong>Incoterms:</strong>{" "}
              {salesOrder?.incoterms
                ? labelOf(INCOTERMS, salesOrder.incoterms)
                : "-"}
            </p>
            <p>
              <strong>Payment:</strong>{" "}
              {salesOrder?.paymentTerms
                ? labelOf(PAYMENT_TERMS, salesOrder.paymentTerms)
                : "-"}
            </p>
            <p>
              <strong>Destination:</strong>{" "}
              {[
                salesOrder?.destinationCountry,
                salesOrder?.destinationPort,
                salesOrder?.destinationAirport,
              ]
                .filter(Boolean)
                .join(" / ") || "-"}
            </p>
          </div>
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-blue-800 text-left text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="py-2 pr-2" style={{ width: "6%" }}>
                No.
              </th>
              <th className="py-2 pr-2" style={{ width: "40%" }}>
                Description
              </th>
              <th className="py-2 pr-2" style={{ width: "12%" }}>
                Lot
              </th>
              <th className="py-2 pr-2 text-right" style={{ width: "12%" }}>
                Qty
              </th>
              <th className="py-2 pr-2" style={{ width: "8%" }}>
                Unit
              </th>
              <th className="py-2 pr-2 text-right" style={{ width: "11%" }}>
                Unit Price
              </th>
              <th className="py-2 text-right" style={{ width: "11%" }}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-100 align-top">
                <td className="py-2 pr-2">{r.lineNo}</td>
                <td className="py-2 pr-2 font-medium">{r.itemName ?? "-"}</td>
                <td className="py-2 pr-2 font-mono text-xs">{r.lotNo ?? "-"}</td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {r.qty.toLocaleString()}
                </td>
                <td className="py-2 pr-2">{r.uom}</td>
                <td className="py-2 pr-2 text-right tabular-nums text-zinc-500">
                  {r.unitPrice !== null ? money(r.unitPrice, cur) : "-"}
                </td>
                <td className="py-2 text-right tabular-nums text-zinc-500">
                  {r.amount !== null ? money(r.amount, cur) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-blue-800 font-semibold">
              <td className="py-2 pr-2" colSpan={3}>
                TOTAL
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">
                {totalQty.toLocaleString()}
              </td>
              <td className="py-2 pr-2" />
              <td className="py-2 pr-2" />
              <td className="py-2 text-right tabular-nums">
                {anyPrice ? `${money(totalAmount, cur)} ${cur ?? ""}` : "-"}
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-3 text-[11px] text-zinc-400">
          Unit price and amount are shown for reference only, quoted from Sales Order{" "}
          {delivery.soNumber ?? "-"}. This delivery note certifies quantities shipped.
          {/* 단가·금액은 수주 라인 참조(표시 전용) — 출고 문서에 저장하지 않는다. */}
        </p>

        {delivery.memo ? (
          <div className="mt-6">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Remarks
            </h3>
            <p className="whitespace-pre-line text-xs text-zinc-600">
              {delivery.memo}
            </p>
          </div>
        ) : null}

        <div className="mt-16 grid grid-cols-2 gap-8 text-center text-sm">
          <div>
            <p className="mb-12">Shipped by</p>
            <p className="border-t border-zinc-800 pt-1.5 text-zinc-500">
              ____________________
            </p>
          </div>
          <div>
            <p className="mb-12">Received by</p>
            <p className="border-t border-zinc-800 pt-1.5 text-zinc-500">
              ____________________
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
