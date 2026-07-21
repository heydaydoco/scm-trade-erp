import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomsDeclaration } from "@/services/customsDeclarations";
import { effectiveLoadingDeadline } from "@/services/customsDeclLogic";
import { PageHeader } from "@/components/PageHeader";
import { Badge, type BadgeVariant } from "@/components/Badge";
import { CURRENCY_SYMBOL, CUSTOMS_DECL_STATUS, DECL_TYPE, labelOf } from "@/services/codes";
import { flowHref } from "@/services/chainLogic";
import { CustomsDeclForm } from "../CustomsDeclForm";
import { CancelDeclarationButton } from "./CancelDeclarationButton";

export const dynamic = "force-dynamic";

/**
 * 통관신고 상세 — draft/filed 는 편집 폼, accepted/cancelled 는 읽기 전용.
 * accepted 는 수정 없이 취소만(취소 후 새로 작성). 수출·수리 시 effective 적재의무기한 표시.
 */

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: "zinc",
  filed: "blue",
  accepted: "green",
  cancelled: "red",
};

function money(amount: number | null, currency: string | null): string {
  if (amount === null) return "-";
  const symbol = currency ? CURRENCY_SYMBOL[currency] ?? "" : "";
  return `${symbol}${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}${
    currency ? ` ${currency}` : ""
  }`;
}

export default async function CustomsDeclarationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const decl = await getCustomsDeclaration(id);
  if (!decl) notFound();

  const cancelled = decl.status === "cancelled";
  const accepted = decl.status === "accepted";
  const editable = decl.status === "draft" || decl.status === "filed";
  const justSaved = sp.saved === "1";

  const effDeadline =
    decl.declType === "export" && accepted
      ? effectiveLoadingDeadline(decl.acceptanceDate, decl.loadingDeadlineExtended)
      : null;

  // 읽기 전용(accepted/cancelled) 표시용 필드 목록
  const commonRows: [string, string | null][] = [
    ["세관 신고번호", decl.customsDeclNo],
    ["신고일", decl.filingDate],
    ["수리일", decl.acceptanceDate],
    ["관세사", decl.brokerName],
  ];
  const typeRows: [string, string | null][] =
    decl.declType === "export"
      ? [
          ["적재의무기한 연장승인일", decl.loadingDeadlineExtended],
          [
            "적재의무기한(계산값)",
            effDeadline ? `${effDeadline} (수리일+30 또는 연장일)` : null,
          ],
        ]
      : [
          ["과세가격", money(decl.taxableValue, decl.taxCurrency)],
          ["관세액", money(decl.dutyAmount, decl.taxCurrency)],
          ["부가세액", money(decl.vatAmount, decl.taxCurrency)],
          ["세액 통화", decl.taxCurrency],
        ];

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="flex items-start justify-between gap-4">
        <PageHeader title="통관신고" subtitle={decl.declDocNo} />
        <div className="flex items-center gap-2 pt-1">
          <Badge variant="zinc">{labelOf(DECL_TYPE, decl.declType)}</Badge>
          <Badge variant={STATUS_VARIANT[decl.status] ?? "zinc"}>
            {labelOf(CUSTOMS_DECL_STATUS, decl.status)}
          </Badge>
        </div>
      </div>

      <div className="-mt-2 mb-4 flex flex-wrap gap-4 text-sm">
        <Link href="/customs" className="text-zinc-500 hover:text-blue-700 hover:underline">
          ← 통관신고 목록
        </Link>
        <Link href={`/shipments/${decl.shipmentId}`} className="text-blue-700 hover:underline">
          선적 상세{decl.shipmentNo ? ` (${decl.shipmentNo})` : ""} →
        </Link>
        <Link
          href={flowHref("customsDeclaration", decl.id)}
          className="font-medium text-indigo-700 hover:underline"
        >
          🔗 문서 흐름 →
        </Link>
      </div>

      {justSaved && (
        <div className="mb-6 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">통관신고 {decl.declDocNo} 가 저장되었습니다.</p>
        </div>
      )}

      {cancelled && (
        <div className="mb-6 rounded-md border-2 border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-bold">CANCELLED — 취소된 통관신고입니다.</p>
          <p className="mt-1">
            사유: {decl.cancelReason ?? "-"}
            {decl.cancelledAt && (
              <span className="ml-2 text-xs text-red-600">
                ({new Date(decl.cancelledAt).toLocaleString("ko-KR")})
              </span>
            )}
          </p>
          <p className="mt-1 text-xs">번호는 이력으로 남습니다. 수정하려면 새로 작성하세요.</p>
        </div>
      )}

      {accepted && (
        <div className="mb-6 rounded-md border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-800">
          수리 완료된 신고는 <b>읽기 전용</b>입니다(수정 없음). 정정이 필요하면 취소 후 새로
          작성하세요.
          {effDeadline && (
            <p className="mt-1 font-medium">
              적재의무기한(계산): {effDeadline} — 수리일 + 30일(연장 시 연장일).
            </p>
          )}
        </div>
      )}

      {editable ? (
        <>
          <p className="mb-4 text-xs text-slate-500">
            작성중/신고 상태에서는 수정할 수 있습니다. 수리(accepted)로 저장하면 이후 수정이
            잠기고 취소만 가능합니다.
          </p>
          <CustomsDeclForm
            shipmentId={decl.shipmentId}
            shipmentNo={decl.shipmentNo}
            shipmentDirection={null} // 수정 모드에선 유형이 불변이라 미사용(신규 기본값 전용)
            declaration={decl}
          />
          <div className="mt-8 border-t border-zinc-100 pt-6">
            <CancelDeclarationButton
              declarationId={decl.id}
              declDocNo={decl.declDocNo}
              shipmentId={decl.shipmentId}
            />
          </div>
        </>
      ) : (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-4 text-sm sm:grid-cols-3">
            {[...commonRows, ...typeRows].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd>{value ?? "-"}</dd>
              </div>
            ))}
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-xs text-slate-500">메모</dt>
              <dd className="whitespace-pre-line">{decl.memo ?? "-"}</dd>
            </div>
          </dl>

          {accepted && (
            <CancelDeclarationButton
              declarationId={decl.id}
              declDocNo={decl.declDocNo}
              shipmentId={decl.shipmentId}
            />
          )}
        </>
      )}
    </div>
  );
}
