import Link from "next/link";
import { notFound } from "next/navigation";
import { getPurchaseOrder } from "@/services/purchaseOrders";
import { getPartner } from "@/services/partners";
import { CURRENCY_SYMBOL, INCOTERMS, PAYMENT_TERMS, labelOf } from "@/services/codes";
import { SELLER } from "@/config/company";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

function money(amount: number, currency: string | null): string {
  const symbol = currency ? CURRENCY_SYMBOL[currency] ?? "" : "";
  return `${symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function PurchaseOrderPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const purchaseOrder = await getPurchaseOrder(id);
  if (!purchaseOrder) notFound();

  // 발주서: 우리(SELLER)가 Buyer, 상대(partner)가 Supplier.
  const supplier = purchaseOrder.partnerId
    ? await getPartner(purchaseOrder.partnerId)
    : null;
  const cur = purchaseOrder.currency;

  return (
    <div className="min-h-screen bg-zinc-100 py-8">
      {/* 화면 전용 툴바 (인쇄 시 숨김) */}
      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between px-4">
        <Link
          href={`/purchase-orders/${purchaseOrder.id}`}
          className="text-sm text-zinc-500 hover:text-blue-700 hover:underline"
        >
          ← 발주 수정으로
        </Link>
        <PrintButton />
      </div>

      {/* 인쇄 영역 (Purchase Order) */}
      <div className="mx-auto max-w-3xl bg-white px-12 py-12 text-sm leading-relaxed text-zinc-900 shadow-sm print:max-w-none print:shadow-none">
        <h1 className="text-3xl font-bold tracking-tight text-blue-800">
          PURCHASE ORDER
        </h1>
        <p className="mb-8 font-mono text-sm text-zinc-500">
          {purchaseOrder.poNumber}
        </p>

        <div className="mb-8 grid grid-cols-3 gap-6">
          <div>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              From (Buyer)
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
              To (Supplier)
            </h3>
            <p className="font-semibold">
              {supplier?.name ?? purchaseOrder.partnerName ?? "-"}
            </p>
            {supplier?.address ? <p>{supplier.address}</p> : null}
            <p>{[supplier?.city, supplier?.country].filter(Boolean).join(", ")}</p>
            {supplier?.contactName ? <p>Attn: {supplier.contactName}</p> : null}
            {supplier?.contactEmail ? <p>{supplier.contactEmail}</p> : null}
          </div>
          <div>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Details
            </h3>
            <p>
              <strong>Order Date:</strong> {purchaseOrder.orderDate ?? "-"}
            </p>
            <p>
              <strong>Delivery By:</strong>{" "}
              {purchaseOrder.requestedDeliveryDate ?? "-"}
            </p>
            <p>
              <strong>Currency:</strong> {cur ?? "-"}
            </p>
            <p>
              <strong>Incoterms:</strong>{" "}
              {purchaseOrder.incoterms
                ? labelOf(INCOTERMS, purchaseOrder.incoterms)
                : "-"}
            </p>
            <p>
              <strong>Payment:</strong>{" "}
              {purchaseOrder.paymentTerms
                ? labelOf(PAYMENT_TERMS, purchaseOrder.paymentTerms)
                : "-"}
            </p>
            <p>
              <strong>Destination:</strong>{" "}
              {[
                purchaseOrder.destinationCountry,
                purchaseOrder.destinationPort,
                purchaseOrder.destinationAirport,
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
              <th className="py-2 pr-2" style={{ width: "38%" }}>
                Description
              </th>
              <th className="py-2 pr-2" style={{ width: "14%" }}>
                HS Code
              </th>
              <th className="py-2 pr-2 text-right" style={{ width: "10%" }}>
                Qty
              </th>
              <th className="py-2 pr-2" style={{ width: "8%" }}>
                Unit
              </th>
              <th className="py-2 pr-2 text-right" style={{ width: "12%" }}>
                Unit Price
              </th>
              <th className="py-2 text-right" style={{ width: "12%" }}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {purchaseOrder.lines.map((l) => (
              <tr key={l.id} className="border-b border-zinc-100 align-top">
                <td className="py-2 pr-2">{l.lineNo}</td>
                <td className="py-2 pr-2">
                  <span className="font-medium">{l.productName}</span>
                  {l.description ? (
                    <span className="block text-xs text-zinc-500">
                      {l.description}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-2 font-mono text-xs">{l.hsCode ?? "-"}</td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {l.quantity.toLocaleString()}
                </td>
                <td className="py-2 pr-2">{l.unit ?? "-"}</td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {money(l.unitPrice, cur)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {money(l.amount, cur)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="tabular-nums">
                {money(purchaseOrder.subtotal, cur)}
              </span>
            </div>
            {purchaseOrder.discount > 0 ? (
              <div className="flex justify-between text-red-600">
                <span>Discount</span>
                <span className="tabular-nums">
                  -{money(purchaseOrder.discount, cur)}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between border-t-2 border-blue-800 pt-2 text-base font-bold text-blue-800">
              <span>TOTAL</span>
              <span className="tabular-nums">
                {money(purchaseOrder.total, cur)} {cur ?? ""}
              </span>
            </div>
          </div>
        </div>

        {purchaseOrder.termsConditions ? (
          <div className="mt-8 border-t border-zinc-200 pt-4">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Terms &amp; Conditions
            </h3>
            <p className="whitespace-pre-line text-xs text-zinc-600">
              {purchaseOrder.termsConditions}
            </p>
          </div>
        ) : null}

        {purchaseOrder.notes ? (
          <div className="mt-4">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Notes
            </h3>
            <p className="whitespace-pre-line text-xs text-zinc-600">
              {purchaseOrder.notes}
            </p>
          </div>
        ) : null}

        <div className="mt-16 grid grid-cols-2 gap-8 text-center text-sm">
          <div>
            <p className="mb-12">Buyer (Ordered by)</p>
            <p className="border-t border-zinc-800 pt-1.5 text-zinc-500">
              ____________________
            </p>
          </div>
          <div>
            <p className="mb-12">Supplier (Accepted by)</p>
            <p className="border-t border-zinc-800 pt-1.5 text-zinc-500">
              ____________________
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
