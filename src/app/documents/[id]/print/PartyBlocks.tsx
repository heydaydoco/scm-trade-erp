import type { TradeDocument } from "@/services/types";

/**
 * CI/PL 공용 헤더 블록 (P4.5 커밋 d) — **문서 스냅샷 컬럼만** 소비한다(D2).
 * 라이브 마스터(companies·shipments·config) 재조회 0 — props 는 getTradeDocument
 * 반환값 하나뿐이다.
 */

export function PartyBlocks({ doc }: { doc: TradeDocument }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-4">
      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          Seller / Exporter
        </h3>
        <p className="font-semibold">{doc.sellerName}</p>
        {doc.sellerAddress.split("\n").map((line, i) => (
          <p key={i}>{line}</p>
        ))}
        <p>{doc.sellerCountry}</p>
        {doc.sellerTel && <p>Tel: {doc.sellerTel}</p>}
        {doc.sellerEmail && <p>Email: {doc.sellerEmail}</p>}
        <p>Biz Reg: {doc.sellerBizRegNo}</p>
      </div>
      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          Buyer / Importer
        </h3>
        <p className="font-semibold">{doc.buyerName}</p>
        {doc.buyerAddress && <p>{doc.buyerAddress}</p>}
        {(doc.buyerCity || doc.buyerCountry) && (
          <p>{[doc.buyerCity, doc.buyerCountry].filter(Boolean).join(", ")}</p>
        )}
        {doc.buyerContactName && <p>Attn: {doc.buyerContactName}</p>}
        {doc.buyerEmail && <p>{doc.buyerEmail}</p>}
        {doc.buyerPhone && <p>{doc.buyerPhone}</p>}
      </div>
      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          Consignee
        </h3>
        {doc.consigneeName ? (
          <>
            <p className="font-semibold">{doc.consigneeName}</p>
            {doc.consigneeAddress && (
              <p className="whitespace-pre-line">{doc.consigneeAddress}</p>
            )}
            {doc.consigneeContact && <p>{doc.consigneeContact}</p>}
          </>
        ) : (
          <p className="text-zinc-400">-</p>
        )}
      </div>
      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          Notify Party
        </h3>
        {doc.notifyName ? (
          <>
            <p className="font-semibold">{doc.notifyName}</p>
            {doc.notifyAddress && (
              <p className="whitespace-pre-line">{doc.notifyAddress}</p>
            )}
            {doc.notifyContact && <p>{doc.notifyContact}</p>}
          </>
        ) : (
          <p className="text-zinc-400">-</p>
        )}
      </div>
    </div>
  );
}

/** 선적정보 스냅샷 그리드 — 값 있는 항목만 (셀 공란 대신 항목 생략). */
export function ShipmentInfoGrid({ doc }: { doc: TradeDocument }) {
  const items: [string, string | null][] = [
    ["Shipment No.", doc.shipmentNo],
    ["Transport", doc.transport],
    ["Vessel / Voyage", doc.vesselVoyage],
    ["Port of Loading", doc.pol],
    ["Port of Discharge", doc.pod],
    ["Carrier", doc.carrier],
    ["B/L No.", doc.blNo],
    ["Booking No.", doc.bookingNo],
    ["Container No.", doc.containerNo],
  ];
  const present = items.filter(([, v]) => v);
  if (present.length === 0) return null;
  return (
    <div className="mb-6 grid grid-cols-3 gap-x-6 gap-y-1 border-y border-zinc-200 py-3 text-xs">
      {present.map(([label, value]) => (
        <p key={label}>
          <span className="font-semibold uppercase tracking-wide text-zinc-400">
            {label}:
          </span>{" "}
          {value}
        </p>
      ))}
    </div>
  );
}
