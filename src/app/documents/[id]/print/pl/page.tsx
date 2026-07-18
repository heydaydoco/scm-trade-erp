import { notFound } from "next/navigation";
import {
  getTradeDocument,
  packageTotalsByType,
  packingFillMode,
  qtyTotalsByUom,
  weightFillMode,
  weightTotal,
} from "@/services/tradeDocuments";
import { PrintDocShell } from "@/components/print/PrintDocShell";
import styles from "@/components/print/printDoc.module.css";
import { PartyBlocks, ShipmentInfoGrid } from "../PartyBlocks";

export const dynamic = "force-dynamic";

/**
 * PL (Packing List) 인쇄 — P4.5 커밋 d. 자체 번호 없음 — Invoice No.(=CI 번호)
 * 참조(D1: CI+PL 세트 = 1행 = 번호 1개). 금액은 싣지 않는다(0 표기도 없음).
 *
 * ⚠️ D2 코드 수준 보장: 데이터 조회는 `getTradeDocument` **하나뿐** — 문서
 *    스냅샷 컬럼 외의 라이브 마스터 조회 0. 나머지 import 는 전부 순수 로직이다.
 * ⚠️ R-정정: 포장·수량·중량 총계는 전부 "이 문서에 포함된 라인" 스코프
 *    (packages_snapshot·trade_document_lines) — 선적 전체가 아니다.
 */

export default async function PackingListPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const doc = await getTradeDocument(id);
  if (!doc) notFound();

  // 포장: 포함 라인 스코프 all-or-nothing (R-정정) — 전원 보유 시에만 컬럼+TOTAL.
  const packMode = packingFillMode(doc.packagesSnapshot);
  const showPackages = packMode === "all";
  const packagesByLine = new Map(
    doc.packagesSnapshot.map((p) => [p.shipmentLineId, p]),
  );
  const packageTotals = packageTotalsByType(doc.packagesSnapshot);

  // 중량: D5·R1 all-or-nothing — 전 라인 입력 시에만 컬럼+TOTAL(부분합 왜곡 방지).
  const nwValues = doc.lines.map((l) => l.netWeight);
  const gwValues = doc.lines.map((l) => l.grossWeight);
  const showNw = weightFillMode(nwValues) === "all";
  const showGw = weightFillMode(gwValues) === "all";

  // 수량 TOTAL — 단위별 분리(P4.3e 규칙: 단위를 섞어 더하지 않는다).
  const qtyTotals = qtyTotalsByUom(doc.lines.map((l) => ({ qty: l.qty, uom: l.uom })));

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 6 });

  return (
    <PrintDocShell
      backHref={`/documents/${doc.id}`}
      backLabel="← 무역서류 상세로"
      cancelled={doc.status === "cancelled"}
      cancelReason={doc.cancelReason}
    >
      <h1 className="text-3xl font-bold tracking-tight text-blue-800">
        PACKING LIST
      </h1>
      <div className="mb-8 flex items-baseline justify-between">
        <p className="text-sm text-zinc-500">
          <span className="font-semibold">Invoice No.:</span>{" "}
          <span className="font-mono">{doc.docNumber}</span>
        </p>
        <p className="text-sm">
          <span className="font-semibold">Date:</span> {doc.issueDate}
        </p>
      </div>

      <PartyBlocks doc={doc} />
      <ShipmentInfoGrid doc={doc} />

      <table className={`${styles.docTable} w-full border-collapse text-sm`}>
        <thead>
          <tr className="border-b-2 border-blue-800 text-left text-[11px] uppercase tracking-wide text-zinc-500">
            <th className="py-2 pr-2" style={{ width: "5%" }}>
              No.
            </th>
            <th className="py-2 pr-2" style={{ width: "12%" }}>
              Code
            </th>
            <th className="py-2 pr-2">Description</th>
            <th className="py-2 pr-2 text-right" style={{ width: "10%" }}>
              Qty
            </th>
            <th className="py-2 pr-2" style={{ width: "8%" }}>
              Unit
            </th>
            {showPackages && (
              <th className="py-2 pr-2 text-right" style={{ width: "12%" }}>
                Packages
              </th>
            )}
            {showNw && (
              <th className="py-2 pr-2 text-right" style={{ width: "11%" }}>
                N.W. (kg)
              </th>
            )}
            {showGw && (
              <th className="py-2 text-right" style={{ width: "11%" }}>
                G.W. (kg)
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => {
            const pkg = packagesByLine.get(l.shipmentLineId);
            return (
              <tr key={l.id} className="border-b border-zinc-100 align-top">
                <td className="py-2 pr-2">{l.lineNo}</td>
                <td className="py-2 pr-2 font-mono text-xs">{l.productCode ?? ""}</td>
                <td className="py-2 pr-2">
                  <span className="font-medium">{l.productName}</span>
                  {l.description && (
                    <span className="block text-xs text-zinc-500">
                      {l.description}
                    </span>
                  )}
                </td>
                {/* 수량은 스냅샷 원문 그대로(최대 6자리 — 기본 3자리 절사 방지) */}
                <td className="py-2 pr-2 text-right tabular-nums">{fmt(l.qty)}</td>
                <td className="py-2 pr-2">{l.uom}</td>
                {showPackages && (
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {pkg?.packageCount != null
                      ? `${fmt(pkg.packageCount)} ${pkg.packageType ?? ""}`.trim()
                      : ""}
                  </td>
                )}
                {showNw && (
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {l.netWeight !== null ? fmt(l.netWeight) : ""}
                  </td>
                )}
                {showGw && (
                  <td className="py-2 text-right tabular-nums">
                    {l.grossWeight !== null ? fmt(l.grossWeight) : ""}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* TOTAL — 수량은 단위별·포장은 유형별 분리(섞어 더하지 않음), 중량은 kg 단일 합 */}
      <div className={`${styles.avoidBreak} mt-4 flex justify-end`}>
        <div className="min-w-72 space-y-1 border-t-2 border-blue-800 pt-2 text-sm">
          <div className="flex justify-between gap-8">
            <span className="font-semibold">TOTAL Qty</span>
            <span className="tabular-nums">
              {qtyTotals.map((t) => `${fmt(t.qty)} ${t.uom}`).join(" · ")}
            </span>
          </div>
          {showPackages && packageTotals.length > 0 && (
            <div className="flex justify-between gap-8">
              <span className="font-semibold">TOTAL Packages</span>
              <span className="tabular-nums">
                {packageTotals
                  .map((t) => `${fmt(t.count)} ${t.packageType}`)
                  .join(" · ")}
              </span>
            </div>
          )}
          {showNw && (
            <div className="flex justify-between gap-8">
              <span className="font-semibold">TOTAL N.W.</span>
              <span className="tabular-nums">{fmt(weightTotal(nwValues))} kg</span>
            </div>
          )}
          {showGw && (
            <div className="flex justify-between gap-8">
              <span className="font-semibold">TOTAL G.W.</span>
              <span className="tabular-nums">{fmt(weightTotal(gwValues))} kg</span>
            </div>
          )}
        </div>
      </div>

      {doc.shippingMarks && (
        <div className={`${styles.avoidBreak} mt-8 border-t border-zinc-200 pt-4`}>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Shipping Marks
          </h3>
          <p className="whitespace-pre-line font-mono text-xs text-zinc-700">
            {doc.shippingMarks}
          </p>
        </div>
      )}

      {doc.remarks && (
        <div className="mt-6">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Remarks
          </h3>
          <p className="whitespace-pre-line text-xs text-zinc-600">{doc.remarks}</p>
        </div>
      )}
    </PrintDocShell>
  );
}
