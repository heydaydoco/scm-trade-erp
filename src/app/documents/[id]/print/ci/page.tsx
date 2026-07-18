import { notFound } from "next/navigation";
import { getTradeDocument } from "@/services/tradeDocuments";
import { CURRENCY_SYMBOL } from "@/services/codes";
import { PrintDocShell } from "@/components/print/PrintDocShell";
import styles from "@/components/print/printDoc.module.css";
import { PartyBlocks, ShipmentInfoGrid } from "../PartyBlocks";

export const dynamic = "force-dynamic";

/**
 * CI (Commercial Invoice) 인쇄 — P4.5 커밋 d.
 *
 * ⚠️ D2 코드 수준 보장: 이 페이지의 데이터 조회는 `getTradeDocument` **하나뿐**
 *    이다 — 문서 스냅샷 컬럼 외의 라이브 마스터(주문·선적·거래처·config) 조회 0.
 *    원천을 나중에 고쳐도 이 인쇄물은 불변이다.
 */

export default async function CommercialInvoicePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const doc = await getTradeDocument(id);
  if (!doc) notFound();

  const symbol = CURRENCY_SYMBOL[doc.currency] ?? "";
  // 금액(round2 저장)은 2자리 고정, 수량·단가는 스냅샷 원문 그대로(최대 6자리 —
  // 기본 3자리 절사로 0.0004 가 "0"이 되는 유실 방지, 적대검증 교정).
  const money = (n: number) =>
    `${symbol}${n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const price = (n: number) =>
    `${symbol}${n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })}`;
  const qty = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 6 });

  // HS·Origin 열은 전 라인 공란이면 열 자체를 생략(셀 공란은 허용) — 스펙 d.
  const hasHs = doc.lines.some((l) => l.hsCode);
  const hasOrigin = doc.lines.some((l) => l.originCountry);
  const hasBank = !!(doc.sellerBankName || doc.sellerAccountNo || doc.sellerSwift);
  const hasSignatory = !!(doc.sellerSignatoryName || doc.sellerSignatoryTitle);

  return (
    <PrintDocShell
      backHref={`/documents/${doc.id}`}
      backLabel="← 무역서류 상세로"
      cancelled={doc.status === "cancelled"}
      cancelReason={doc.cancelReason}
    >
      <h1 className="text-3xl font-bold tracking-tight text-blue-800">
        COMMERCIAL INVOICE
      </h1>
      <div className="mb-8 flex items-baseline justify-between">
        <p className="font-mono text-sm text-zinc-500">{doc.docNumber}</p>
        <p className="text-sm">
          <span className="font-semibold">Date:</span> {doc.issueDate}
        </p>
      </div>

      <PartyBlocks doc={doc} />
      <ShipmentInfoGrid doc={doc} />

      <div className="mb-4 grid grid-cols-3 gap-6 text-sm">
        <p>
          <span className="font-semibold">Currency:</span> {doc.currency}
        </p>
        {/* 스냅샷 원문 그대로 인쇄(라벨 치환 금지 — 적대검증 교정): 대외 영문
            서류에 한국어 라벨이 섞이지 않고, 코드표를 나중에 고쳐도 재인쇄가
            최초 인쇄와 동일하다(재인쇄 불변). */}
        <p>
          <span className="font-semibold">Incoterms:</span>{" "}
          {doc.incoterm
            ? `${doc.incoterm}${doc.incotermPlace ? ` ${doc.incotermPlace}` : ""}`
            : "-"}
        </p>
        <p>
          <span className="font-semibold">Payment:</span> {doc.paymentTerms ?? "-"}
        </p>
      </div>

      <table className={`${styles.docTable} w-full border-collapse text-sm`}>
        <thead>
          <tr className="border-b-2 border-blue-800 text-left text-[11px] uppercase tracking-wide text-zinc-500">
            <th className="py-2 pr-2" style={{ width: "5%" }}>
              No.
            </th>
            <th className="py-2 pr-2" style={{ width: "10%" }}>
              Code
            </th>
            <th className="py-2 pr-2">Description</th>
            {hasHs && (
              <th className="py-2 pr-2" style={{ width: "11%" }}>
                HS Code
              </th>
            )}
            {hasOrigin && (
              <th className="py-2 pr-2" style={{ width: "9%" }}>
                Origin
              </th>
            )}
            <th className="py-2 pr-2 text-right" style={{ width: "9%" }}>
              Qty
            </th>
            <th className="py-2 pr-2" style={{ width: "7%" }}>
              Unit
            </th>
            <th className="py-2 pr-2 text-right" style={{ width: "12%" }}>
              Unit Price
            </th>
            <th className="py-2 text-right" style={{ width: "13%" }}>
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.id} className="border-b border-zinc-100 align-top">
              <td className="py-2 pr-2">{l.lineNo}</td>
              <td className="py-2 pr-2 font-mono text-xs">{l.productCode ?? ""}</td>
              <td className="py-2 pr-2">
                <span className="font-medium">{l.productName}</span>
                {l.description && (
                  <span className="block text-xs text-zinc-500">{l.description}</span>
                )}
              </td>
              {hasHs && (
                <td className="py-2 pr-2 font-mono text-xs">{l.hsCode ?? ""}</td>
              )}
              {hasOrigin && (
                <td className="py-2 pr-2 text-xs">{l.originCountry ?? ""}</td>
              )}
              <td className="py-2 pr-2 text-right tabular-nums">{qty(l.qty)}</td>
              <td className="py-2 pr-2">{l.uom}</td>
              <td className="py-2 pr-2 text-right tabular-nums">
                {price(l.unitPrice)}
              </td>
              <td className="py-2 text-right tabular-nums">{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <div className={`${styles.avoidBreak} w-64 space-y-1 text-sm`}>
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="tabular-nums">{money(doc.subtotalAmount)}</span>
          </div>
          {doc.discountAmount !== 0 && (
            <div className="flex justify-between text-red-600">
              <span>Less: Discount</span>
              <span className="tabular-nums">-{money(doc.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between border-t-2 border-blue-800 pt-2 text-base font-bold text-blue-800">
            <span>TOTAL</span>
            <span className="tabular-nums">
              {money(doc.totalAmount)} {doc.currency}
            </span>
          </div>
        </div>
      </div>

      {doc.remarks && (
        <div className="mt-6">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Remarks
          </h3>
          <p className="whitespace-pre-line text-xs text-zinc-600">{doc.remarks}</p>
        </div>
      )}

      {hasBank && (
        <div className={`${styles.avoidBreak} mt-8 border-t border-zinc-200 pt-4`}>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Bank Details
          </h3>
          {doc.sellerBankName && <p className="text-sm">Bank: {doc.sellerBankName}</p>}
          {doc.sellerAccountNo && (
            <p className="text-sm">Account No.: {doc.sellerAccountNo}</p>
          )}
          {doc.sellerSwift && <p className="text-sm">SWIFT: {doc.sellerSwift}</p>}
        </div>
      )}

      {hasSignatory && (
        <div className={`${styles.avoidBreak} mt-16 text-right`}>
          <p className="mb-12 text-sm">
            Authorized Signature — {doc.sellerName}
          </p>
          <div className="inline-block min-w-56 border-t border-zinc-800 pt-1.5 text-center">
            {doc.sellerSignatoryName && (
              <p className="font-medium">{doc.sellerSignatoryName}</p>
            )}
            {doc.sellerSignatoryTitle && (
              <p className="text-xs text-zinc-500">{doc.sellerSignatoryTitle}</p>
            )}
          </div>
        </div>
      )}
    </PrintDocShell>
  );
}
