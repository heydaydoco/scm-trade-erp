import type { ReactNode } from "react";

/** 폼 입력 공용 래퍼 (라벨 + 필드). 거래처/품목/문의/견적 폼에서 재사용. */
export function Field({
  label,
  required,
  children,
  full,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-sm font-medium text-zinc-700">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

/** 공용 입력 스타일 (input/select/textarea 공통). */
export const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400";
