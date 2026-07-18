import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { getShipment } from "@/services/shipments";
import { getPartner } from "@/services/partners";
import {
  issuableCombos,
  linesForCombo,
  listIssuableLines,
  listTradeDocumentsForShipment,
} from "@/services/tradeDocuments";
import { todayKst } from "@/lib/date";
import { IssueDocumentForm } from "./IssueDocumentForm";

export const dynamic = "force-dynamic";

/**
 * 무역서류 발행 폼 — 생성 단위 = (선적×고객×통화) 조합(D4). 선적 상세의
 * [무역서류] 섹션에서 조합을 골라 진입한다.
 *
 * 원천 파생값(qty·uom·단가·금액·할인)은 read-only 미리보기 — 진실은 서버
 * 재계산(클라 값 불신). 폼은 보충 필드(HS·원산지·설명·N.W.·G.W.)만 입력한다.
 */

function GuidePanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {children}
    </div>
  );
}

export default async function IssueDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ shipment?: string; customer?: string; currency?: string }>;
}) {
  const sp = await searchParams;
  const shipmentId = sp.shipment?.trim() || null;
  const customerId = sp.customer?.trim() || null;
  const currency = sp.currency?.trim() || null;

  if (!shipmentId || !customerId || !currency) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-8">
        <PageHeader title="무역서류 발행" />
        <GuidePanel>
          발행 대상(선적×고객×통화)이 지정되지 않았습니다 —{" "}
          <Link href="/shipments" className="font-medium underline">
            선적 목록
          </Link>
          에서 선적 상세의 [무역서류] 섹션으로 진입해 조합을 선택하세요.
        </GuidePanel>
      </div>
    );
  }

  const [shipment, issuable, docs, partner] = await Promise.all([
    getShipment(shipmentId),
    listIssuableLines(shipmentId),
    listTradeDocumentsForShipment(shipmentId),
    getPartner(customerId),
  ]);
  if (!shipment) notFound();

  const backLink = (
    <Link href={`/shipments/${shipmentId}`} className="font-medium underline">
      ← 선적 상세로
    </Link>
  );

  if (shipment.status === "cancelled") {
    return (
      <div className="mx-auto max-w-5xl px-8 py-8">
        <PageHeader title="무역서류 발행" subtitle={shipment.shipNumber} />
        <GuidePanel>
          취소된 선적에는 무역서류를 발행할 수 없습니다. {backLink}
        </GuidePanel>
      </div>
    );
  }

  // 조합 스코프 필터 — 서버(RPC)도 같은 스코프를 라인 단위로 재검증한다.
  const comboLines = linesForCombo(issuable, customerId, currency);
  const { warnings: comboWarnings } = issuableCombos(issuable);
  const excludedPoCount = issuable.filter((l) => l.orderType === "PO").length;

  if (comboLines.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-8">
        <PageHeader title="무역서류 발행" subtitle={shipment.shipNumber} />
        <GuidePanel>
          이 (고객×통화) 조합으로 발행할 수 있는 SO 라인이 없습니다. {backLink}
          {comboWarnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {comboWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </GuidePanel>
      </div>
    );
  }

  // 같은 (선적×고객×통화) 활성 문서가 있으면 발행 불가 — 취소 후 재발행(D1).
  const activeDoc =
    docs.find(
      (d) =>
        d.status === "issued" &&
        d.customerId === customerId &&
        d.currency === currency,
    ) ?? null;
  if (activeDoc) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-8">
        <PageHeader title="무역서류 발행" subtitle={shipment.shipNumber} />
        <GuidePanel>
          이 (선적×고객×통화)에는 이미 발행된 무역서류{" "}
          <Link
            href={`/documents/${activeDoc.id}`}
            className="font-mono font-medium underline"
          >
            {activeDoc.docNumber}
          </Link>{" "}
          가 있습니다 — 수정하려면 먼저 취소한 후 재발행하세요(새 번호). {backLink}
        </GuidePanel>
      </div>
    );
  }

  const customerName =
    comboLines[0].customerName ?? partner?.name ?? "(고객명 미상)";
  const buyerAddressBlank = !partner?.address?.trim();

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader
        title="무역서류 발행"
        subtitle={`${shipment.shipNumber} · ${customerName} · ${currency}`}
      />
      <div className="-mt-2 mb-4 text-sm">
        <Link
          href={`/shipments/${shipmentId}`}
          className="text-zinc-500 hover:text-blue-700 hover:underline"
        >
          ← 선적 상세로
        </Link>
      </div>
      <IssueDocumentForm
        shipmentId={shipmentId}
        customerId={customerId}
        customerName={customerName}
        currency={currency}
        lines={comboLines}
        buyerAddressBlank={buyerAddressBlank}
        comboWarnings={comboWarnings}
        excludedPoCount={excludedPoCount}
        defaultIssueDate={todayKst()}
      />
    </div>
  );
}
