"use client";

import { useEffect, useState } from "react";
import { beepCount, beepGoShoot, unlockAudio } from "@/lib/sound";

/**
 * 「3、2、1、GO SHOOT」全螢幕倒數。
 *
 * 天梯沒有裁判、家長裁判也不好意思喊——這顆按鈕就是裁判。
 * 音效用 Web Audio 合成（不載音檔）；按鈕點擊本身就是瀏覽器允許出聲的手勢。
 * 倒數中點畫面任意處即可取消（誤觸不用等它跑完）。
 */
export function RoundCountdown({
  className,
  label = "▶ 開始回合",
  disabled,
}: {
  className?: string;
  label?: string;
  disabled?: boolean;
}) {
  // 3 → 2 → 1 → 0（GO SHOOT）→ null（結束回到計分畫面）
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (step === null) return;
    if (step > 0) {
      beepCount();
      const t = setTimeout(() => setStep(step - 1), 900);
      return () => clearTimeout(t);
    }
    beepGoShoot();
    const t = setTimeout(() => setStep(null), 1000);
    return () => clearTimeout(t);
  }, [step]);

  const running = step !== null;

  return (
    <>
      <button
        type="button"
        disabled={disabled || running}
        onClick={() => {
          unlockAudio();
          setStep(3);
        }}
        className={
          className ??
          "w-full rounded-xl border-2 border-gold/70 bg-gold/15 py-3 text-base font-black text-gold transition active:scale-95 disabled:opacity-40"
        }
      >
        {label}
      </button>

      {running && (
        <button
          type="button"
          onClick={() => setStep(null)}
          aria-label="取消倒數"
          className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-arena-deep/95 backdrop-blur-sm"
        >
          {step > 0 ? (
            <span
              key={step}
              className="animate-floaty font-num text-[45vh] font-bold leading-none text-cyanx text-glow"
            >
              {step}
            </span>
          ) : (
            <span className="animate-floaty text-center text-[16vh] font-black italic leading-none text-gold text-glow">
              GO
              <br />
              SHOOT!
            </span>
          )}
          <p className="mt-8 text-[2vh] text-slate-500">點畫面任意處取消</p>
        </button>
      )}
    </>
  );
}
