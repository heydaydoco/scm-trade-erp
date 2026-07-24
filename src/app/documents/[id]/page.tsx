import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Badge, type BadgeVariant } from "@/components/Badge";
import { docContainerNoLabel, getTradeDocument } from "@/services/tradeDocuments";
import { CURRENCY_SYMBOL } from "@/services/codes";
import { flowHref } from "@/services/chainLogic";
import { CancelDocumentButton } from "./CancelDocumentButton";

export const dynamic = "force-dynamic";

/**
 * 무역서류 상세 — **발행 시점 스냅샷 컬럼만** 표시한다(D2, 마스터 재조회 0).
 * 원천(주문·선적·거래처·config)을 나중에 고쳐도 이 화면·인쇄물은 불변이다.
 * 수정은 없다 — 취소(사유 필수) 후 재발행(새 번호)만.
 */

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  issued: "green",
  cancelled: "red",
};

// 최대 6자리 — 수량·단가·중량 스냅샷 원문 보존(기본 절사로 0.0004 가 "0"이 되는
// 유실 방지, 적대검증 교정). 금액은 round2 저장이라 어차피 2자리 이하다.
function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export default async function TradeDocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ issued?: string; w?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const doc = await getTradeDocument(id);
  if (!doc) notFound();

  // 발행 직후 진입(액션 redirect) — 성공 배너 + RPC 경고 표시.
  const justIssued = sp.issued === "1" && doc.status === "issued";
  let issueWarnings: string[] = [];
  if (justIssued && sp.w) {
    try {
      const parsed = JSON.parse(sp.w);
      if (Array.isArray(parsed)) {
        issueWarnings = parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      // 경고 파라미터가 깨져도 문서 표시는 정상 진행
    }
  }

  const symbol = CURRENCY_SYMBOL[doc.currency] ?? "";
  const money = (n: number) => `${symbol}${fmt(n)} ${doc.currency}`;
  const cancelled = doc.status === "cancelled";

  const hasHs = doc.lines.some((l) => l.hsCode);
  const hasOrigin = doc.lines.some((l) => l.originCountry);
  const hasNw = doc.lines.some((l) => l.netWeight !== null);
  const hasGw = doc.lines.some((l) => l.grossWeight !== null);

  const parties: { title: string; name: string | null; lines: (string | null)[] }[] = [
    {
      title: "Seller (당사)",
      name: doc.sellerName,
      lines: [
        doc.sellerAddress,
        doc.sellerCountry,
        [doc.sellerTel, doc.sellerEmail].filter(Boolean).join(" · ") || null,
        doc.sellerBizRegNo ? `사업자번호 ${doc.sellerBizRegNo}` : null,
      ],
    },
    {
      title: "Buyer (고객)",
      name: doc.buyerName,
      lines: [
        doc.buyerAddress,
        [doc.buyerCity, doc.buyerCountry].filter(Boolean).join(", ") || null,
        [doc.buyerContactName, doc.buyerEmail, doc.buyerPhone]
          .filter(Boolean)
          .join(" · ") || null,
      ],
    },
    {
      title: "Consignee",
      name: doc.consigneeName,
      lines: [doc.consigneeAddress, doc.consigneeContact],
    },
    {
      title: "Notify Party",
      name: doc.notifyName,
      lines: [doc.notifyAddress, doc.notifyContact],
    },
  ];

  // Container No.(P5.3 판정 ②·D9) — 인쇄(ShipmentInfoGrid)와 **같은 헬퍼**를 쓴다.
  const containerNoLabel = docContainerNoLabel(doc);
  const shipInfo: [string, string | null][] = [
    ["선적번호(스냅샷)", doc.shipmentNo],
    ["운송", doc.transport],
    ["Vessel/Voyage", doc.vesselVoyage],
    ["적출항(POL)", doc.pol],
    ["도착항(POD)", doc.pod],
    ["Carrier", doc.carrier],
    ["B/L No.", doc.blNo],
    ["Booking No.", doc.bookingNo],
    ["Container No.", containerNoLabel],
  ];

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-start justify-between gap-4">
        <PageHeader title="무역서류" subtitle={doc.docNumber} />
        <div className="pt-1">
          <Badge variant={STATUS_VARIANT[doc.status] ?? "zinc"}>
            {doc.status.toUpperCase()}
          </Badge>
        </div>
      </div>

      {justIssued && (
        <div className="mb-6 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">
            무역서류 {doc.docNumber} 가 발행되었습니다 (CI+PL 세트).
          </p>
          <p className="mt-1 text-xs">
            발행 시점 스냅샷으로 고정되었습니다 — 이후 원천 수정과 무관합니다.
          </p>
          {issueWarnings.length > 0 && (
            <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-amber-900">
              <p className="mb-1 text-xs font-medium">
                발행 경고 (차단 아님 — 확인 권장):
              </p>
              <ul className="list-disc pl-5 text-xs">
                {issueWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {cancelled && (
        <div className="mb-6 rounded-md border-2 border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-bold">CANCELLED — 취소된 무역서류입니다.</p>
          <p className="mt-1">
            사유: {doc.cancelReason ?? "-"}
            {doc.cancelledAt && (
              <span className="ml-2 text-xs text-red-600">
                ({new Date(doc.cancelledAt).toLocaleString("ko-KR")})
              </span>
            )}
          </p>
          <p className="mt-1 text-xs">
            문서와 번호는 이력으로 남습니다. 재발행하면 새 번호가 발번됩니다.
          </p>
        </div>
      )}

      <div className="-mt-2 mb-4 flex flex-wrap gap-4 text-sm">
        <Link href="/documents" className="text-zinc-500 hover:text-blue-700 hover:underline">
          ← 무역서류 목록
        </Link>
        <Link
          href={`/shipments/${doc.shipmentId}`}
          className="text-blue-700 hover:underline"
        >
          선적 상세 →
        </Link>
        <Link
          href={`/documents/${doc.id}/print/ci`}
          className="text-blue-700 hover:underline"
        >
          🖨 CI (Commercial Invoice) 보기 →
        </Link>
        <Link
          href={`/documents/${doc.id}/print/pl`}
          className="text-blue-700 hover:underline"
        >
          🖨 PL (Packing List) 보기 →
        </Link>
        <Link href={flowHref("tradeDocument", doc.id)} className="font-medium text-indigo-700 hover:underline">
          🔗 문서 흐름 →
        </Link>
      </div>

      <p className="mb-6 text-xs text-slate-500">
        이 문서는 발행 시점의 <b>전량 스냅샷</b>입니다 — 주문·선적·거래처·당사
        정보를 나중에 고쳐도 이 화면과 인쇄물은 바뀌지 않습니다. 수정 기능은
        없으며, 취소(사유 필수) 후 재발행(새 번호)만 가능합니다.
      </p>

      {/* 헤더 정보 */}
      <dl className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">발행일</dt>
          <dd>{doc.issueDate}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">통화</dt>
          <dd>{doc.currency}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Incoterms</dt>
          <dd>
            {doc.incoterm ?? "-"}
            {doc.incotermPlace ? ` ${doc.incotermPlace}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Payment Terms</dt>
          <dd>{doc.paymentTerms ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Subtotal</dt>
          <dd className="tabular-nums">{money(doc.subtotalAmount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Discount</dt>
          <dd className="tabular-nums">{money(doc.discountAmount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Total</dt>
          <dd className="font-semibold tabular-nums">{money(doc.totalAmount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Remarks</dt>
          <dd className="whitespace-pre-line">{doc.remarks ?? "-"}</dd>
        </div>
      </dl>

      {/* 당사자 4블록 (전부 문서 스냅샷) */}
      <h2 className="mb-2 text-sm font-semibold text-slate-900">
        당사자 (발행 시점 스냅샷)
      </h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {parties.map((p) => (
          <div key={p.title} className="rounded-lg border border-slate-200 p-3 text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
              {p.title}
            </p>
            {p.name ? (
              <>
                <p className="font-medium">{p.name}</p>
                {p.lines
                  .filter((v): v is string => !!v)
                  .map((v, i) => (
                    <p key={i} className="whitespace-pre-line text-xs text-slate-600">
                      {v}
                    </p>
                  ))}
              </>
            ) : (
              <p className="text-xs text-slate-400">(없음)</p>
            )}
          </div>
        ))}
      </div>

      {/* 선적정보 스냅샷 */}
      <h2 className="mb-2 text-sm font-semibold text-slate-900">선적정보 (스냅샷)</h2>
      <dl className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-4 text-sm sm:grid-cols-3">
        {shipInfo.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd>{value ?? "-"}</dd>
          </div>
        ))}
        <div className="col-span-2 sm:col-span-3">
          <dt className="text-xs text-slate-500">Shipping Marks</dt>
          <dd className="whitespace-pre-line">{doc.shippingMarks ?? "-"}</dd>
        </div>
      </dl>

      {/* 라인 스냅샷 */}
      <h2 className="mb-2 text-sm font-semibold text-slate-900">
        라인 ({doc.lines.length}건 — 발행 시점 스냅샷)
      </h2>
      <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">No.</th>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">품목 / Description</th>
              {hasHs && <th className="px-3 py-2">HS</th>}
              {hasOrigin && <th className="px-3 py-2">Origin</th>}
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2 text-right">단가</th>
              <th className="px-3 py-2 text-right">금액</th>
              {hasNw && <th className="px-3 py-2 text-right">N.W.(kg)</th>}
              {hasGw && <th className="px-3 py-2 text-right">G.W.(kg)</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {doc.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2 text-slate-500">{l.lineNo}</td>
                <td className="px-3 py-2 font-mono text-xs">{l.productCode ?? "-"}</td>
                <td className="px-3 py-2">
                  {l.productName}
                  {l.description && (
                    <div className="text-xs text-slate-400">{l.description}</div>
                  )}
                </td>
                {hasHs && <td className="px-3 py-2 font-mono text-xs">{l.hsCode ?? ""}</td>}
                {hasOrigin && <td className="px-3 py-2 text-xs">{l.originCountry ?? ""}</td>}
                <td className="px-3 py-2 text-right tabular-nums">{fmt(l.qty)}</td>
                <td className="px-3 py-2 text-xs">{l.uom}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(l.unitPrice)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(l.amount)}</td>
                {hasNw && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {l.netWeight !== null ? fmt(l.netWeight) : ""}
                  </td>
                )}
                {hasGw && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {l.grossWeight !== null ? fmt(l.grossWeight) : ""}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 포장 스냅샷 (R-정정 — 포함 라인 스코프) */}
      {doc.packagesSnapshot.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            포장 스냅샷 (문서 포함 라인만)
          </h2>
          <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">품목</th>
                  <th className="px-3 py-2 text-right">포장수</th>
                  <th className="px-3 py-2">유형</th>
                  <th className="px-3 py-2 text-right">G.W.(kg)</th>
                  <th className="px-3 py-2 text-right">CBM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {doc.packagesSnapshot.map((p, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{p.itemName ?? "-"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {p.packageCount !== null ? fmt(p.packageCount) : ""}
                    </td>
                    <td className="px-3 py-2 text-xs">{p.packageType ?? ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {p.grossWeightKg !== null ? fmt(p.grossWeightKg) : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {p.cbm !== null ? fmt(p.cbm) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!cancelled && (
        <CancelDocumentButton
          documentId={doc.id}
          docNumber={doc.docNumber}
          shipmentId={doc.shipmentId}
        />
      )}
    </div>
  );
}
