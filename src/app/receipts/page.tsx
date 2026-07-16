import Link from "next/link";
import { listReceipts } from "@/services/receipts";
import { GR_STATUS, labelOf } from "@/services/codes";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

/**
 * 입고 목록 (SPEC C5). 취소분도 남는다 — 삭제가 아니라 상태 + 원장 역분개(원칙 1·5).
 */
export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status = sp.status;

  let rows: Awaited<ReturnType<typeof listReceipts>> = [];
  let loadError: string | null = null;
  try {
    rows = await listReceipts({ status });
  } catch (e) {
    loadError = e instanceof Error ? e.message : "데이터를 불러오지 못했습니다.";
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title="입고" subtitle="Goods Receipt" count={rows.length} />

      {loadError && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          데이터를 불러오지 못했습니다: {loadError}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {[
          { key: undefined, label: "전체" },
          { key: "normal", label: "정상" },
          { key: "cancelled", label: "취소" },
        ].map((f) => {
          const active = status === f.key;
          return (
            <Link
              key={f.label}
              href={f.key ? `/receipts?status=${f.key}` : "/receipts"}
              className={`rounded-md border px-3 py-1.5 ${
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
        <span className="ml-auto text-xs text-slate-500">
          입고는 발주에서 시작합니다 — 발주를 열고 [이 발주로 입고 등록]
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">입고번호</th>
              <th className="px-4 py-3">증빙일</th>
              <th className="px-4 py-3">발주</th>
              <th className="px-4 py-3">공급사</th>
              <th className="px-4 py-3">창고</th>
              <th className="px-4 py-3 text-right">수량</th>
              <th className="px-4 py-3">상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  입고 기록이 없습니다.
                </td>
              </tr>
            )}
            {rows.map((g) => {
              const cancelled = g.status === "cancelled";
              const sum = g.lines.reduce((s, l) => s + l.qty, 0);
              return (
                <tr key={g.id} className={`hover:bg-slate-50 ${cancelled ? "opacity-55" : ""}`}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/receipts/${g.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {g.grNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{g.receiptDate}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/purchase-orders/${g.refDocId}`}
                      className="text-violet-700 hover:underline"
                    >
                      {g.poNumber ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{g.partnerName ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{g.warehouseCode}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {cancelled ? <s>{sum}</s> : sum}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        cancelled
                          ? "bg-slate-100 text-slate-500"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {labelOf(GR_STATUS, g.status)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
