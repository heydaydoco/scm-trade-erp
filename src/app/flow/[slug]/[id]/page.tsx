import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/Badge";
import { getDocChain } from "@/services/docChain";
import {
  docTypeBySlug,
  detailHref,
  flowHref,
  statusBadge,
  isCancelledStatus,
  type ChainNode,
  type AssembledChain,
} from "@/services/chainLogic";
import type { FocusLineTable } from "@/services/docChain";

export const dynamic = "force-dynamic";

/**
 * 문서 흐름 추적 화면 (P4.6, 조회 전용). 임의 전표에서 SO-허브 DAG 전체를 조회한다.
 * 쓰기 0 — getDocChain(SELECT) → chainLogic 조립 결과를 컬럼·카드로 렌더한다.
 */
export default async function FlowPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const def = docTypeBySlug(slug);
  if (!def) return <FlowNotFound reason="미지 전표 종류" />;

  const res = await getDocChain(def.key, id);
  if (!res.found || !res.chain) {
    return <FlowNotFound reason={`${def.label}을(를) 찾을 수 없습니다`} backHref={`/${def.slug}`} backLabel={`${def.label} 목록`} />;
  }

  const { chain, focusLines } = res;
  const focusNumber = res.focus?.docNumber ?? "(번호 없음)";

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title="문서 흐름" subtitle={`${def.label} · ${focusNumber}`} />
      <p className="-mt-3 mb-5 text-xs text-slate-500">
        이 전표가 속한 문서 사슬 전체입니다 — 상류(문의·견적)부터 하류(무역서류·재고
        원장)까지. <b>조회 전용</b>이며 여기서는 아무것도 바뀌지 않습니다.
        <Link href={detailHref(def.key, id)} className="ml-2 text-blue-700 hover:underline">
          {def.label} 상세로 →
        </Link>
      </p>

      <FlowColumns chain={chain} />

      {focusLines && focusLines.rows.length > 0 && (
        <FocusLines table={focusLines} focusLabel={`${def.label} ${focusNumber}`} />
      )}
    </div>
  );
}

/* ---------- 컬럼 · 노드 카드 ---------- */

