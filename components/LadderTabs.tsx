"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { isLadderTab, type LadderTab } from "@/lib/ladderTabs";

const TABS: Array<{ tab: LadderTab; label: string }> = [
  { tab: "battle", label: "⚔️ 對戰" },
  { tab: "board", label: "🏆 排行榜" },
];

function tabFromUrl(): LadderTab {
  const t = new URLSearchParams(window.location.search).get("tab");
  return isLadderTab(t) ? t : "battle";
}

/**
 * 天梯頁籤：對戰／排行榜。
 *
 * 兩邊的內容都是伺服器端一次撈好後傳進來的 RSC，頁籤只做顯示切換，
 * 不會再跑一次查詢。URL 用 history API 換（?tab=board），
 * 所以返回鍵與分享連結都會停在正確的頁籤。
 */
export function LadderTabs({
  initialTab,
  battle,
  board,
}: {
  initialTab: LadderTab;
  battle: ReactNode;
  board: ReactNode;
}) {
  const [tab, setTab] = useState<LadderTab>(initialTab);

  // 返回／前進鍵：URL 是用 history API 換的，這裡負責把畫面跟著切回去
  useEffect(() => {
    const onPop = () => setTab(tabFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback(
    (next: LadderTab) => {
      if (next === tab) return;
      setTab(next);
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.pushState(null, "", url);
    },
    [tab]
  );

  return (
    <>
      <div
        role="tablist"
        aria-label="天梯頁籤"
        className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-arena-line bg-arena-card p-1.5"
      >
        {TABS.map((t) => {
          const on = tab === t.tab;
          return (
            <button
              key={t.tab}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => go(t.tab)}
              className={`rounded-xl py-2.5 text-sm font-black tracking-wider transition ${
                on
                  ? "bg-cyanx/15 text-cyanx shadow-glow"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">{tab === "battle" ? battle : board}</div>
    </>
  );
}
