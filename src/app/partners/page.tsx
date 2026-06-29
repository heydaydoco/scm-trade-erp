import Link from "next/link";
import { listPartners } from "@/services/partners";
import type { Partner } from "@/services/types";
import { PageHeader } from "@/components/PageHeader";
import { Badge, type BadgeVariant } from "@/components/Badge";
import { PARTNER_TYPE_LABEL } from "@/services/codes";

// 항상 요청 시점에 최신 데이터를 읽는다.
export const dynamic = "force-dynamic";

const TYPE_VARIANT: Record<string, BadgeVariant> = {
  customer: "blue",
  supplier: "amber",
  both: "violet",
  unknown: "zinc",
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
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader
        title="거래처"
        subtitle="Partners"
        count={errorMessage ? undefined : partners.length}
        action={{ href: "/partners/new", label: "+ 거래처 등록" }}
      />

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">데이터를 불러오지 못했습니다.</p>
          <p className="mt-1 break-all text-red-600">{errorMessage}</p>
        </div>
      ) : partners.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          등록된 거래처가 없습니다. 우측 상단 &ldquo;+ 거래처 등록&rdquo;으로 추가하세요.
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
                <th className="px-4 py-3 font-medium">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {partners.map((p) => (
                <tr
                  key={p.id}
                  className={`hover:bg-zinc-50 ${p.active ? "" : "opacity-50"}`}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/partners/${p.id}`}
                      className="font-medium text-zinc-900 hover:text-blue-700 hover:underline"
                    >
                      {p.name || "(이름 없음)"}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={TYPE_VARIANT[p.type] ?? "zinc"}>
                      {PARTNER_TYPE_LABEL[p.type] ?? p.type}
                    </Badge>
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
                  <td className="px-4 py-3">
                    {p.active ? (
                      <Badge variant="green">활성</Badge>
                    ) : (
                      <Badge variant="zinc">비활성</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-zinc-400">
        P1 진행 중 · 거래처명을 클릭하면 수정 · 데이터 출처: Supabase
      </p>
    </div>
  );
}
