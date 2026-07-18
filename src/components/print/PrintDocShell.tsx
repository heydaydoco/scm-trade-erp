import Link from "next/link";
import type { ReactNode } from "react";
import { PrintButton } from "@/components/PrintButton";

/**
 * 공용 인쇄 셸 (P4.5 커밋 d) — 화면 툴바(인쇄 시 숨김) + A4 용지 영역 +
 * CANCELLED 배너. CI/PL 만 이 위에 구현한다 — 기존 인쇄 5벌은 불가촉
 * (본문 이관은 후속 하위단계).
 */
export function PrintDocShell({
  backHref,
  backLabel,
  cancelled,
  cancelReason,
  children,
}: {
  backHref: string;
  backLabel: string;
  cancelled?: boolean;
  cancelReason?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-100 py-8">
      {/* 화면 전용 툴바 (인쇄 시 숨김 — 전역 .no-print 관례) */}
      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between px-4">
        <Link
          href={backHref}
          className="text-sm text-zinc-500 hover:text-blue-700 hover:underline"
        >
          {backLabel}
        </Link>
        <PrintButton />
      </div>

      {/* 인쇄 영역 */}
      <div className="mx-auto max-w-3xl bg-white px-12 py-12 text-sm leading-relaxed text-zinc-900 shadow-sm print:max-w-none print:shadow-none">
        {cancelled && (
          <div className="mb-6 border-4 border-double border-red-600 px-4 py-3 text-center">
            <p className="text-2xl font-bold tracking-widest text-red-600">
              CANCELLED
            </p>
            {cancelReason && (
              <p className="mt-1 text-xs text-red-600">사유: {cancelReason}</p>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
