import Link from "next/link";
import { listInquiries } from "@/services/inquiries";
import type { Inquiry } from "@/services/types";
import { PageHeader } from "@/components/PageHeader";
import { Badge, type BadgeVariant } from "@/components/Badge";
import { INQUIRY_STATUS, PAYMENT_TERMS, labelOf } from "@/services/codes";

// 항상 요청 시점에 최신 데이터를 읽는다.
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  received: "zinc",
  reviewing: "amber",
  quoted: "blue",
  negotiating: "violet",
  won: "green",
  lost: "red",
};

export default async function InquiriesPage() {
  let inquiries: Inquiry[] = [];
  let errorMessage: string | null = null;

  try {
    inquiries = await listInquiries();
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader
        title="문의"
        subtitle="Inquiries"
        count={errorMessage ? undefined : inquiries.length}
        action={{ href: "/inquiries/new", label: "+ 문의 등록" }}
      />

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">데이터를 불러오지 못했습니다.</p>
          <p className="mt-1 break-all text-red-600">{errorMessage}</p>
        </div>
      ) : inquiries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          등록된 문의가 없습니다. 우측 상단 &ldquo;+ 문의 등록&rdquo;으로 추가하세요.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">접수일</th>
                <th className="px-4 py-3 font-medium">거래처</th>
                <th className="px-4 py-3 font-medium">품목</th>
                <th className="px-4 py-3 font-medium">수량</th>
                <th className="px-4 py-3 font-medium">목적지</th>
                <th className="px-4 py-3 font-medium">인코텀즈</th>
                <th className="px-4 py-3 font-medium">결제조건</th>
                <th className="px-4 py-3 font-medium">상태</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {inquiries.map((q) => (
                <tr key={q.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 text-zinc-600 tabular-nums">
                    {q.inquiryDate ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {q.partnerName ?? <span className="text-zinc-300">-</span>}
                    {q.partnerCountry ? (
                      <span className="block text-xs text-zinc-400">
                        {q.partnerCountry}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/inquiries/${q.id}`}
                      className="font-medium text-zinc-900 hover:text-blue-700 hover:underline"
                    >
                      {q.productName || "(품목 미입력)"}
                    </Link>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      {q.hsCode ? (
                        <span className="font-mono text-xs text-zinc-400">
                          {q.hsCode}
                        </span>
                      ) : null}
                      {q.productId ? <Badge variant="blue">연결</Badge> : null}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600 tabular-nums">
                    {q.quantity != null
                      ? `${q.quantity.toLocaleString()}${q.unit ? ` ${q.unit}` : ""}`
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {q.destinationCountry ?? "-"}
                    {q.destinationPort || q.destinationAirport ? (
                      <span className="block text-xs text-zinc-400">
                        {[q.destinationPort, q.destinationAirport]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{q.incoterms ?? "-"}</td>
                  <td className="px-4 py-3 text-zinc-600">
                    {q.paymentTerms
                      ? labelOf(PAYMENT_TERMS, q.paymentTerms)
                      : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[q.status] ?? "zinc"}>
                      {labelOf(INQUIRY_STATUS, q.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/quotations/new?from=${q.id}`}
                      className="whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                    >
                      → 견적 생성
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-zinc-400">
        P1 진행 중 · 품목명을 클릭하면 수정 · &ldquo;연결&rdquo; 배지 = 품목 마스터에 링크됨 · 데이터 출처: Supabase
      </p>
    </div>
  );
}
