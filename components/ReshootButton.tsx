"use client";

import { useState } from "react";
import { RESHOOT_REASONS, type ReshootReason } from "@/lib/bracket";

/**
 * 「↻ 重射」：官方規則要求不計分重來的情況（發射失誤、同時停止、自摔⋯⋯）。
 * 按下跳快選，選完寫入一列 points=0／side=0／reason，比分不動。
 */
export function ReshootButton({
  onPick,
  className,
  disabled,
  label = "↻ 重射",
}: {
  onPick: (reason: ReshootReason) => void;
  className?: string;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={
          className ??
          "flex-1 rounded-xl border border-slate-500/50 py-1.5 text-xs text-slate-300 transition hover:border-slate-300 disabled:opacity-30"
        }
      >
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="選擇重射原因"
          className="fixed inset-0 z-[85] flex items-end justify-center bg-arena-deep/80 p-4 backdrop-blur-sm sm:items-center"
        >
          {/* 點背景關閉 */}
          <button
            type="button"
            aria-label="取消"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default"
          />
          <div className="relative w-full max-w-sm rounded-2xl border border-arena-line bg-arena-card p-4 shadow-glow">
            <p className="text-center text-sm font-black text-slate-200">
              ↻ 重射原因
            </p>
            <p className="mt-1 text-center text-xs text-slate-500">
              這一回合不計分，比分不會變動
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {RESHOOT_REASONS.map((r) => (
                <button
                  key={r.reason}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onPick(r.reason);
                  }}
                  className="rounded-xl border border-arena-line bg-arena px-2 py-3 text-sm font-bold text-slate-200 transition active:scale-95 hover:border-cyanx/60 hover:text-cyanx"
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-3 w-full rounded-xl border border-arena-line py-2 text-xs text-slate-500 hover:text-slate-300"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </>
  );
}
