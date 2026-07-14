import { listAuditLog } from "@/services/audit";
import type { AuditLogEntry } from "@/services/types";
import { PageHeader } from "@/components/PageHeader";
import { Badge, type BadgeVariant } from "@/components/Badge";
import { AuditDiff } from "@/components/AuditDiff";
import { AUDIT_ACTION, labelOf } from "@/services/codes";

// 항상 요청 시점에 최신 이력을 읽는다.
export const dynamic = "force-dynamic";

const ACTION_VARIANT: Record<string, BadgeVariant> = {
  INSERT: "green",
  UPDATE: "blue",
  DELETE: "red",
};

/** 물리 테이블명 → 화면 라벨 (사람이 읽기 쉽게). 미정의는 원본 그대로. */
const TABLE_LABEL: Record<string, string> = {
  quotations: "견적",
  quotation_items: "견적 품목",
  sales_orders: "수주",
  so_lines: "수주 품목",
  purchase_orders: "발주",
  po_lines: "발주 품목",
};

/** timestamptz(UTC) → 한국시간 표시. */
function formatAt(at: string): string {
  try {
    return new Date(at).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return at;
  }
}

export default async function AuditPage() {
  let entries: AuditLogEntry[] = [];
  let errorMessage: string | null = null;

  try {
    entries = await listAuditLog();
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader
        title="변경 이력"
        subtitle="Audit Log"
        count={errorMessage ? undefined : entries.length}
      />

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">데이터를 불러오지 못했습니다.</p>
          <p className="mt-1 break-all text-red-600">{errorMessage}</p>
          <p className="mt-2 text-xs text-red-500">
            audit_log 테이블이 아직 없다면 db/migrations/p2.1_audit_log.sql 을
            Supabase에서 먼저 실행하세요. (무료티어 정지 시 대시보드에서 Restore)
          </p>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          아직 기록된 변경이 없습니다. 견적을 하나 열어 저장하면 여기에 즉시
          기록이 남습니다.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">시각</th>
                <th className="px-4 py-3 font-medium">대상</th>
                <th className="px-4 py-3 font-medium">동작</th>
                <th className="px-4 py-3 font-medium">변경 내용</th>
                <th className="px-4 py-3 font-medium">대상 ID</th>
                <th className="px-4 py-3 font-medium">작성자</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-zinc-50 align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-600 tabular-nums">
                    {formatAt(e.at)}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {TABLE_LABEL[e.tableName] ?? e.tableName}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={ACTION_VARIANT[e.action] ?? "zinc"}>
                      {labelOf(AUDIT_ACTION, e.action)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    <AuditDiff
                      action={e.action}
                      before={e.before}
                      after={e.after}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                    {e.recordId ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{e.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-zinc-400">
        이력은 <strong>추가 전용</strong>입니다 — 수정·삭제 버튼이 없습니다(원칙
        5). 기록은 데이터베이스가 자동으로 남기며, 앱은 읽기만 합니다. · 데이터
        출처: Supabase
      </p>
    </div>
  );
}
