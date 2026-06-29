import Link from "next/link";

/** 모든 목록 화면 상단 공용 헤더 (제목 + 건수 + 등록 버튼 슬롯). */
export function PageHeader({
  title,
  subtitle,
  count,
  action,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  action?: { href: string; label: string };
}) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          SCM · Trade ERP
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-zinc-900">
          {title}
          {subtitle ? (
            <span className="ml-2 font-normal text-zinc-400">{subtitle}</span>
          ) : null}
        </h1>
      </div>
      <div className="flex items-center gap-3">
        {typeof count === "number" ? (
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-600">
            총 {count}건
          </span>
        ) : null}
        {action ? (
          <Link
            href={action.href}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
          >
            {action.label}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
