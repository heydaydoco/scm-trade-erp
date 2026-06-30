import Link from "next/link";
import { listItems } from "@/services/items";
import type { Item } from "@/services/types";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/Badge";
import { CURRENCY_SYMBOL } from "@/services/codes";

// 항상 요청 시점에 최신 데이터를 읽는다.
export const dynamic = "force-dynamic";

/** 표준단가 + 통화 표시 (없으면 '-'). */
function formatPrice(item: Item): string {
  if (item.stdPrice == null) return "-";
  const symbol = item.currency ? CURRENCY_SYMBOL[item.currency] ?? "" : "";
  const amount = item.stdPrice.toLocaleString();
  return `${symbol}${amount}${item.currency ? ` ${item.currency}` : ""}`;
}

export default async function ItemsPage() {
  let items: Item[] = [];
  let errorMessage: string | null = null;

  try {
    items = await listItems();
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader
        title="품목"
        subtitle="Items"
        count={errorMessage ? undefined : items.length}
        action={{ href: "/items/new", label: "+ 품목 등록" }}
      />

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">데이터를 불러오지 못했습니다.</p>
          <p className="mt-1 break-all text-red-600">{errorMessage}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          등록된 품목이 없습니다. 우측 상단 &ldquo;+ 품목 등록&rdquo;으로 추가하세요.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">품목코드</th>
                <th className="px-4 py-3 font-medium">품목명</th>
                <th className="px-4 py-3 font-medium">HS코드</th>
                <th className="px-4 py-3 font-medium">단위</th>
                <th className="px-4 py-3 font-medium">표준단가</th>
                <th className="px-4 py-3 font-medium">원산지</th>
                <th className="px-4 py-3 font-medium">관리</th>
                <th className="px-4 py-3 font-medium">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={`hover:bg-zinc-50 ${item.active ? "" : "opacity-50"}`}
                >
                  <td className="px-4 py-3">
                    {item.code ? (
                      <span className="font-mono text-xs text-zinc-500">
                        {item.code}
                      </span>
                    ) : (
                      <span className="text-zinc-300">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/items/${item.id}`}
                      className="font-medium text-zinc-900 hover:text-blue-700 hover:underline"
                    >
                      {item.name || "(이름 없음)"}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {item.hsCode ? (
                      <span className="font-mono text-xs text-zinc-600">
                        {item.hsCode}
                      </span>
                    ) : (
                      <span className="text-zinc-300">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{item.baseUom ?? "-"}</td>
                  <td className="px-4 py-3 text-zinc-600 tabular-nums">
                    {formatPrice(item)}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {item.originCountry ?? "-"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {item.isDangerous ? (
                        <Badge variant="red">위험물</Badge>
                      ) : null}
                      {item.lotManaged ? <Badge variant="blue">로트</Badge> : null}
                      {item.serialManaged ? (
                        <Badge variant="violet">시리얼</Badge>
                      ) : null}
                      {!item.isDangerous &&
                      !item.lotManaged &&
                      !item.serialManaged ? (
                        <span className="text-zinc-300">-</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {item.active ? (
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
        P1 진행 중 · 품목명을 클릭하면 수정 · 데이터 출처: Supabase
      </p>
    </div>
  );
}
