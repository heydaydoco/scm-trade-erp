import Link from "next/link";
import { BASE_CURRENCY } from "@/config/company";
import type { LatestRate } from "@/services/types";

/**
 * 환율 프리필 출처 힌트 (견적·수주 폼 공용) — 투명성.
 * 대장 최신값·수동입력·미등록을 폼 환율칸 아래에 안내한다.
 */
export function FxHint({
  currency,
  latest,
  source,
}: {
  currency: string;
  latest: LatestRate | null;
  source: string;
}) {
  if (currency === BASE_CURRENCY) {
    return (
      <p className="mt-1 text-[11px] text-zinc-400">기준통화 — 환율은 항상 1입니다.</p>
    );
  }
  if (source === "수동입력") {
    return <p className="mt-1 text-[11px] text-amber-600">✎ 수동 입력됨 (대장값 아님)</p>;
  }
  if (latest) {
    return (
      <p className="mt-1 text-[11px] text-blue-600">
        대장 최신: 1 {currency} = {latest.rate} {BASE_CURRENCY}
        {latest.source ? ` · ${latest.source}` : ""}
        {latest.rateDate ? ` · ${latest.rateDate} 고시` : ""}
      </p>
    );
  }
  return (
    <p className="mt-1 text-[11px] text-zinc-400">
      대장에 {currency} 환율이 없습니다 — 직접 입력하거나{" "}
      <Link href="/fx-rates/new" className="text-blue-600 hover:underline">
        환율 대장에 등록
      </Link>
      하세요.
    </p>
  );
}
