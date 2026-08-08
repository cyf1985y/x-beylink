"use client";

import { useEffect, useRef, useState } from "react";
import { beepCountdown, beepGoShoot, resumeAudio } from "@/lib/sound";

/** 3 → 2 → 1 → GO SHOOT!，每拍 1 秒（GO SHOOT 停留短一點就收） */
const BEATS = ["3", "2", "1", "GO SHOOT!"] as const;
const BEAT_MS = 1000;
const GO_MS = 900;

/**
 * 「▶ 開始回合」倒數。
 *
 * 裁判模式、計分板模式、天梯計分板共用同一顆——天梯沒有裁判，這顆按鈕就是裁判。
 * 聲音用 Web Audio 現場合成（不載音檔）；按鈕點擊本身就是瀏覽器允許出聲的手勢，
 * 所以在 onClick 當下先 resumeAudio()，後面幾拍才不會被靜音。
 * 倒數中點畫面任意處可取消（誤觸救援）。
 */
export function RoundCountdown({
  size = "md",
  disabled = false,
}: {
  size?: "md" | "screen";
  disabled?: boolean;
}) {
  const [step, setStep] = useState<number | null>(null);
  // React 嚴格模式會重跑 effect，這裡確保同一拍不會播兩次聲音
  const played = useRef<number | null>(null);

  useEffect(() => {
    if (step === null) {
      played.current = null;
      return;
    }
    if (played.current !== step) {
      played.current = step;
      if (step < 3) beepCountdown((3 - step) as 3 | 2 | 1);
      else beepGoShoot();
    }
    const last = step === BEATS.length - 1;
    const timer = setTimeout(
      () => setStep(last ? null : step + 1),
      last ? GO_MS : BEAT_MS
    );
    return () => clearTimeout(timer);
  }, [step]);

  const start = () => {
    resumeAudio();
    played.current = null;
    setStep(0);
  };

  const screen = size === "screen";

  return (
    <>
      <button
        type="button"
        disabled={disabled || step !== null}
        onClick={start}
        className={
          screen
            ? "flex-1 rounded-xl border-2 border-gold/60 bg-gold/10 py-[1vh] text-[1.7vh] font-black text-gold transition active:scale-95 hover:bg-gold/20 disabled:opacity-30"
            : "w-full rounded-xl border-2 border-gold/60 bg-gold/10 py-3 text-sm font-black text-gold transition active:scale-95 hover:bg-gold/20 disabled:opacity-40"
        }
      >
        ▶ 開始回合（3・2・1・GO SHOOT）
      </button>

      {step !== null && (
        <button
          type="button"
          onClick={() => setStep(null)}
          aria-label="取消倒數"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-arena-deep/95 backdrop-blur-sm"
        >
          <span
            key={step}
            className={`animate-floaty font-black leading-none text-glow ${
              step === BEATS.length - 1
                ? "text-[14vw] text-gold md:text-[10vw]"
                : "font-num text-[42vh] text-cyanx"
            }`}
          >
            {BEATS[step]}
          </span>
          <span className="mt-8 text-sm text-slate-500">
            點畫面任意處可取消
          </span>
        </button>
      )}
    </>
  );
}
