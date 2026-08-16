"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  beepCount,
  beepGo,
  enableAudioSession,
  loadCountdown,
  playCountdown,
  unlockAudio,
  vibrate,
} from "@/lib/sound";

/** 每一拍的間隔；語音檔的四拍就是照這個時間戳錄的 */
const BEAT_MS = 800;
/** GO 之後停留多久才回到計分畫面 */
const TAIL_MS = 400;
/** 四拍：Three → Two → One → GO（沒有 SHOOT） */
const BEATS = ["3", "2", "1", "GO!"] as const;
const LAST = BEATS.length - 1;

/**
 * 「Three、Two、One、GO」四拍全螢幕倒數。
 *
 * 天梯沒有裁判、家長裁判也不好意思喊——這顆按鈕就是裁判。
 * 聲音走 public/countdown-321go.mp3 單一音檔（Web Audio 播放，蓋得過 iPhone 靜音撥桿）；
 * 音檔還沒備妥時退回合成嗶聲，拍子與畫面完全一樣，只是沒有人聲。
 * 畫面用固定時間戳 0 / 800 / 1600 / 2400ms 對齊音檔，不逐拍重算。
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
  // 0、1、2、3（GO）→ null（結束回到計分畫面）
  const [step, setStep] = useState<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stopAudio = useRef<(() => void) | null>(null);

  /** 收掉所有排程與聲音（取消、播完、離開畫面都走這裡） */
  const clearAll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    stopAudio.current?.();
    stopAudio.current = null;
  }, []);

  // 先載好音檔，按下去才不用等（載不到就是 null，之後自動用嗶聲）
  useEffect(() => {
    loadCountdown();
  }, []);

  useEffect(() => clearAll, [clearAll]);

  const cancel = useCallback(() => {
    clearAll();
    setStep(null);
  }, [clearAll]);

  const start = () => {
    clearAll();
    enableAudioSession();
    unlockAudio();

    // 有語音就播語音，沒有就每拍補一顆合成音
    stopAudio.current = playCountdown();
    const useBeeps = !stopAudio.current;

    const mark = (i: number) => {
      setStep(i);
      vibrate(i === LAST ? [90, 40, 160] : 60);
      if (useBeeps) (i === LAST ? beepGo : beepCount)();
    };

    mark(0);
    for (let i = 1; i <= LAST; i++) {
      timers.current.push(setTimeout(() => mark(i), i * BEAT_MS));
    }
    timers.current.push(
      setTimeout(() => {
        setStep(null);
        stopAudio.current = null;
      }, LAST * BEAT_MS + TAIL_MS)
    );
  };

  const running = step !== null;

  return (
    <>
      <button
        type="button"
        disabled={disabled || running}
        onClick={start}
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
          onClick={cancel}
          aria-label="取消倒數"
          className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-arena-deep/95 backdrop-blur-sm"
        >
          {step < LAST ? (
            <span
              key={step}
              className="animate-floaty font-num text-[45vh] font-bold leading-none text-cyanx text-glow"
            >
              {BEATS[step]}
            </span>
          ) : (
            <span className="animate-floaty text-center text-[24vh] font-black italic leading-none text-gold text-glow">
              {BEATS[LAST]}
            </span>
          )}
          <p className="mt-8 text-[2vh] text-slate-500">點畫面任意處取消</p>
        </button>
      )}
    </>
  );
}
