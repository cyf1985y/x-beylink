"use client";

import { useEffect } from "react";
import { finishMeta, type FinishType } from "@/lib/bracket";

/** 得分覆蓋畫面停留時間 */
export const FLASH_MS = 1_500;

/** host 只要記「哪一側、什麼結束方式」，選手資料由畫面自己帶 */
export type FlashState = { side: 1 | 2; finish: FinishType } | null;

/**
 * 字級同時參考 vh 與 vw 取小值。
 *
 * 直式手機由高度決定（維持原本的視覺大小），窄螢幕或平板橫放時由寬度收斂，
 * 不會撐破版面。純 vh 在橫放的平板上會相對畫面過大。
 */
const SIZE = {
  points: "min(26vh, 56vw)",
  finish: "min(7vh, 15vw)",
  player: "min(4vh, 8vw)",
  avatar: "min(22vh, 40vw)",
  winner: "min(6vh, 9vw)",
  score: "min(5vh, 9vw)",
  hint: "min(2vh, 3.6vw)",
};

/**
 * 得分後的全螢幕覆蓋：由大到小三層——得分數字、結束方式、選手。
 *
 * 現場幾公尺外的家長要能一眼看出誰得分、得幾分、怎麼贏的，
 * 所以背景直接鋪該側顏色（藍方青、紅方紅）。
 * FLASH_MS 後自動關閉；誤按時點畫面任意處可提前關掉去按 −1，不會被鎖住。
 */
export function ScoreFlash({
  side,
  finish,
  nickname,
  avatar,
  onClose,
}: {
  side: 1 | 2;
  finish: FinishType;
  nickname: string;
  avatar: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, FLASH_MS);
    return () => clearTimeout(t);
  }, [onClose]);

  const f = finishMeta(finish);

  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="關閉得分畫面"
      className={`fixed inset-0 z-[90] flex flex-col items-center justify-center ${
        side === 1 ? "bg-cyanx text-arena-deep" : "bg-red-500 text-white"
      }`}
    >
      <span
        className="font-num font-black leading-none"
        style={{ fontSize: SIZE.points }}
      >
        ＋{f.points}
      </span>
      <span
        className="mt-2 font-black leading-none"
        style={{ fontSize: SIZE.finish }}
      >
        {f.icon} {f.label}
      </span>
      <span
        className="mt-4 max-w-full truncate px-4 font-bold leading-none opacity-80"
        style={{ fontSize: SIZE.player }}
      >
        {avatar} {nickname}
      </span>
    </button>
  );
}

/** 勝利全螢幕：號角與語音由 host 在判定當下播（只播一次） */
export function WinFlash({
  side,
  nickname,
  avatar,
  score1,
  score2,
  onClose,
}: {
  side: 1 | 2;
  nickname: string;
  avatar: string;
  score1: number;
  score2: number;
  onClose: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="關閉勝利畫面"
      className={`fixed inset-0 z-[95] flex flex-col items-center justify-center backdrop-blur-sm ${
        side === 1 ? "bg-cyanx/20" : "bg-red-500/20"
      }`}
    >
      <span className="animate-floaty leading-none" style={{ fontSize: SIZE.avatar }}>
        {avatar}
      </span>
      <p
        className="mt-3 px-4 text-center font-black leading-tight text-gold text-glow"
        style={{ fontSize: SIZE.winner }}
      >
        🎉 {side === 1 ? "藍方" : "紅方"} {nickname} 獲勝！
      </p>
      <p
        className="font-num font-bold text-slate-100"
        style={{ fontSize: SIZE.score }}
      >
        {score1} : {score2}
      </p>
      <p className="mt-4 text-slate-400" style={{ fontSize: SIZE.hint }}>
        點畫面任意處關閉
      </p>
    </button>
  );
}

/** 語音播報開關（三處計分板共用同一顆） */
export function VoiceToggle({
  on,
  onToggle,
  className = "rounded-lg border border-arena-line px-2 py-0.5 text-[11px] text-slate-500 transition hover:text-slate-300",
}: {
  on: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button type="button" onClick={onToggle} className={className}>
      {on ? "🔊 語音開" : "🔇 語音關"}
    </button>
  );
}
