import Link from "next/link";
import { notFound } from "next/navigation";
import { getShipment } from "@/services/shipments";
import { getShipmentCargo } from "@/services/shipmentCargo";
import { getShipmentContainers } from "@/services/shipmentContainers";
import {
  qtyTotalsByUom,
  packageTotalsByType,
  sumFinite,
} from "@/services/cargoLogic";
import { containerMetrics, displayContainerNo } from "@/services/containerLogic";
import { labelOf, TRANSPORT, SHIPMENT_PARTY_ROLES } from "@/services/codes";
import { PrintButton } from "@/components/PrintButton";
import type { ShipmentParty } from "@/services/types";

export const dynamic = "force-dynamic";

/**
 * S/I (Shipping Instruction) 인쇄 — 선적의 **인쇄 뷰**(발번·문서 실체화 없음,
 * 그건 P4.5~4.6에서 판단. 원칙 6 위반 아님 — 새 번호를 만들지 않는다).
 *
 * ⚠️ 당사자는 shipment_parties **스냅샷만** 찍는다 — getPartner 실시간 조회 금지
 *    (거래처 마스터를 나중에 고치면 과거 서류가 소급 변경되는 구조의 교정, P4.4).
 * ⚠️ 금액·환율은 절대 찍지 않는다 — 선적은 물류 전표(P4 수량 전용).
 * ⚠️ 총계 규칙(P4.3e 교훈): 수량은 단위별, 포장수는 포장 유형별로 쪼갠다.
 *    중량(kg)·CBM(m³)은 고정 단위라 단일 합계.
 * ⚠️ 컨테이너(P5.2): 헤더 스칼라 `Container:` 셀은 **사장**됐다 — 아래 CONTAINERS
 *    섹션(shipment_containers)이 정본이다. 컨테이너가 0건이면 섹션 자체를 생략한다
 *    (빈 표를 인쇄하면 "적입 정보 없음"이 아니라 "적입 안 함"으로 읽힌다).
 *    섹션의 포장수·G.W.·CBM 은 배분에서 **파생 계산**한 표시값이다(저장 없음).
 */
