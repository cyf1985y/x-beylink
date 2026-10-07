"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/autoref", icon: "🏠", label: "總覽" },
  { href: "/autoref/calibrate", icon: "🎯", label: "校正" },
  { href: "/autoref/battle", icon: "⚔️", label: "對戰" },
  { href: "/autoref/replay", icon: "🎬", label: "回放" },
  { href: "/autoref/settings", icon: "⚙️", label: "設定" },
];

/** 自動裁判五個頁面的頂部分頁 */
export function AutorefNav() {
  const path = usePathname();
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-arena-line bg-arena-card p-1 text-sm">
      {TABS.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-3 py-2 font-bold transition ${
              active ? "bg-brand-gradient text-arena-deep" : "text-slate-300 hover:bg-white/5"
            }`}
          >
            <span aria-hidden>{t.icon}</span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
