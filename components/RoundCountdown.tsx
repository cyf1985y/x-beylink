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

/**
 * 四拍在語音檔中的起音點（ms，相對於第一個字）。
 *
 * 這組數字是從 public/countdown-321go.mp3 實測出來的（解碼後取 5ms 解析度的
 * RMS 包絡線抓起音點），不是規格值——真人講話不會落在 800ms 的整數倍上。
 * 換音檔時用 /countdown-calibrate.html 重新量一次再貼回來。
 */
const BEAT_OFFSETS = [0, 825, 1615, 2565];
/**
 * 音檔開頭到第一個字之間的靜音（ms）。
 * 播放時直接從這裡起播，畫面第一拍才會和聽到第一個字的瞬間對齊。
 */
const LEAD_SILENCE_MS = 615;
/**
 * 只播這麼長（ms，從第一個字算起）；0 代表播到檔案結束。
 *
 * 目前的錄音就是乾淨的四個字，尾巴沒有多餘的字要切，所以設 0。
 * 若換成尾巴還有別的字的錄音（例如舊版多唸了 Shoot），把這裡設成
 * 「最後一個字結束」與「多餘那個字起音」之間的任一個值即可。
 */
const PLAY_MS = 0;
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
 * 音檔載不到時退回合成嗶聲，拍子與畫面完全一樣，只是沒有人聲。
 * 畫面用 BEAT_OFFSETS 的時間戳對齊音檔，不逐拍重算。
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

    // 有語音就播語音（跳過開頭靜音），沒有就每拍補一顆合成音
    stopAudio.current = playCountdown(LEAD_SILENCE_MS / 1000, PLAY_MS / 1000);
    const useBeeps = !stopAudio.current;

    const mark = (i: number) => {
      setStep(i);
      vibrate(i === LAST ? [90, 40, 160] : 60);
      if (useBeeps) (i === LAST ? beepGo : beepCount)();
    };

    mark(0);
    for (let i = 1; i <= LAST; i++) {
      timers.current.push(setTimeout(() => mark(i), BEAT_OFFSETS[i]));
    }
    // 收畫面，但不停聲音——「GO！」這個字通常比 TAIL_MS 長，硬停會把它切掉。
    // 真的要停（取消、離開畫面、再按一次）都會走 clearAll。
    timers.current.push(
      setTimeout(() => setStep(null), BEAT_OFFSETS[LAST] + TAIL_MS)
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
