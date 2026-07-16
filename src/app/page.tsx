import Link from "next/link";
import { getDeadlineSummary } from "@/services/deadlines";
import { getNegativeStockCount } from "@/services/stock";
import { PageHeader } from "@/components/PageHeader";
import type { DeadlineSummary } from "@/services/types";

// 오늘(KST) 기준으로 매 요청 시 요약을 계산한다.
export const dynamic = "force-dynamic";

const QUICK_LINKS = [
  { href: "/quotations", label: "견적" },
  { href: "/sales-orders", label: "수주" },
  { href: "/purchase-orders", label: "발주" },
  { href: "/shipments", label: "선적" },
  { href: "/stock", label: "현재고" },
  { href: "/partners", label: "거래처" },
  { href: "/fx-rates", label: "환율 대장" },
];

export default async function Home() {
  let summary: DeadlineSummary = { overdue: 0, within7: 0 };
  let errored = false;
  try {
    summary = await getDeadlineSummary();
  } catch {
    errored = true;
  }

  // 마이너스 재고 = 어딘가 전기 누락 신호(원칙 8). 기일 배지와 나란히 띄운다.
  // 실패해도 홈이 죽지 않게 별도 try — 기일 요약과 독립.
  let negativeStock: number | null = null;
  try {
    negativeStock = await getNegativeStockCount();
  } catch {
    negativeStock = null;
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <PageHeader title="대시보드" subtitle="Home" />

      {/* 임박 기일 요약 카드 (숫자만 — 클릭 시 목록으로) */}
      <Link
        href="/deadlines"
        className="block rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-500">임박 기일</p>
            {errored ? (
              <p className="mt-2 text-sm text-zinc-400">요약을 불러오지 못했습니다.</p>
            ) : (
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                <span className={summary.overdue > 0 ? "text-red-600" : "text-zinc-400"}>
                  지남 {summary.overdue}
                </span>
                <span className="mx-3 text-zinc-300">·</span>
                <span className={summary.within7 > 0 ? "text-amber-600" : "text-zinc-400"}>
                  7일 내 {summary.within7}
                </span>
              </p>
            )}
          </div>
          <span className="text-2xl text-zinc-300">→</span>
        </div>
        <p className="mt-3 text-xs text-zinc-400">
          선적 마일스톤·수주/발주 납기·견적 유효기일 · 오늘(한국) 기준
        </p>
      </Link>

      {/* 마이너스 재고 배지 — 원칙 8: 마이너스는 차단하지 않되 반드시 눈에 띄게 한다. */}
      <Link
        href="/stock"
        className="mt-4 block rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-500">마이너스 재고</p>
            {negativeStock === null ? (
              <p className="mt-2 text-sm text-zinc-400">요약을 불러오지 못했습니다.</p>
            ) : (
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                <span className={negativeStock > 0 ? "text-red-600" : "text-zinc-400"}>
                  {negativeStock}건
                </span>
              </p>
            )}
          </div>
          <span className="text-2xl text-zinc-300">→</span>
        </div>
        <p className="mt-3 text-xs text-zinc-400">
          현재고가 음수인 품목 · 입고 전기 누락 신호일 수 있습니다
        </p>
      </Link>

      {/* 빠른 이동 */}
      <div className="mt-8">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-400">
          빠른 이동
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {QUICK_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
