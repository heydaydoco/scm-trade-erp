import { listPartners } from "@/services/partners";
import type { Partner, PartnerType } from "@/services/types";

// 항상 요청 시점에 최신 데이터를 읽는다 (빌드 타임 정적 캐시 X).
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<PartnerType, string> = {
  customer: "고객",
  supplier: "공급사",
  both: "고객·공급사",
  unknown: "미분류",
};

const TYPE_BADGE: Record<PartnerType, string> = {
  customer: "bg-blue-50 text-blue-700 ring-blue-200",
  supplier: "bg-amber-50 text-amber-700 ring-amber-200",
  both: "bg-violet-50 text-violet-700 ring-violet-200",
  unknown: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};

export default async function PartnersPage() {
  let partners: Partner[] = [];
  let errorMessage: string | null = null;

  try {
    partners = await listPartners();
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              SCM · Trade ERP
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-900">
              거래처 <span className="font-normal text-zinc-400">Partners</span>
            </h1>
          </div>
          {!errorMessage && (
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-600">
              총 {partners.length}곳
            </span>
          )}
        </header>

        {errorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p className="font-semibold">데이터를 불러오지 못했습니다.</p>
            <p className="mt-1 break-all text-red-600">{errorMessage}</p>
          </div>
        ) : partners.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-10 text-center text-zinc-500">
            등록된 거래처가 없습니다.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">거래처명</th>
                  <th className="px-4 py-3 font-medium">구분</th>
                  <th className="px-4 py-3 font-medium">국가 · 도시</th>
                  <th className="px-4 py-3 font-medium">통화</th>
                  <th className="px-4 py-3 font-medium">담당자</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {partners.map((p) => (
                  <tr key={p.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium text-zinc-900">{p.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TYPE_BADGE[p.type]}`}
                      >
                        {TYPE_LABEL[p.type]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {p.country ?? "-"}
                      {p.city ? (
                        <span className="text-zinc-400"> · {p.city}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{p.currency ?? "-"}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      {p.contactName ?? "-"}
                      {p.contactEmail ? (
                        <span className="block text-xs text-zinc-400">
                          {p.contactEmail}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 text-xs text-zinc-400">
          P0 워킹 스켈레톤 · 데이터 출처: Supabase (읽기 전용)
        </p>
      </div>
    </main>
  );
}
