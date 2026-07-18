import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Badge, type BadgeVariant } from "@/components/Badge";
import { listTradeDocuments } from "@/services/tradeDocuments";
import { CURRENCY_SYMBOL } from "@/services/codes";

export const dynamic = "force-dynamic";

/**
 * 무역서류(CI/PL) 목록 — 전부 발행 시점 헤더 스냅샷 컬럼(마스터 조인 0).
 * CANCELLED 도 이력으로 남긴다(삭제 없음). 발행은 선적 상세에서 시작한다
 * (조합(고객×통화) 도출에 선적 화물이 필요하다).
 */

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  issued: "green",
  cancelled: "red",
};

function formatMoney(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? "";
  return `${symbol}${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

export default async function TradeDocumentsPage() {
  let rows: Awaited<ReturnType<typeof listTradeDocuments>> = [];
  let loadError: string | null = null;
  try {
    rows = await listTradeDocuments();
  } catch (e) {
    loadError = e instanceof Error ? e.message : "데이터를 불러오지 못했습니다.";
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader
        title="무역서류"
        subtitle="Commercial Invoice / Packing List"
        count={rows.length}
      />
      <p className="mb-4 text-xs text-slate-500">
        발행은 <b>선적 상세의 [무역서류] 섹션</b>에서 (고객×통화) 조합을 골라
        시작합니다. 한 번의 발행 = CI+PL 세트 = 번호 1개 — 발행 후 수정은 없고,
        취소(사유 필수) 후 재발행(새 번호)만 있습니다. 저장 상태값은 소문자
        (issued/cancelled), 화면 표기는 대문자입니다.
      </p>

      {loadError && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">번호</th>
              <th className="px-4 py-3">선적</th>
              <th className="px-4 py-3">고객</th>
              <th className="px-4 py-3">통화</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">발행일</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && !loadError ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  발행된 무역서류가 없습니다 — 선적 상세에서 발행하세요.
                </td>
              </tr>
            ) : (
              rows.map((d) => {
                const cancelled = d.status === "cancelled";
                return (
                  <tr key={d.id} className={cancelled ? "opacity-55" : ""}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/documents/${d.id}`}
                        className="font-mono font-medium text-blue-700 hover:underline"
                      >
                        {d.docNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/shipments/${d.shipmentId}`}
                        className="font-mono text-blue-700 hover:underline"
                      >
                        {d.shipmentNo ?? "(선적)"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{d.buyerName}</td>
                    <td className="px-4 py-3">{d.currency}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {cancelled ? (
                        <s>{formatMoney(d.totalAmount, d.currency)}</s>
                      ) : (
                        formatMoney(d.totalAmount, d.currency)
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[d.status] ?? "zinc"}>
                        {d.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">{d.issueDate}</td>
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
