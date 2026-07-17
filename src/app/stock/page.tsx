import { listStockOnHand, resolveAdjustmentUom } from "@/services/stock";
import { listItems } from "@/services/items";
import { todayKst } from "@/lib/date";
import { PageHeader } from "@/components/PageHeader";
import { StockAdjustForm, type StockItemOption, type OnHandMap } from "./StockAdjustForm";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * 현재고 (SPEC D3) — 저장된 숫자가 아니라 원장(stock_movements) 합산 뷰다.
 * 원칙 1: 수정 가능한 잔량 필드는 이 시스템에 없다. 정정은 원장에서 역분개.
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ zero?: string }>;
}) {
  const sp = await searchParams;
  const includeZero = sp.zero === "1";

  let rows: Awaited<ReturnType<typeof listStockOnHand>> = [];
  let items: Awaited<ReturnType<typeof listItems>> = [];
  let allOnHand: Awaited<ReturnType<typeof listStockOnHand>> = [];
  let loadError: string | null = null;

  try {
    [rows, items, allOnHand] = await Promise.all([
      listStockOnHand({ includeZero }),
      listItems(),
      // 폼의 예상재고 계산엔 0도 필요하다(0에서 빼면 마이너스 경고가 떠야 하므로).
      listStockOnHand({ includeZero: true }),
    ]);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "데이터를 불러오지 못했습니다.";
  }

  // 단위는 저장 경로와 같은 규칙로 해석한다(P4.4h: 입력 unit → 마스터 unit → 거부).
  // 폼은 입력 unit 을 보내지 않으므로 마스터가 비면 null — 'PCS' 를 지어내 보여주면
  // "폼 예측 == 원장 기록" 불변식이 깨진다(저장은 RPC 가 어차피 거부). 그 품목은
  // 입고·출고 폼과 같은 방식으로 잠근다.
  const itemOptions: StockItemOption[] = items
    .filter((i) => i.active !== false)
    .map((i) => ({
      id: i.id,
      code: i.code,
      name: i.name,
      uom: resolveAdjustmentUom(null, i.baseUom),
    }));

  // 키에 단위가 들어간다 — 뷰 입도가 item×warehouse×uom 이기 때문(P4.1f).
  // 마스터 단위가 원장 기록 뒤에 바뀌면 한 품목에 두 단위 행이 생기고, 그걸 더하면
  // 100 PCS − 10 KG = 90 같은 거짓 숫자가 된다. 폼은 품목의 현재 단위 행만 본다.
  const onHandMap: OnHandMap = {};
  for (const r of allOnHand) {
    onHandMap[`${r.itemId}|${r.warehouseCode}|${r.uom}`] = r.onHand;
  }

  // 창고 마스터(A5)는 P4 후속 — 지금은 원장에 실제로 쓰인 창고 + 기본 MAIN.
  const warehouses = Array.from(
    new Set(["MAIN", ...allOnHand.map((r) => r.warehouseCode)]),
  ).sort();

  const negativeCount = rows.filter((r) => r.onHand < 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="현재고"
        subtitle="Stock on Hand"
        count={rows.length}
      />

      {loadError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          데이터를 불러오지 못했습니다: {loadError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link
          href={includeZero ? "/stock" : "/stock?zero=1"}
          className="rounded-md border px-3 py-1.5 text-slate-700 hover:bg-slate-50"
        >
          {includeZero ? "☑ 재고 0 표시 중" : "☐ 재고 0 숨김"}
        </Link>
        <Link
          href="/stock/movements"
          className="rounded-md border px-3 py-1.5 text-slate-700 hover:bg-slate-50"
        >
          📒 재고 원장 보기
        </Link>
        {negativeCount > 0 && (
          <span className="rounded-md bg-red-50 px-3 py-1.5 text-red-700">
            ⚠️ 마이너스 재고 {negativeCount}건 — 입고 전기 누락 신호일 수 있습니다
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">품목코드</th>
              <th className="px-4 py-3">품목명</th>
              <th className="px-4 py-3">창고</th>
              <th className="px-4 py-3 text-right">현재고</th>
              <th className="px-4 py-3">단위</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  {includeZero
                    ? "원장에 기록이 없습니다. 아래에서 기초재고를 등록하세요."
                    : "재고가 있는 품목이 없습니다."}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.itemId}|${r.warehouseCode}`} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs text-slate-500">
                  {r.itemCode ?? "—"}
                </td>
                <td className="px-4 py-3">{r.itemName ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{r.warehouseCode}</td>
                <td
                  className={`px-4 py-3 text-right font-medium tabular-nums ${
                    r.onHand < 0 ? "text-red-600" : "text-slate-900"
                  }`}
                >
                  {r.onHand}
                </td>
                <td className="px-4 py-3 text-slate-500">{r.uom}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="rounded-lg border border-slate-200 p-5">
        <h2 className="mb-1 text-base font-semibold text-slate-900">재고 조정</h2>
        <p className="mb-4 text-xs text-slate-500">
          기초재고 등록, 실사 차이 조정, 파손·폐기 반영. 수량은 항상 양수로 넣고
          증가·감소는 유형으로 정합니다. 등록된 기록은 수정·삭제할 수 없고, 잘못
          넣었으면 원장에서 역분개합니다(원칙 1).
        </p>
        <StockAdjustForm
          items={itemOptions}
          onHand={onHandMap}
          warehouses={warehouses}
          defaultDate={todayKst()}
        />
      </section>
    </div>
  );
}
