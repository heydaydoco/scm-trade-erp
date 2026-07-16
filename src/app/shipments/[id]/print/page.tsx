import Link from "next/link";
import { notFound } from "next/navigation";
import { getShipment } from "@/services/shipments";
import { getShipmentCargo } from "@/services/shipmentCargo";
import {
  qtyTotalsByUom,
  packageTotalsByType,
  sumFinite,
} from "@/services/cargoLogic";
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
 */
export default async function ShipmentPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [shipment, cargo] = await Promise.all([
    getShipment(id),
    getShipmentCargo(id),
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
          <p><strong>Container:</strong> {shipment.containerNo ?? "-"}</p>
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
