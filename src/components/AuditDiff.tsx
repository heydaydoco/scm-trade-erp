/**
 * 변경 이력 한 행의 "무엇이 바뀌었나" 요약 (순수 서버 컴포넌트).
 * before_json ↔ after_json 을 비교해 바뀐 필드명만 컴팩트하게 보여준다.
 * updated_at/created_at 같은 시스템 잡음 키는 제외한다.
 */

const NOISE_KEYS = new Set(["updated_at", "created_at"]);

/** 두 스냅샷에서 값이 달라진 키 목록 (잡음 키 제외). */
function changedKeys(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  const changed: string[] = [];
  for (const k of keys) {
    if (NOISE_KEYS.has(k)) continue;
    const a = JSON.stringify((before ?? {})[k] ?? null);
    const b = JSON.stringify((after ?? {})[k] ?? null);
    if (a !== b) changed.push(k);
  }
  return changed;
}

export function AuditDiff({
  action,
  before,
  after,
}: {
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  if (action === "INSERT") {
    return <span className="text-green-700">신규 생성</span>;
  }
  if (action === "DELETE") {
    return <span className="text-red-700">삭제됨</span>;
  }

  const keys = changedKeys(before, after);
  if (keys.length === 0) {
    return (
      <span className="text-zinc-400">내용 변경 없음 · 저장시각만 갱신</span>
    );
  }

  const shown = keys.slice(0, 6);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((k) => (
        <code
          key={k}
          className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600"
        >
          {k}
        </code>
      ))}
      {keys.length > shown.length ? (
        <span className="text-xs text-zinc-400">
          외 {keys.length - shown.length}개
        </span>
      ) : null}
    </span>
  );
}
