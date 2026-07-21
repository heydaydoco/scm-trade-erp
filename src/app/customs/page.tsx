import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Badge, type BadgeVariant } from "@/components/Badge";
import { listCustomsDeclarations } from "@/services/customsDeclarations";
import { CUSTOMS_DECL_STATUS, DECL_TYPE, labelOf } from "@/services/codes";

export const dynamic = "force-dynamic";

/**
 * 통관신고(E6 수출 / E9 수입) 목록 — 취소 포함(이력 보존). 유형 탭으로 필터.
 * 작성은 선적 상세의 [통관신고] 섹션 또는 선적을 지정해 시작한다(선적 앵커).
 */

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: "zinc",
  filed: "blue",
  accepted: "green",
  cancelled: "red",
};

const TABS: { key: string; label: string; type?: string }[] = [
  { key: "all", label: "전체" },
  { key: "export", label: "수출", type: "export" },
  { key: "import", label: "수입", type: "import" },
];

export default async function CustomsDeclarationsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const sp = await searchParams;
  const declType = sp.type === "export" || sp.type === "import" ? sp.type : undefined;

  let rows: Awaited<ReturnType<typeof listCustomsDeclarations>> = [];
  let loadError: string | null = null;
  try {
    rows = await listCustomsDeclarations({ declType });
  } catch (e) {
    loadError = e instanceof Error ? e.message : "데이터를 불러오지 못했습니다.";
  }

  const activeTab = declType ?? "all";

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title="통관신고" subtitle="Customs Declaration (E6/E9)" count={rows.length} />
      <p className="mb-4 text-xs text-slate-500">
        수출·수입 통관신고는 <b>선적 상세의 [통관신고] 섹션</b>에서 선적을 앵커로 작성합니다.
        신고필증은 세관 발행물이라 인쇄 기능이 없습니다. 세액은 관세사 통지값을 기록만 하며
        시스템이 계산·단정하지 않습니다. 저장 상태값은 소문자, 화면 표기는 라벨입니다.
      </p>

      <div className="mb-4 flex gap-2">
        {TABS.map((t) => {
          const active = activeTab === t.key;
          return (
            <Link
              key={t.key}
              href={t.type ? `/customs?type=${t.type}` : "/customs"}
              className={`rounded-full px-3 py-1 text-sm ${
                active
                  ? "bg-zinc-900 font-medium text-white"
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {loadError && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">번호</th>
              <th className="px-4 py-3">유형</th>
              <th className="px-4 py-3">선적</th>
              <th className="px-4 py-3">세관 신고번호</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">신고일</th>
              <th className="px-4 py-3">수리일</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && !loadError ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  통관신고가 없습니다 — 선적 상세에서 작성하세요.
                </td>
              </tr>
            ) : (
              rows.map((d) => {
                const cancelled = d.status === "cancelled";
                return (
                  <tr key={d.id} className={cancelled ? "opacity-55" : ""}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/customs/${d.id}`}
                        className="font-mono font-medium text-blue-700 hover:underline"
                      >
                        {d.declDocNo}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{labelOf(DECL_TYPE, d.declType)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/shipments/${d.shipmentId}`}
                        className="font-mono text-blue-700 hover:underline"
                      >
                        {d.shipmentNo ?? "(선적)"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{d.customsDeclNo ?? "-"}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[d.status] ?? "zinc"}>
                        {labelOf(CUSTOMS_DECL_STATUS, d.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">{d.filingDate ?? "-"}</td>
                    <td className="px-4 py-3">{d.acceptanceDate ?? "-"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
