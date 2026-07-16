import Link from "next/link";
import { DELIVERY_STATUS, labelOf } from "@/services/codes";
import type { Delivery, SoOpenQty } from "@/services/types";

/**
 * 수주 상세의 출고 패널 — 라인별 잔량 + 출고 이력 + 잠금 안내 (P4.2 입고 패널 미러).
 *
 * 잔량은 저장된 컬럼이 아니라 뷰(so_open_qty)의 계산 결과다 — SPEC의 심장(원칙 1):
 *   잔량 = so_lines.qty − Σ(delivery_lines.qty)
 * 잠금은 원칙 5의 P4 이행분 — 살아있는 출고가 참조 중이면 수주를 수정할 수 없다.
 */
export function DeliveryPanel({
  soId,
  openLines,
  deliveries,
  liveCount,
  shipmentLineCount = 0,
}: {
  soId: string;
  openLines: SoOpenQty[];
  deliveries: Delivery[];
  liveCount: number;
  /** 이 수주 라인을 참조하는 살아있는 선적 화물 라인 수(P4.4 소비 가드). */
  shipmentLineCount?: number;
}) {
  const locked = liveCount > 0 || shipmentLineCount > 0;
  const totalOpen = openLines.reduce((s, l) => s + l.openQty, 0);
  const anyOpen = openLines.some((l) => l.openQty > 0);
  // 자유텍스트 품목(product_id null)은 원장이 받지 못한다 → 출고 불가.
  const unlinked = openLines.filter((l) => l.productId === null);

  return (
    <section className="mt-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">출고 (Delivery)</h2>
        {anyOpen && (
          <Link
            href={`/deliveries/new?fromSo=${soId}`}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
          >
            📦 이 수주로 출고 등록
          </Link>
        )}
      </div>

      {locked && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          🔒 <b>이 수주는 잠겨 있습니다</b> —{" "}
          {liveCount > 0 && <>살아있는 출고 {liveCount}건</>}
          {liveCount > 0 && shipmentLineCount > 0 && "과 "}
          {shipmentLineCount > 0 && <>선적 화물 라인(수주 라인 {shipmentLineCount}건)</>}
          이 참조 중이라 수정·취소할 수 없습니다. 수주를 고치려면{" "}
          <b>
            {liveCount > 0 && "해당 출고를 먼저 취소"}
            {liveCount > 0 && shipmentLineCount > 0 && "하고, "}
            {shipmentLineCount > 0 && "해당 선적의 '화물 내역'에서 이 수주의 라인을 삭제"}
          </b>
          하세요.
          <div className="mt-1 text-xs opacity-80">
            후속 전표가 참조하던 수주 라인이 수정으로 사라지면 그 기록이 어느 라인에서
            왔는지 알 수 없게 됩니다(원칙 5 — 확정 전표 불변).
          </div>
        </div>
      )}

      {unlinked.length > 0 && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          ⚠️ 품목 마스터에 연결되지 않은 라인 {unlinked.length}건은 출고할 수 없습니다
          (재고 원장은 등록된 품목만 받습니다). 해당 품목을{" "}
          <Link href="/items/new" className="underline">
            품목 마스터에 등록
          </Link>
          한 뒤 수주 라인에서 골라 다시 저장하세요.
        </div>
      )}

      {/* 라인별 잔량 */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">품목</th>
              <th className="px-4 py-2 text-right">수주</th>
              <th className="px-4 py-2 text-right">출고</th>
              <th className="px-4 py-2 text-right">잔량</th>
              <th className="px-4 py-2">단위</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {openLines.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  수주 라인이 없습니다.
                </td>
              </tr>
            )}
            {openLines.map((l) => (
              <tr key={l.soLineId}>
                <td className="px-4 py-2">
                  {l.productName ?? "—"}
                  {l.productId === null && (
                    <span className="ml-1 rounded bg-slate-100 px-1 text-xs text-slate-500">
                      미연결
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{l.orderedQty}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                  {l.shippedQty}
                </td>
                <td
                  className={`px-4 py-2 text-right font-medium tabular-nums ${
                    l.openQty < 0
                      ? "text-red-600"
                      : l.openQty === 0
                        ? "text-emerald-600"
                        : "text-slate-900"
                  }`}
                >
                  {l.openQty}
                  {l.openQty < 0 && (
                    <span className="ml-1 text-xs font-normal">초과</span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-500">{l.unit ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        잔량 = 수주수량 − 살아있는 출고 합계. 저장된 숫자가 아니라 매번 계산합니다(원칙 1).
        {totalOpen === 0 && openLines.length > 0 && " 전량 출고되어 수주가 완료 상태입니다."}
      </p>

      {/* 출고 이력 — 취소분도 남는다(이력은 지우지 않는다) */}
      {deliveries.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">출고번호</th>
                <th className="px-4 py-2">증빙일</th>
                <th className="px-4 py-2">창고</th>
                <th className="px-4 py-2 text-right">수량</th>
                <th className="px-4 py-2">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deliveries.map((d) => {
                const cancelled = d.status === "cancelled";
                const sum = d.lines.reduce((s, l) => s + l.qty, 0);
                return (
                  <tr key={d.id} className={cancelled ? "opacity-50" : ""}>
                    <td className="px-4 py-2">
                      <Link
                        href={`/deliveries/${d.id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {d.deliveryNo}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{d.deliveryDate}</td>
                    <td className="px-4 py-2 text-slate-600">{d.warehouseCode}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {cancelled ? <s>{sum}</s> : sum}
                    </td>
                    <td className="px-4 py-2">
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
      )}
    </section>
  );
}