export default async function ShipmentPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [shipment, cargo, stuffing] = await Promise.all([
    getShipment(id),
    getShipmentCargo(id),
    getShipmentContainers(id),
  ]);
  if (!shipment) notFound();

  const cancelled = shipment.status === "cancelled";
  const partyByRole = new Map<string, ShipmentParty>(
    cargo.parties.map((p) => [p.role, p]),
  );

  const qtyTotals = qtyTotalsByUom(cargo.lines);
  const pkgTotals = packageTotalsByType(cargo.lines);
  const totalGw = sumFinite(cargo.lines.map((l) => l.grossWeightKg));
  const totalCbm = sumFinite(cargo.lines.map((l) => l.cbm));
  // 0 도 유효한 합계다("미기재"와 다르다) — 값이 하나라도 있으면 합계를 찍는다.
  const hasGw = cargo.lines.some((l) => l.grossWeightKg != null);
  const hasCbm = cargo.lines.some((l) => l.cbm != null);
  const qtyTotalLabel = qtyTotals.map((t) => `${t.qty} ${t.uom}`).join(" · ");
  const pkgTotalLabel = pkgTotals
    .map((t) => `${t.count} ${t.packageType}`)
    .join(" · ");

  // 적입(P5.2) — 배분은 컨테이너 id 를 축으로 계산한다(저장 후이므로 ref = id).
  const containers = stuffing.containers;
  const metricByRef = new Map(
    containerMetrics(
      containers.map((c) => ({ ref: c.id, containerType: c.containerType })),
      cargo.lines,
      stuffing.allocations.map((a) => ({
        containerRef: a.containerId,
        shipmentLineId: a.shipmentLineId,
        allocatedPackageCount: a.allocatedPackageCount,
      })),
    ).map((m) => [m.ref, m]),
  );
  const ctnPackages = sumFinite(
    containers.map((c) => metricByRef.get(c.id)?.packages ?? 0),
  );
  const ctnGw = sumFinite(
    containers.map((c) => metricByRef.get(c.id)?.grossWeightKg ?? 0),
  );
  const ctnCbm = sumFinite(
    containers.map((c) => metricByRef.get(c.id)?.cbm ?? 0),
  );
  const ctnVgm = sumFinite(containers.map((c) => c.vgmKg));
  const hasVgm = containers.some((c) => c.vgmKg != null);
  // 배분이 한 건도 없으면 세 총계는 '0'이 아니라 '-'다 — 0개 적입과 미배분은 다르다
  // (행 단위와 같은 규칙. 같은 페이지 화물표의 hasGw/hasCbm 선례).
  const hasAlloc = containers.some(
    (c) => (metricByRef.get(c.id)?.allocationCount ?? 0) > 0,
  );
  // 별표(일부만 합산)는 G.W./CBM 을 **따로** 판정한다 — 한 덩어리로 묶으면 결측이
  // 없는 합계에도 '일부만 합산'이라는 사실 주장이 붙는다(적대검증 확정 건).
  const ctnGwIncomplete = containers.some(
    (c) => metricByRef.get(c.id)?.gwIncomplete,
  );
  const ctnCbmIncomplete = containers.some(
    (c) => metricByRef.get(c.id)?.cbmIncomplete,
  );

  const partyLabel: Record<string, string> = {
    shipper: "Shipper (송하인)",
    consignee: "Consignee (수하인)",
    notify: "Notify Party (통지처)",
  };

  return (
    <div className="min-h-screen bg-zinc-100 py-8">
      {/* 화면 전용 툴바 (인쇄 시 숨김) */}
      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between px-4">
        <Link
          href={`/shipments/${shipment.id}`}
          className="text-sm text-zinc-500 hover:text-blue-700 hover:underline"
        >
          ← 선적 상세로
        </Link>
        <PrintButton />
      </div>

      {/* 인쇄 영역 (Shipping Instruction) */}
      <div className="mx-auto max-w-3xl bg-white px-12 py-12 text-sm leading-relaxed text-zinc-900 shadow-sm print:max-w-none print:shadow-none">
        {cancelled && (
          // 취소된 선적의 S/I 가 유효한 서류처럼 보이면 안 된다 — 인쇄물에도 남긴다.
          <div className="mb-6 border-2 border-red-600 px-4 py-2 text-center">
            <p className="text-xl font-bold tracking-widest text-red-600">
              CANCELLED · 취소된 선적
            </p>
            <p className="text-xs text-red-600">
              이 선적은 취소되었습니다. 유효한 Shipping Instruction 이 아닙니다.
            </p>
          </div>
        )}

        <h1 className="text-3xl font-bold tracking-tight text-blue-800">
          SHIPPING INSTRUCTION
        </h1>
        <p className="mb-1 text-xs font-medium uppercase tracking-widest text-zinc-400">
          선적지시서 (S/I)
        </p>
        <p className="mb-8 font-mono text-sm text-zinc-500">
          {shipment.shipNumber}
          {shipment.bookingNo ? ` · Booking ${shipment.bookingNo}` : ""}
        </p>

        {/* 당사자 3블록 — 스냅샷만 (없으면 미입력 표시) */}
        <div className="mb-8 grid grid-cols-3 gap-6">
          {SHIPMENT_PARTY_ROLES.map((r) => {
            const p = partyByRole.get(r.code);
            return (
              <div key={r.code}>
                <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  {partyLabel[r.code] ?? r.label}
                </h3>
                {p ? (
                  <>
                    <p className="font-semibold">{p.name}</p>
                    {p.address
                      ? p.address
                          .split("\n")
                          .map((line, i) => <p key={i}>{line}</p>)
                      : null}
                    {p.contact ? <p>{p.contact}</p> : null}
                  </>
                ) : (
                  <p className="text-zinc-400">
                    — <span className="no-print">(미입력 — 선적 화면의 &lsquo;화물 내역·당사자&rsquo;에서 입력)</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* 물류 헤더 필드 */}
        <div className="mb-8 grid grid-cols-3 gap-x-6 gap-y-1 border-y border-zinc-200 py-3 text-[13px]">
          <p><strong>Forwarder:</strong> {shipment.forwarder ?? "-"}</p>
          <p><strong>Carrier:</strong> {shipment.carrier ?? "-"}</p>
          <p>
            <strong>Transport:</strong>{" "}
            {shipment.transport ? labelOf(TRANSPORT, shipment.transport) : "-"}
          </p>
          <p><strong>Vessel/Voy:</strong> {shipment.vesselVoyage ?? "-"}</p>
          <p><strong>POL:</strong> {shipment.pol ?? "-"}</p>
          <p><strong>POD:</strong> {shipment.pod ?? "-"}</p>
          <p><strong>Incoterms:</strong> {shipment.incoterms ?? "-"}</p>
          <p><strong>B/L No:</strong> {shipment.blNo ?? "-"}</p>
          {/* Container 셀 없음(P5.2 사장) — 아래 CONTAINERS 섹션이 정본. */}
          <p className="col-span-3">
            <strong>Ref. Orders:</strong>{" "}
            {shipment.orders.length > 0
              ? shipment.orders
                  .map((o) => o.orderNumber ?? `${o.orderType}(번호 없음)`)
                  .join(", ")
              : "-"}
          </p>
        </div>

        {/* 화물표 — 금액·환율 없음(물류 전표) */}
        <table className="mb-2 w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-blue-800 text-left text-[11px] uppercase tracking-wider text-zinc-500">
              <th className="py-2 pr-2" style={{ width: "6%" }}>No.</th>
              <th className="py-2 pr-2" style={{ width: "34%" }}>Description</th>
              <th className="py-2 pr-2 text-right" style={{ width: "12%" }}>Qty</th>
              <th className="py-2 pr-2" style={{ width: "10%" }}>Unit</th>
              <th className="py-2 pr-2 text-right" style={{ width: "14%" }}>Packages</th>
              <th className="py-2 pr-2 text-right" style={{ width: "12%" }}>G.W. (kg)</th>
              <th className="py-2 pr-2 text-right" style={{ width: "12%" }}>CBM</th>
            </tr>
          </thead>
          <tbody>
            {cargo.lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-zinc-400">
                  {/* 대외 서류에 앱 화면 안내를 찍지 않는다 — 화면에서만 보인다 */}
                  —{" "}
                  <span className="no-print">
                    (화물 내역이 없습니다 — 선적 화면의 &lsquo;화물 내역·당사자&rsquo;에서
                    입력하세요)
                  </span>
                </td>
              </tr>
            ) : (
              cargo.lines.map((l, i) => (
                <tr key={l.id} className="border-b border-zinc-100 align-top">
                  <td className="py-2 pr-2 text-zinc-500">{i + 1}</td>
                  <td className="py-2 pr-2">
                    <p className="font-medium">{l.itemName}</p>
                    {l.memo ? (
                      <p className="text-xs text-zinc-500">{l.memo}</p>
                    ) : null}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{l.qty}</td>
                  <td className="py-2 pr-2">{l.uom}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {l.packageCount != null
                      ? `${l.packageCount}${l.packageType ? ` ${l.packageType}` : ""}`
                      : "-"}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {l.grossWeightKg ?? "-"}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {l.cbm ?? "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {cargo.lines.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-blue-800 font-semibold">
                <td className="py-2 pr-2" colSpan={2}>
                  TOTAL
                </td>
                {/* 수량 총계는 단위별 분리 — 단위 없는 총수량은 찍지 않는다(P4.3e). */}
                <td className="py-2 pr-2 text-right tabular-nums" colSpan={2}>
                  {qtyTotalLabel || "-"}
                </td>
                {/* 포장수 총계는 포장 유형별 분리. */}
                <td className="py-2 pr-2 text-right tabular-nums">
                  {pkgTotalLabel || "-"}
                </td>
                {/* 중량·CBM 은 고정 단위 — 단일 합계. 0 은 '-' 가 아니라 0 으로. */}
                <td className="py-2 pr-2 text-right tabular-nums">
                  {hasGw ? totalGw : "-"}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {hasCbm ? totalCbm : "-"}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
        <p className="mb-8 text-[11px] text-zinc-400">
          * Quantity totals are shown per unit; package totals per package type.
          Prices are not part of this document.
        </p>

        {/* ---------- CONTAINERS (적입 — P5.2). 0건이면 섹션 자체를 찍지 않는다. ---------- */}
        {containers.length > 0 && (
          <div className="mb-8">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Containers (적입)
            </h3>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b-2 border-blue-800 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                  <th className="py-2 pr-2" style={{ width: "6%" }}>No.</th>
                  <th className="py-2 pr-2" style={{ width: "24%" }}>Container No.</th>
                  <th className="py-2 pr-2" style={{ width: "12%" }}>Type</th>
                  <th className="py-2 pr-2" style={{ width: "18%" }}>Seal No.</th>
                  <th className="py-2 pr-2 text-right" style={{ width: "10%" }}>Packages</th>
                  <th className="py-2 pr-2 text-right" style={{ width: "10%" }}>G.W. (kg)</th>
                  <th className="py-2 pr-2 text-right" style={{ width: "10%" }}>CBM</th>
                  <th className="py-2 pr-2 text-right" style={{ width: "10%" }}>VGM (kg)</th>
                </tr>
              </thead>
              <tbody>
                {containers.map((c, i) => {
                  const m = metricByRef.get(c.id);
                  const allocated = (m?.allocationCount ?? 0) > 0;
                  return (
                    <tr key={c.id} className="border-b border-zinc-100 align-top">
                      <td className="py-2 pr-2 text-zinc-500">{i + 1}</td>
                      {/* 번호 미확정은 TBA(P5.3 P4·소급) — 배분 미실시('-')와는 별개 사실 */}
                      <td className="py-2 pr-2 font-medium">{displayContainerNo(c.containerNo)}</td>
                      <td className="py-2 pr-2">{c.containerType ?? "-"}</td>
                      <td className="py-2 pr-2">{c.sealNo ?? "-"}</td>
                      {/* 배분이 없으면 '0'이 아니라 '-' — 0개 적입과 미배분은 다르다. */}
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {allocated ? m!.packages : "-"}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {allocated ? `${m!.grossWeightKg}${m!.gwIncomplete ? "*" : ""}` : "-"}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {allocated ? `${m!.cbm}${m!.cbmIncomplete ? "*" : ""}` : "-"}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {c.vgmKg ?? "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-blue-800 font-semibold">
                  <td className="py-2 pr-2" colSpan={4}>
                    TOTAL ({containers.length} CNTR)
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {hasAlloc ? ctnPackages : "-"}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {hasAlloc ? `${ctnGw}${ctnGwIncomplete ? "*" : ""}` : "-"}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {hasAlloc ? `${ctnCbm}${ctnCbmIncomplete ? "*" : ""}` : "-"}
                  </td>
                  {/* VGM 은 입력값 — 파생 G.W. 합과 별개이며 상호검증하지 않는다. */}
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {hasVgm ? ctnVgm : "-"}
                  </td>
                </tr>
              </tfoot>
            </table>
            {/* 각주는 배분이 있을 때만 — 배분이 없으면 설명할 파생값 자체가 없다. */}
            {hasAlloc && (
              <p className="mt-1 text-[11px] text-zinc-400">
                * Packages are the allocated package counts as entered. G.W. and
                CBM per container are prorated from the cargo lines by allocated
                package count; lines without package count, weight or volume are
                excluded from that share (marked *). VGM is a declared value and
                is not derived from the figures above.
              </p>
            )}
          </div>
        )}

        {/* Shipping Marks */}
        <div className="mb-8">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Shipping Marks (화인)
          </h3>
          {cargo.shippingMarks ? (
            <pre className="whitespace-pre-wrap border border-zinc-200 p-3 font-sans text-[13px]">
              {cargo.shippingMarks}
            </pre>
          ) : (
            <p className="text-zinc-400">N/M (No Marks)</p>
          )}
        </div>

        {/* Notes */}
        {shipment.notes ? (
          <div className="mb-2">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Notes
            </h3>
            <p className="whitespace-pre-wrap text-[13px]">{shipment.notes}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
