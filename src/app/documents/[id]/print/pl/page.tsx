import { notFound } from "next/navigation";
import {
  getTradeDocument,
  packageTotalsByType,
  packingFillMode,
  qtyTotalsByUom,
  weightFillMode,
  weightTotal,
} from "@/services/tradeDocuments";
import { displayContainerNo } from "@/services/containerLogic";
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

  // 적입(P5.3) — **발행 스냅샷만** 읽는다(계산 0·라이브 재조회 0, D2·P3). 스냅샷은
  // 이미 문서 스코프로 걸러져 있고 수치가 동결돼 있다. null(=P5.3 이전 발행)·빈
  // 구조(적입 0건)면 섹션을 통째로 생략한다(S/I 0건 생략 선례와 같은 의미론).
  const snapshotContainers = doc.containersSnapshot?.containers ?? [];
  const ctnTotals = doc.containersSnapshot?.totals ?? null;

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

      {/* ---------- CONTAINERS (적입 — P5.3 스냅샷). 0건이면 섹션 생략(S/I 선례). ----------
          컬럼 구성은 S/I CONTAINERS 동형(D10). 수치는 발행 시점 동결값을 **그대로**
          인쇄한다 — 여기서 재계산하지 않는다. 별표(*)는 G.W./CBM 을 따로 판정한
          동결 플래그를 그대로 표시한다(S/I 와 같은 의미론). */}
      {snapshotContainers.length > 0 && (
        <div className={`${styles.avoidBreak} mt-8`}>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Containers (적입)
          </h3>
          <table className={`${styles.docTable} w-full border-collapse text-sm`}>
            <thead>
              <tr className="border-b-2 border-blue-800 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-2" style={{ width: "5%" }}>No.</th>
                <th className="py-2 pr-2" style={{ width: "22%" }}>Container No.</th>
                <th className="py-2 pr-2" style={{ width: "11%" }}>Type</th>
                <th className="py-2 pr-2" style={{ width: "16%" }}>Seal No.</th>
                <th className="py-2 pr-2 text-right" style={{ width: "10%" }}>Packages</th>
                <th className="py-2 pr-2 text-right" style={{ width: "12%" }}>G.W. (kg)</th>
                <th className="py-2 pr-2 text-right" style={{ width: "12%" }}>CBM</th>
                <th className="py-2 text-right" style={{ width: "12%" }}>VGM (kg)</th>
              </tr>
            </thead>
            <tbody>
              {snapshotContainers.map((c, i) => {
                // 스냅샷 컨테이너는 문서 라인 배분이 1건 이상인 것만 담겼다(P2) —
                // 여기서 '배분 미실시'('-')는 정상적으로 발생하지 않는다. 그럼에도
                // 방어적으로 배분 유무를 본다(빈 배분이면 '-', S/I 와 같은 규칙).
                const allocated = c.allocations.length > 0;
                return (
                  <tr key={i} className="border-b border-zinc-100 align-top">
                    <td className="py-2 pr-2 text-zinc-500">{i + 1}</td>
                    {/* 번호 미확정은 TBA(P4) — 배분 미실시('-')와는 별개 사실이다. */}
                    <td className="py-2 pr-2 font-medium">{displayContainerNo(c.containerNo)}</td>
                    <td className="py-2 pr-2">{c.containerType ?? "-"}</td>
                    <td className="py-2 pr-2">{c.sealNo ?? "-"}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {allocated && c.packageCount !== null ? fmt(c.packageCount) : "-"}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {allocated && c.grossWeightKg !== null
                        ? `${fmt(c.grossWeightKg)}${c.gwIncomplete ? "*" : ""}`
                        : "-"}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {allocated && c.cbm !== null
                        ? `${fmt(c.cbm)}${c.cbmIncomplete ? "*" : ""}`
                        : "-"}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {c.vgmKg !== null ? fmt(c.vgmKg) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {ctnTotals && (
              <tfoot>
                <tr className="border-t-2 border-blue-800 font-semibold">
                  <td className="py-2 pr-2" colSpan={4}>
                    TOTAL ({snapshotContainers.length} CNTR)
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {ctnTotals.packageCount !== null ? fmt(ctnTotals.packageCount) : "-"}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {ctnTotals.grossWeightKg !== null
                      ? `${fmt(ctnTotals.grossWeightKg)}${ctnTotals.gwIncomplete ? "*" : ""}`
                      : "-"}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {ctnTotals.cbm !== null
                      ? `${fmt(ctnTotals.cbm)}${ctnTotals.cbmIncomplete ? "*" : ""}`
                      : "-"}
                  </td>
                  {/* VGM 총계는 스냅샷 totals 에 없다 — 입력값이라 파생 합의 대상이
                      아니다(S/I 는 라이브 합을 냈지만 스냅샷은 컨테이너별 값만 동결). */}
                  <td className="py-2 text-right tabular-nums">-</td>
                </tr>
              </tfoot>
            )}
          </table>
          <p className="mt-1 text-[11px] text-zinc-400">
            * Packages are the allocated package counts as entered. G.W. and CBM per
            container are prorated from the packed cargo lines by allocated package
            count; lines without package count, weight or volume are excluded from
            that share (marked *). VGM is a declared value and is not derived from the
            figures above. These figures are a snapshot frozen at issuance.
          </p>
        </div>
      )}

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
