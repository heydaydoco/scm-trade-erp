import Link from "next/link";
import { listDeliveries } from "@/services/deliveries";
import { DELIVERY_STATUS, labelOf } from "@/services/codes";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

/**
 * 출고 목록 (SPEC B8). 취소분도 남는다 — 삭제가 아니라 상태 + 원장 역분개(원칙 1·5).
 */
export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status = sp.status;

  let rows: Awaited<ReturnType<typeof listDeliveries>> = [];
  let loadError: string | null = null;
  try {
    rows = await listDeliveries({ status });
  } catch (e) {
    loadError = e instanceof Error ? e.message : "데이터를 불러오지 못했습니다.";
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title="출고" subtitle="Delivery" count={rows.length} />

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
              href={f.key ? `/deliveries?status=${f.key}` : "/deliveries"}
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
          출고는 수주에서 시작합니다 — 수주를 열고 [이 수주로 출고 등록]
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">출고번호</th>
              <th className="px-4 py-3">증빙일</th>
              <th className="px-4 py-3">수주</th>
              <th className="px-4 py-3">고객</th>
              <th className="px-4 py-3">창고</th>
              <th className="px-4 py-3 text-right">수량</th>
              <th className="px-4 py-3">상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  출고 기록이 없습니다.
                </td>
              </tr>
            )}
            {rows.map((d) => {
              const cancelled = d.status === "cancelled";
              const sum = d.lines.reduce((s, l) => s + l.qty, 0);
              return (
                <tr
                  key={d.id}
                  className={`hover:bg-slate-50 ${cancelled ? "opacity-55" : ""}`}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/deliveries/${d.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {d.deliveryNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{d.deliveryDate}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/sales-orders/${d.refDocId}`}
                      className="text-violet-700 hover:underline"
                    >
                      {d.soNumber ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{d.partnerName ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{d.warehouseCode}</td>
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
                      {labelOf(DELIVERY_STATUS, d.status)}
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
