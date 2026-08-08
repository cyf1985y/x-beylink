"use client";

import { useState, type ReactNode } from "react";
import type { LadderClass } from "@/lib/ladder";

/**
 * 排行榜的通常組／公開組切換。
 *
 * 刻意不做成第二層頁籤（手機上兩層頁籤很難按），改用並排的 segmented control，
 * 一次只顯示一組。兩組內容一樣是伺服器端一次撈好傳進來的。
 */
export function LeaderboardSwitch({
  groups,
}: {
  groups: Array<{ cls: LadderClass; label: string; content: ReactNode }>;
}) {
  const [cls, setCls] = useState<LadderClass>(groups[0]?.cls ?? "normal");
  const current = groups.find((g) => g.cls === cls) ?? groups[0];

  return (
    <>
      <div className="mt-4 inline-flex w-full rounded-xl border border-arena-line bg-arena p-1">
        {groups.map((g) => {
          const on = g.cls === cls;
          return (
            <button
              key={g.cls}
              type="button"
              aria-pressed={on}
              onClick={() => setCls(g.cls)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
                on
                  ? "bg-violetx/25 text-slate-100"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {current?.content}
    </>
  );
}
