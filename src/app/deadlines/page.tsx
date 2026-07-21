import Link from "next/link";
import { listDeadlines, todayKst, type DeadlineWindow } from "@/services/deadlines";
import type { DeadlineItem } from "@/services/types";
import { PageHeader } from "@/components/PageHeader";
import { Badge, type BadgeVariant } from "@/components/Badge";

// 항상 요청 시점(=오늘 KST)에 계산한다.
export const dynamic = "force-dynamic";

const DOC_HREF: Record<string, string> = {
  shipment: "/shipments",
  sales_order: "/sales-orders",
  purchase_order: "/purchase-orders",
  quotation: "/quotations",
  customs_declaration: "/customs",
};

/** D-day 강조 — 지남 > 오늘/D-1 > D-3 > D-7 > 그 외 (원칙: 지남이 최상단·최강조). */
function dVariant(d: number): BadgeVariant {
  if (d < 0) return "red"; // 지남
  if (d <= 1) return "amber"; // 오늘·D-1
  if (d <= 3) return "violet"; // D-2~3
  if (d <= 7) return "blue"; // D-4~7
  return "zinc";
}
function dLabel(d: number): string {
  if (d < 0) return `${-d}일 지남`;
  if (d === 0) return "오늘 D-DAY";
  return `D-${d}`;
}

const WINDOWS: { key: DeadlineWindow; label: string }[] = [
  { key: "default", label: "기본 (지남 + 30일)" },
  { key: "overdue", label: "지남만" },
  { key: "all", label: "전체" },
];

export default async function DeadlinesPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const sp = await searchParams;
  const window: DeadlineWindow =
    sp.window === "all" || sp.window === "overdue" ? sp.window : "default";

  let items: DeadlineItem[] = [];
  let errorMessage: string | null = null;
  try {
    items = await listDeadlines(window);
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }
  const today = todayKst();

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader
        title="임박 기일"
        subtitle="Deadlines"
        count={errorMessage ? undefined : items.length}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {WINDOWS.map((w) => (
          <Link
            key={w.key}
            href={`/deadlines?window=${w.key}`}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              window === w.key
                ? "bg-zinc-900 font-medium text-white"
                : "border border-zinc-300 text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {w.label}
          </Link>
        ))}
        <span className="ml-auto text-xs text-zinc-400">
          기준일(오늘, 한국): {today}
        </span>
      </div>

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">데이터를 불러오지 못했습니다.</p>
          <p className="mt-1 break-all text-red-600">{errorMessage}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          {window === "overdue"
            ? "지난 기일이 없습니다."
            : "임박한 기일이 없습니다. 선적 마일스톤·수주/발주 납기·견적 유효기일이 여기 모입니다."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">D-day</th>
                <th className="px-4 py-3 font-medium">기일</th>
                <th className="px-4 py-3 font-medium">소스 · 유형</th>
                <th className="px-4 py-3 font-medium">문서</th>
                <th className="px-4 py-3 font-medium">거래처</th>
                <th className="px-4 py-3 font-medium">메모</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {items.map((it, i) => (
                <tr
                  key={`${it.docType}-${it.docId}-${it.kind}-${i}`}
                  className="align-top hover:bg-zinc-50"
                >
                  <td className="px-4 py-3">
                    <Badge variant={dVariant(it.dDay)}>{dLabel(it.dDay)}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-700 tabular-nums">
                    {it.date}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {it.sourceLabel}
                    <span className="block text-xs text-zinc-400">{it.kind}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`${DOC_HREF[it.docType] ?? "#"}/${it.docId}`}
                      className="font-mono text-sm text-blue-700 hover:underline"
                    >
                      {it.docNumber || "(문서)"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {it.partnerName ?? <span className="text-zinc-300">-</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">{it.memo ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-zinc-400">
        소스: 선적 마일스톤(실적 없음·취소 선적 제외) · 수주/발주 납기(완료·취소 제외) · 견적 유효기일(작성중·발송) ·
        적재의무기한(수출 수리 신고, 수리일+30 또는 연장일 — 나간/취소 선적 제외).
        &lsquo;오늘&rsquo;은 한국(Asia/Seoul) 달력 날짜 기준 · L/C·대금 만기는 후속 단계 · 데이터 출처: Supabase
      </p>
    </div>
  );
}
