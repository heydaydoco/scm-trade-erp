import { listStockMovements, movementTypeOf, isReversible } from "@/services/stock";
import { listItems } from "@/services/items";
import { MOVEMENT_TYPES } from "@/services/codes";
import { PageHeader } from "@/components/PageHeader";
import { ReverseButton } from "./ReverseButton";
import Link from "next/link";

export const dynamic = "force-dynamic";

const TONE_CLASS: Record<string, string> = {
  in: "bg-emerald-50 text-emerald-700",
  out: "bg-amber-50 text-amber-700",
  reversal: "bg-slate-100 text-slate-600",
};

/** 참조 전표 라벨 — P4.2 GR / P4.3 Delivery가 ref_doc_type을 채운다. */
const REF_LABEL: Record<string, string> = {
  GR: "입고",
  DLV: "출고",
};

/**
 * 재고 원장 (SPEC D1) — append-only. 수정·삭제 버튼이 존재하지 않는다.
 * 정정은 역분개(반대부호 행)뿐이고, 원행과 역분개 행이 모두 남는다(원칙 1·5).
 */
export default async function StockMovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; type?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;

  let rows: Awaited<ReturnType<typeof listStockMovements>> = [];
  let items: Awaited<ReturnType<typeof listItems>> = [];
  let loadError: string | null = null;

  try {
    [rows, items] = await Promise.all([
      listStockMovements({
        itemId: sp.item,
        movementType: sp.type,
        from: sp.from,
        to: sp.to,
      }),
      listItems(),
    ]);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "데이터를 불러오지 못했습니다.";
  }

  return (
    <div className="space-y-6">
      <PageHeader title="재고 원장" subtitle="Stock Ledger" count={rows.length} />

      {loadError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          데이터를 불러오지 못했습니다: {loadError}
        </p>
      )}

      <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        원장은 <b>추가만</b> 됩니다. 등록된 기록은 수정·삭제할 수 없고, 잘못 넣었으면{" "}
        <b>역분개</b>(반대부호 행 추가)로 되돌립니다. 원행과 역분개 행이 모두 남아
        무슨 일이 있었는지 그대로 보입니다.
      </p>

      {/* 필터 — GET 폼이라 URL이 곧 상태(공유·새로고침 안전). */}
      <form className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">품목</span>
          <select
            name="item"
            defaultValue={sp.item ?? ""}
            className="rounded border border-slate-300 px-2 py-1.5"
          >
            <option value="">전체</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code ? `[${i.code}] ` : ""}
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">유형</span>
          <select
            name="type"
            defaultValue={sp.type ?? ""}
            className="rounded border border-slate-300 px-2 py-1.5"
          >
            <option value="">전체</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">증빙일 from</span>
          <input
            type="date"
            name="from"
            defaultValue={sp.from ?? ""}
            className="rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">to</span>
          <input
            type="date"
            name="to"
            defaultValue={sp.to ?? ""}
            className="rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <button className="rounded-md bg-slate-900 px-3 py-1.5 text-white">
          조회
        </button>
        <Link href="/stock/movements" className="text-slate-500 underline">
          초기화
        </Link>
        <Link href="/stock" className="ml-auto text-slate-600 underline">
          ← 현재고로
        </Link>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">증빙일</th>
              <th className="px-4 py-3">유형</th>
              <th className="px-4 py-3">품목</th>
              <th className="px-4 py-3 text-right">수량</th>
              <th className="px-4 py-3">창고</th>
              <th className="px-4 py-3">참조</th>
              <th className="px-4 py-3">사유</th>
              <th className="px-4 py-3">정정</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  원장 기록이 없습니다.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const t = movementTypeOf(r.movementType);
              const reversed = r.reversedById !== null;
              return (
                <tr
                  key={r.id}
                  className={`hover:bg-slate-50 ${reversed ? "opacity-60" : ""}`}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {r.movedAt}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        TONE_CLASS[t.tone] ?? TONE_CLASS.reversal
                      }`}
                    >
                      {t.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-400">
                      {r.itemCode ? `[${r.itemCode}] ` : ""}
                    </span>
                    {r.itemName ?? "—"}
                    {r.lotNo && (
                      <span className="ml-1 text-xs text-slate-400">
                        로트 {r.lotNo}
                      </span>
                    )}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-medium tabular-nums ${
                      r.qty < 0 ? "text-amber-700" : "text-emerald-700"
                    }`}
                  >
                    {r.qty > 0 ? `+${r.qty}` : r.qty}
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      {r.uom}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.warehouseCode}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {r.refDocType
                      ? `${REF_LABEL[r.refDocType] ?? r.refDocType}`
                      : r.reversalOfId
                        ? "역분개"
                        : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {r.memo ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {reversed ? (
                      <span className="text-xs text-slate-400">역분개됨</span>
                    ) : isReversible({
                        movementType: r.movementType,
                        reversedById: r.reversedById,
                      }) ? (
                      <ReverseButton
                        movementId={r.id}
                        summary={`${t.label} ${r.qty > 0 ? "+" : ""}${r.qty}`}
                      />
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
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
