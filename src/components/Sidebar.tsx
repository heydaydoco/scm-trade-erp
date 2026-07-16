"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: { section: string; items: { href: string; label: string }[] }[] = [
  {
    section: "마스터",
    items: [
      { href: "/partners", label: "거래처" },
      { href: "/items", label: "품목" },
    ],
  },
  {
    section: "영업",
    items: [
      { href: "/inquiries", label: "문의" },
      { href: "/quotations", label: "견적" },
      { href: "/sales-orders", label: "수주" },
    ],
  },
  {
    section: "구매",
    items: [{ href: "/purchase-orders", label: "발주" }],
  },
  {
    section: "무역",
    items: [{ href: "/shipments", label: "선적" }],
  },
  {
    section: "재고",
    items: [
      { href: "/stock", label: "현재고" },
      { href: "/stock/movements", label: "재고 원장" },
    ],
  },
  {
    section: "재무",
    items: [{ href: "/fx-rates", label: "환율 대장" }],
  },
  {
    section: "관리",
    items: [
      { href: "/deadlines", label: "임박 기일" },
      { href: "/audit", label: "변경 이력" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-5 py-4">
        <p className="text-sm font-semibold text-zinc-900">SCM · Trade ERP</p>
        <p className="text-xs text-zinc-400">무역 관리 시스템</p>
      </div>
      <nav className="px-3 py-4">
        {NAV.map((group) => (
          <div key={group.section} className="mb-4">
            <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              {group.section}
            </p>
            {group.items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-blue-50 font-medium text-blue-700"
                      : "text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
