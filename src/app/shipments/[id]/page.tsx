import { notFound } from "next/navigation";
import { getShipment } from "@/services/shipments";
import { listPartners } from "@/services/partners";
import { listSalesOrders } from "@/services/salesOrders";
import { listPurchaseOrders } from "@/services/purchaseOrders";
import {
  getShipmentCargo,
  listShippableOrderLines,
} from "@/services/shipmentCargo";
import {
  issuableCombos,
  listIssuableLines,
  listTradeDocumentsForShipment,
} from "@/services/tradeDocuments";
import { listCustomsDeclarationsForShipment } from "@/services/customsDeclarations";
import type { PartnerLike, SellerLike } from "@/services/cargoLogic";
import { SELLER } from "@/config/company";
import Link from "next/link";
import { ShipmentForm, type OrderOption } from "../ShipmentForm";
import { CargoCard } from "./CargoCard";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/Badge";
import { CURRENCY_SYMBOL, CUSTOMS_DECL_STATUS, DECL_TYPE, labelOf } from "@/services/codes";
import { flowHref } from "@/services/chainLogic";

export const dynamic = "force-dynamic";

export default async function EditShipmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [
    shipment,
    partners,
    sos,
    pos,
    cargo,
    shippable,
    tradeDocs,
    issuable,
    customsDecls,
  ] = await Promise.all([
    getShipment(id),
    listPartners(),
    listSalesOrders(),
    listPurchaseOrders(),
    getShipmentCargo(id),
    listShippableOrderLines(id),
    listTradeDocumentsForShipment(id),
    listIssuableLines(id),
    listCustomsDeclarationsForShipment(id),
  ]);
  if (!shipment) notFound();

  // 무역서류(P4.5) — (고객×통화) 발행 조합 + 활성 문서에 의한 화물 동결 안내.
  const { combos, warnings: comboWarnings } = issuableCombos(issuable);
  const activeDocs = tradeDocs.filter((d) => d.status === "issued");
  const activeByCombo = new Map(
    activeDocs.map((d) => [`${d.customerId}|${d.currency}`, d]),
  );

  const partnerOptions = partners.map((p) => ({
    id: p.id,
    name: p.name,
    country: p.country,
  }));
  const orderOptions: OrderOption[] = [
    ...sos.map((s) => ({
      type: "SO",
      id: s.id,
      number: s.soNumber,
      partnerName: s.partnerName,
    })),
    ...pos.map((p) => ({
      type: "PO",
      id: p.id,
      number: p.poNumber,
      partnerName: p.partnerName,
    })),
  ];

  // ★ 화물 라인이 달린 주문은 연결 해제 불가(원칙 5 소비 가드의 UI 층 —
  //   DB 지연 트리거가 최종 방어선, 여기선 ✕ 를 잠가 날것의 예외를 예방).
  //   취소된 선적은 잠그지 않는다 — DB 가드도 취소 선적의 라인을 "살아있는" 것으로
  //   치지 않는데 UI 만 잠그면, 읽기전용 화물 카드 때문에 풀 수 없는 교착이 된다.
  const lineToOrder = new Map(
    shippable.map((s) => [s.orderLineId, `${s.orderType}::${s.orderId}`]),
  );
  const lockedOrderKeys =
    shipment.status === "cancelled"
      ? []
      : Array.from(
          new Set(
            cargo.lines
              .map((l) => (l.orderLineId ? lineToOrder.get(l.orderLineId) : null))
              .filter((v): v is string => !!v),
          ),
        );

  // 당사자 프리필용 — 스냅샷의 재료(마스터는 초기값·불러오기 버튼에만 쓰인다).
  const partnerRow = shipment.partnerId
    ? partners.find((p) => p.id === shipment.partnerId) ?? null
    : null;
  const partnerLike: PartnerLike | null = partnerRow
    ? {
        id: partnerRow.id,
        name: partnerRow.name,
        address: partnerRow.address,
        city: partnerRow.city,
        country: partnerRow.country,
        contactName: partnerRow.contactName,
        contactEmail: partnerRow.contactEmail,
        contactPhone: partnerRow.contactPhone,
      }
    : null;
  const sellerLike: SellerLike = {
    name: SELLER.name,
    addressLines: [...SELLER.addressLines],
    tel: SELLER.tel,
    email: SELLER.email,
    bizRegNo: SELLER.bizRegNo, // D7: 스냅샷 경유 유실 수정
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader title="선적 수정" subtitle={shipment.shipNumber} />
      <div className="-mt-2 mb-4 flex flex-wrap items-center gap-4">
        <Link
          href={`/shipments/${shipment.id}/print`}
          className="text-sm text-blue-700 hover:underline"
        >
          🖨 S/I (Shipping Instruction) 보기 →
        </Link>
        <Link
          href={flowHref("shipment", shipment.id)}
          className="text-sm font-medium text-indigo-700 hover:underline"
        >
          🔗 문서 흐름 →
        </Link>
      </div>
      <div className="mt-4">
        <ShipmentForm
          shipment={shipment}
          partners={partnerOptions}
          orderOptions={orderOptions}
          lockedOrderKeys={lockedOrderKeys}
        />
      </div>

      {activeDocs.length > 0 && (
        <div className="mt-8 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          🔒 무역서류{" "}
          <span className="font-mono font-medium">
            {activeDocs.map((d) => d.docNumber).join(", ")}
          </span>{" "}
          발행 중 — 이 선적의 <b>화물 내역·당사자 저장이 잠깁니다</b>(화인만 별도
          저장 가능). 수정하려면 아래 무역서류를 <b>취소 → 수정 → 재발행</b>{" "}
          하세요(재발행 시 새 번호).
        </div>
      )}

      <CargoCard
        shipmentId={shipment.id}
        direction={shipment.direction}
        cancelled={shipment.status === "cancelled"}
        initialLines={cargo.lines}
        initialParties={cargo.parties}
        initialMarks={cargo.shippingMarks}
        shippable={shippable}
        partner={partnerLike}
        seller={sellerLike}
      />

      {/* ---------- 무역서류 (P4.5 — CI/PL 발행·이력) ---------- */}
      <section className="mt-10 space-y-4">
        <div className="border-b border-zinc-100 pb-1">
          <h2 className="text-base font-semibold text-slate-900">
            무역서류 (CI / PL)
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            생성 단위 = (선적×고객×통화) 조합 — SO 연결 라인만 대상입니다(수입
            서류는 공급자 발행). 한 번의 발행 = CI+PL 세트 = 번호 1개, 발행 후
            불변(취소 후 재발행만).
          </p>
        </div>

        {comboWarnings.length > 0 && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {comboWarnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}

        {combos.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
            발행 가능한 (고객×통화) 조합이 없습니다 — 위 화물 카드에서 SO 라인을
            담아 저장하면 조합이 나타납니다.
          </p>
        ) : (
          <ul className="space-y-2">
            {combos.map((c) => {
              const active = activeByCombo.get(`${c.customerId}|${c.currency}`);
              return (
                <li
                  key={`${c.customerId}|${c.currency}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium">
                      {c.customerName ?? "(고객명 미상)"}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {c.currency} · 라인 {c.lineCount}건
                      {c.soNumbers.length > 0 && (
                        <span className="ml-1 font-mono">
                          ({c.soNumbers.join(", ")})
                        </span>
                      )}
                    </span>
                  </span>
                  {shipment.status === "cancelled" ? (
                    <span className="text-xs text-slate-400">
                      취소된 선적 — 발행 불가
                    </span>
                  ) : active ? (
                    <span className="flex items-center gap-2 text-xs">
                      <Badge variant="green">ISSUED</Badge>
                      <Link
                        href={`/documents/${active.id}`}
                        className="font-mono text-blue-700 hover:underline"
                      >
                        {active.docNumber}
                      </Link>
                      <span className="text-slate-400">
                        (재발행은 취소 후)
                      </span>
                    </span>
                  ) : (
                    <Link
                      href={`/documents/new?shipment=${shipment.id}&customer=${c.customerId}&currency=${encodeURIComponent(c.currency)}`}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                    >
                      발행 →
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {tradeDocs.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">번호</th>
                  <th className="px-3 py-2">고객</th>
                  <th className="px-3 py-2">통화</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2">발행일</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tradeDocs.map((d) => (
                  <tr
                    key={d.id}
                    className={d.status === "cancelled" ? "opacity-55" : ""}
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/documents/${d.id}`}
                        className="font-mono font-medium text-blue-700 hover:underline"
                      >
                        {d.docNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{d.buyerName}</td>
                    <td className="px-3 py-2">{d.currency}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {`${CURRENCY_SYMBOL[d.currency] ?? ""}${d.totalAmount.toLocaleString(
                        undefined,
                        { maximumFractionDigits: 2 },
                      )} ${d.currency}`}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={d.status === "cancelled" ? "red" : "green"}
                      >
                        {d.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{d.issueDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------- 통관신고 (P5.1 — 수출 E6 / 수입 E9) ---------- */}
      <section className="mt-10 space-y-4">
        <div className="flex items-end justify-between gap-2 border-b border-zinc-100 pb-1">
          <div>
            <h2 className="text-base font-semibold text-slate-900">통관신고 (E6 / E9)</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              이 선적을 앵커로 수출·수입 통관신고를 기록합니다(헤더 온리, 인쇄물 없음).
              세액은 관세사 통지값을 기록만 합니다 — 시스템 계산·단정 없음.
            </p>
          </div>
          {shipment.status !== "cancelled" && (
            <Link
              href={`/customs/new?shipment=${shipment.id}`}
              className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
            >
              신고 작성 →
            </Link>
          )}
        </div>

        {customsDecls.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
            {shipment.status === "cancelled"
              ? "취소된 선적 — 통관신고를 작성할 수 없습니다."
              : "작성된 통관신고가 없습니다 — [신고 작성]으로 시작하세요."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">번호</th>
                  <th className="px-3 py-2">유형</th>
                  <th className="px-3 py-2">세관번호</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2">신고일</th>
                  <th className="px-3 py-2">수리일</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customsDecls.map((d) => (
                  <tr key={d.id} className={d.status === "cancelled" ? "opacity-55" : ""}>
                    <td className="px-3 py-2">
                      <Link
                        href={`/customs/${d.id}`}
                        className="font-mono font-medium text-blue-700 hover:underline"
                      >
                        {d.declDocNo}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{labelOf(DECL_TYPE, d.declType)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{d.customsDeclNo ?? "-"}</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          d.status === "cancelled"
                            ? "red"
                            : d.status === "accepted"
                              ? "green"
                              : d.status === "filed"
                                ? "blue"
                                : "zinc"
                        }
                      >
                        {labelOf(CUSTOMS_DECL_STATUS, d.status)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{d.filingDate ?? "-"}</td>
                    <td className="px-3 py-2">{d.acceptanceDate ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
