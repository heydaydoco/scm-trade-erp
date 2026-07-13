import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuditLogEntry } from "./types";

/**
 * 변경 이력(Audit Log) 서비스 — SPEC I5, 원칙 5(불변)·원칙 7(로직/화면 분리).
 *
 * ⚠️ 의도적으로 **읽기 전용**이다: create/update/delete 함수가 없다.
 *    기록은 오직 DB 트리거(fn_audit, db/migrations/p2.1_audit_log.sql)만 수행한다.
 *    앱은 audit_log에 SELECT 권한만 가지므로 이력을 위조·삭제할 수 없다.
 */

/* ---------- 물리 테이블 행 모양 (이 파일 바깥으로 노출 안 함) ---------- */

interface AuditLogRow {
  id: number | string;
  table_name: string;
  record_id: string | null;
  action: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  actor: string | null;
  at: string;
}

const AUDIT_COLUMNS =
  "id, table_name, record_id, action, before_json, after_json, actor, at";

/* ---------- 순수 매핑 (I/O 없음 → 단위 테스트 가능) ---------- */

/** audit_log 행 → 도메인 AuditLogEntry. */
export function mapRowToAuditEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: String(row.id),
    tableName: row.table_name,
    recordId: row.record_id,
    action: row.action,
    before: row.before_json,
    after: row.after_json,
    actor: row.actor ?? "system",
    at: row.at,
  };
}

/* ---------- I/O (서비스). 화면은 이 함수들만 호출한다. ---------- */

/**
 * 변경 이력 조회 (최신순). 옵션으로 특정 테이블·행만 필터.
 * 기본 200건 상한(감사 원장은 계속 누적되므로).
 */
export async function listAuditLog(opts?: {
  tableName?: string;
  recordId?: string;
  limit?: number;
}): Promise<AuditLogEntry[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase.from("audit_log").select(AUDIT_COLUMNS);
  if (opts?.tableName) query = query.eq("table_name", opts.tableName);
  if (opts?.recordId) query = query.eq("record_id", opts.recordId);

  const { data, error } = await query
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(opts?.limit ?? 200);

  if (error) throw new Error(`감사 로그 조회 실패: ${error.message}`);
  const rows = (data ?? []) as unknown as AuditLogRow[];
  return rows.map(mapRowToAuditEntry);
}

/**
 * 특정 전표 1건의 변경 이력.
 * P2.2 수주(SO)·견적 상세 화면에서 "이 전표 변경 이력"으로 재사용할 훅.
 */
export async function getAuditForRecord(
  tableName: string,
  recordId: string,
): Promise<AuditLogEntry[]> {
  return listAuditLog({ tableName, recordId });
}
