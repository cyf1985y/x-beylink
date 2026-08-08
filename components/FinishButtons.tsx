"use client";

import { useState } from "react";
import {
  FINISH_OPTIONS,
  RESHOOT_OPTIONS,
  type FinishType,
  type ReshootReason,
} from "@/lib/finish";
import { beepReshoot } from "@/lib/sound";

type Size = "md" | "screen";

/**
 * 結束方式 2×2：🌀 Spin ＋1／💨 Over ＋2／💥 Burst ＋2／⚡ Xtreme ＋3。
 * 按鈕刻意做大——現場是戴著緊張情緒按的。
 */
export function FinishGrid({
  side,
  disabled,
  onPick,
  size = "md",
}: {
  /** 1 = 藍方、2 = 紅方（決定配色） */
  side: 1 | 2;
  disabled: boolean;
  onPick: (finish: FinishType) => void;
  size?: Size;
}) {
  const screen = size === "screen";
  const accent =
    side === 1
      ? "border-cyanx/50 bg-cyanx/10 hover:bg-cyanx/25"
      : "border-red-400/50 bg-red-500/10 hover:bg-red-500/25";

  return (
    <div className={`grid flex-1 grid-cols-2 ${screen ? "gap-2" : "gap-2"}`}>
      {FINISH_OPTIONS.map((f) => (
        <button
          key={f.type}
          type="button"
          disabled={disabled}
          onClick={() => onPick(f.type)}
          className={`rounded-xl border-2 text-center transition active:scale-95 disabled:opacity-30 ${accent} ${
            screen ? "py-[1.4vh]" : "py-3"
          }`}
        >
          <span
            className={`block leading-none ${screen ? "text-[3vh]" : "text-2xl"}`}
          >
            {f.emoji}
          </span>
          <span
            className={`mt-1 block font-black leading-none ${
              screen ? "text-[1.9vh]" : "text-sm"
            }`}
          >
            {f.label}
            <span className="ml-1 font-num text-slate-300">＋{f.points}</span>
          </span>
          <span
            className={`mt-0.5 block text-slate-500 ${
              screen ? "text-[1.2vh]" : "text-[10px]"
            }`}
          >
            {f.zh}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * 「↻ 重射」＋事由快選。
 * 選完寫入一列 points = 0 的紀錄，比分不動——順手把重射規則變成教學。
 */
export function ReshootButton({
  disabled,
  onPick,
  size = "md",
}: {
  disabled: boolean;
  onPick: (reason: ReshootReason) => void;
  size?: Size;
}) {
  const [open, setOpen] = useState(false);
  const screen = size === "screen";

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={
          screen
            ? "flex-1 rounded-xl border border-slate-500/50 py-[1vh] text-[1.5vh] text-slate-300 transition hover:border-slate-300 disabled:opacity-30"
            : "w-full rounded-xl border border-slate-500/50 py-2.5 text-xs text-slate-300 transition hover:border-slate-300 disabled:opacity-40"
        }
      >
        ↻ 重射（不計分重來）
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-arena-line bg-arena-card p-4 shadow-glow">
            <p className="text-center text-base font-black">
              ↻ 這一回合重射，原因是？
            </p>
            <p className="mt-1 text-center text-xs text-slate-500">
              重射不計分，雙方比分不會變動
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {RESHOOT_OPTIONS.map((r) => (
                <button
                  key={r.reason}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    beepReshoot();
                    onPick(r.reason);
                  }}
                  className="rounded-xl border border-arena-line bg-arena px-2 py-3 text-center transition active:scale-95 hover:border-cyanx/60"
                >
                  <span className="block text-sm font-bold">{r.label}</span>
                  {r.note && (
                    <span className="mt-0.5 block text-[10px] text-slate-500">
                      {r.note}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-3 w-full rounded-xl border border-arena-line py-2 text-xs text-slate-400 hover:text-slate-200"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </>
  );
}