function FlowColumns({ chain }: { chain: AssembledChain }) {
  const byKey = new Map(chain.nodes.map((n) => [n.key, n]));
  const parentsOf = (node: ChainNode): ChainNode[] =>
    chain.edges
      .filter((e) => e.to === node.key)
      .map((e) => byKey.get(e.from))
      .filter((n): n is ChainNode => !!n);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {chain.columns.map((col) => (
        <section key={col.group} className="min-w-0">
          <h2 className="mb-2 border-b border-zinc-100 pb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            {col.label}
          </h2>
          {col.nodes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-400">
              —
            </p>
          ) : (
            <div className="space-y-2">
              {col.nodes.map((n) => (
                <NodeCard key={n.key} node={n} parents={parentsOf(n)} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function NodeCard({ node, parents }: { node: ChainNode; parents: ChainNode[] }) {
  const cancelled = isCancelledStatus(node.status);

  // 원장 리프 — 집계 카드(행별 나열 없음), /stock/movements 로 이동.
  if (node.type === "ledger") {
    const c = node.meta?.ledgerCount ?? 0;
    const r = node.meta?.reversalCount ?? 0;
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="text-xs font-medium text-slate-500">재고 원장</div>
        <Link href="/stock/movements" className="text-sm text-blue-700 hover:underline">
          원장 {c}행 · 역분개 {r}행 →
        </Link>
      </div>
    );
  }

  // 유실된 상류 스텁 — 링크 없음.
  if (node.stub) {
    return (
      <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2">
        <div className="text-xs font-medium text-amber-700">{node.label}</div>
        <div className="text-sm text-amber-800">🔗 {node.meta?.lostReason ?? "유실된 상류(삭제됨)"}</div>
      </div>
    );
  }

  const badge = statusBadge(node.type, node.status);
  const ring = node.focus
    ? "border-blue-500 ring-2 ring-blue-200"
    : node.boundary
      ? "border-dashed border-zinc-300"
      : "border-zinc-200";

  return (
    <div className={`rounded-lg border bg-white px-3 py-2 ${ring} ${cancelled ? "opacity-55" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-400">{node.label}</span>
        <span className="flex items-center gap-1">
          {node.focus && <Badge variant="blue">현재</Badge>}
          {node.boundary && <Badge variant="zinc">경계</Badge>}
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </span>
      </div>
      <Link href={detailHref(node.type, node.id)} className="font-mono text-sm font-medium text-blue-700 hover:underline">
        {node.docNumber ?? "(번호 없음)"}
      </Link>
      {node.date && <span className="ml-2 text-xs text-zinc-400">{node.date}</span>}

      {node.meta?.soNumbers && node.meta.soNumbers.length > 0 && (
        <div className="mt-0.5 text-xs text-slate-500">근거 수주: {node.meta.soNumbers.join(", ")}</div>
      )}

      {parents.length > 0 && (
        <div className="mt-1 text-xs text-zinc-400">
          ← {parents.map((p) => p.docNumber ?? p.label).join(", ")}
        </div>
      )}

      {node.boundary && (
        <Link href={flowHref(node.type, node.id)} className="mt-1 block text-xs text-sky-700 hover:underline">
          이 주문 흐름 보기 →
        </Link>
      )}
    </div>
  );
}

/* ---------- 초점 라인 표 ---------- */

function FocusLines({ table, focusLabel }: { table: FocusLineTable; focusLabel: string }) {
  const isQuotation = table.kind === "quotation";
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-base font-semibold text-slate-900">
        {focusLabel} · 라인 소비/진행
      </h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">품목</th>
              {!isQuotation && <th className="px-3 py-2 text-right">수량</th>}
              {!isQuotation && <th className="px-3 py-2">단위</th>}
              <th className="px-3 py-2">{table.originLabel}</th>
              {table.showConsumption && <th className="px-3 py-2 text-right">주문</th>}
              {table.showConsumption && <th className="px-3 py-2 text-right">출고/입고</th>}
              {table.showConsumption && <th className="px-3 py-2 text-right">선적</th>}
              {table.showConsumption && <th className="px-3 py-2 text-right">잔량</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {table.rows.map((row) => (
              <tr key={row.lineNo}>
                <td className="px-3 py-2 text-zinc-400">{row.lineNo}</td>
                <td className="px-3 py-2">{row.itemName}</td>
                {!isQuotation && <td className="px-3 py-2 text-right tabular-nums">{row.qty}</td>}
                {!isQuotation && <td className="px-3 py-2">{row.uom ?? "—"}</td>}
                <td className="px-3 py-2">
                  {isQuotation ? (
                    row.derived && row.derived.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {row.derived.map((d, i) => (
                          <Link key={i} href={d.href} className="text-blue-700 hover:underline">
                            {d.label}
                          </Link>
                        ))}
                      </span>
                    ) : (
                      <span className="text-zinc-400">파생 수주 없음</span>
                    )
                  ) : (
                    <OriginCell origin={row.origin} />
                  )}
                </td>
                {table.showConsumption && <td className="px-3 py-2 text-right tabular-nums">{row.ordered ?? "—"}</td>}
                {table.showConsumption && <td className="px-3 py-2 text-right tabular-nums">{row.consumed ?? "—"}</td>}
                {table.showConsumption && <td className="px-3 py-2 text-right tabular-nums">{row.shipped ?? "—"}</td>}
                {table.showConsumption && (
                  <td className={`px-3 py-2 text-right tabular-nums ${(row.open ?? 0) < 0 ? "text-red-600" : (row.open ?? 0) === 0 ? "text-slate-400" : "text-emerald-700"}`}>
                    {row.open ?? "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.note && <p className="mt-2 text-xs text-slate-500">{table.note}</p>}
    </section>
  );
}

function OriginCell({ origin }: { origin: FocusLineTable["rows"][number]["origin"] }) {
  if (origin.status === "ok") return <span className="text-slate-700">{origin.label}</span>;
  if (origin.status === "broken") {
    return (
      <span className="text-amber-700" title="원본 전표가 재저장되어 라인 연결이 끊어졌습니다. 스냅샷 품목명으로 식별합니다.">
        🔗 연결 끊김(원본 재저장됨){origin.snapshotName ? ` · ${origin.snapshotName}` : ""}
      </span>
    );
  }
  return <span className="text-zinc-400">{origin.snapshotName ?? "—"}</span>;
}

/* ---------- 찾을 수 없음 ---------- */

function FlowNotFound({
  reason,
  backHref,
  backLabel,
}: {
  reason: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl px-8 py-16 text-center">
      <p className="text-lg font-medium text-slate-700">전표를 찾을 수 없습니다</p>
      <p className="mt-2 text-sm text-slate-500">{reason}</p>
      <div className="mt-6 flex justify-center gap-4 text-sm">
        {backHref && (
          <Link href={backHref} className="text-blue-700 hover:underline">
            {backLabel ?? "돌아가기"} →
          </Link>
        )}
        <Link href="/" className="text-slate-500 hover:underline">
          홈 →
        </Link>
      </div>
    </div>
  );
}
