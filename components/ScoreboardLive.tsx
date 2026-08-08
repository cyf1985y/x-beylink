"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getMatchScore,
  addFinish,
  addFoul,
  addReshoot,
  undoLastPoint,
  type ScoreResult,
} from "@/app/referee/scoring";
import { WIN_POINTS } from "@/lib/bracket";
import { finishPoints, type FinishType, type ReshootReason } from "@/lib/finish";
import { beepScore, beepUndo, fanfare, speak } from "@/lib/sound";
import { FinishGrid, ReshootButton } from "@/components/FinishButtons";
import { RoundCountdown } from "@/components/RoundCountdown";

type P = { id: string; nickname: string; avatar: string };

/**
 * 計分板模式：架在戰鬥盤旁的大螢幕。
 * 有記分權限時可直接在這裡計分（嗶聲＋震動＋勝利號角＋語音播報）；
 * 沒有權限則為純觀戰模式，2 秒自動更新。
 */
export function ScoreboardLive({
  eventId,
  matchId,
  title,
  roundLabel,
  tableNo,
  player1,
  player2,
  initialScore1,
  initialScore2,
  initialWinnerId,
  canScore,
}: {
  eventId: string;
  matchId: string;
  title: string;
  roundLabel: string;
  tableNo: number;
  player1: P;
  player2: P;
  initialScore1: number;
  initialScore2: number;
  initialWinnerId: string | null;
  canScore: boolean;
}) {
  const router = useRouter();
  const [s1, setS1] = useState(initialScore1);
  const [s2, setS2] = useState(initialScore2);
  const [winnerId, setWinnerId] = useState<string | null>(initialWinnerId);
  const [showWin, setShowWin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [pending, startTransition] = useTransition();
  const announced = useRef<string | null>(initialWinnerId);

  // 觀戰模式輪詢；記分模式靠自己的操作更新（避免蓋掉樂觀值）
  useEffect(() => {
    if (canScore) return;
    const timer = setInterval(async () => {
      const r = await getMatchScore(matchId);
      if (!r) return;
      setS1(r.score1);
      setS2(r.score2);
      setWinnerId(r.winnerId);
    }, 2000);
    return () => clearInterval(timer);
  }, [matchId, canScore]);

  const run = (fn: () => Promise<ScoreResult>, onBefore?: () => void) => {
    setError(null);
    onBefore?.();
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "操作失敗");
        return;
      }
      if (typeof r.score1 === "number") setS1(r.score1);
      if (typeof r.score2 === "number") setS2(r.score2);
      setWinnerId(r.winnerId ?? null);

      if (r.winnerId && announced.current !== r.winnerId) {
        announced.current = r.winnerId;
        setShowWin(true);
        fanfare();
        if (voiceOn) {
          const side = r.winnerSide === 1 ? "藍方" : "紅方";
          speak(`${side} ${r.winnerName ?? ""} 獲勝`);
        }
      }
      if (!r.winnerId) {
        announced.current = null;
        setShowWin(false);
      }
      router.refresh();
    });
  };

  const Side = ({
    p,
    score,
    side,
  }: {
    p: P;
    score: number;
    side: 1 | 2;
  }) => {
    const won = !!winnerId && winnerId === p.id;
    const lost = !!winnerId && winnerId !== p.id;
    return (
      <div
        className={`flex flex-1 flex-col items-center justify-center rounded-3xl border-2 p-3 transition ${
          won
            ? "border-gold bg-gold/15 shadow-glow-gold"
            : lost
              ? "border-arena-line opacity-40"
              : side === 1
                ? "border-cyanx/60 bg-cyanx/5"
                : "border-red-400/60 bg-red-500/5"
        }`}
      >
        <span
          className={`text-[1.6vh] font-black tracking-widest ${
            side === 1 ? "text-cyanx" : "text-red-300"
          }`}
        >
          {side === 1 ? "藍方・1P" : "紅方・2P"}
        </span>
        <span className="text-[8vh] leading-none">{p.avatar}</span>
        <p className="mt-1 max-w-full truncate text-[3.2vh] font-black">
          {p.nickname}
        </p>
        <p
          className={`font-num text-[16vh] font-bold leading-none ${
            won ? "text-gold" : "text-slate-100"
          }`}
        >
          {score}
        </p>
        {won && <p className="text-[2.6vh] font-black text-gold">WINNER 🏆</p>}
      </div>
    );
  };

  const scoreFor = (side: 1 | 2) => (f: FinishType) =>
    run(
      () => addFinish(eventId, matchId, side, f),
      () => beepScore(side, finishPoints(f))
    );

  const MinusButton = ({ side }: { side: 1 | 2 }) => (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        run(
          () => addFoul(eventId, matchId, side),
          () => beepUndo()
        )
      }
      className={`flex-1 rounded-xl border py-[1vh] text-[1.5vh] transition disabled:opacity-30 ${
        side === 1
          ? "border-cyanx/30 text-cyanx/70 hover:border-red-400 hover:text-red-300"
          : "border-red-400/30 text-red-300/70 hover:border-red-400 hover:text-red-300"
      }`}
    >
      {side === 1 ? "藍方" : "紅方"} −1 犯規
    </button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-arena-deep p-3">
      <header className="flex items-center justify-between px-1">
        <span className="text-[1.6vh] text-slate-500">{title}</span>
        <span className="text-[2.2vh] font-black tracking-widest text-cyanx">
          {roundLabel}・第 {tableNo} 決鬥台・先取 {WIN_POINTS} 分
        </span>
        <span className="flex items-center gap-2">
          {canScore && (
            <button
              onClick={() => setVoiceOn((v) => !v)}
              className="rounded-lg border border-arena-line px-2 py-0.5 text-[1.4vh] text-slate-500 hover:text-slate-300"
            >
              {voiceOn ? "🔊 語音開" : "🔇 語音關"}
            </button>
          )}
          <button
            onClick={() => window.close()}
            className="rounded-lg border border-arena-line px-2 py-0.5 text-[1.4vh] text-slate-500 hover:text-slate-300"
          >
            ✕ 離開
          </button>
        </span>
      </header>

      <div className="flex flex-1 items-stretch gap-3 py-2">
        <Side p={player1} score={s1} side={1} />
        <div className="flex items-center">
          <span className="font-num text-[4vh] font-bold text-violetx">:</span>
        </div>
        <Side p={player2} score={s2} side={2} />
      </div>

      {canScore ? (
        <>
          {/* 開始回合：3・2・1・GO SHOOT */}
          <div className="flex">
            <RoundCountdown size="screen" disabled={pending || !!winnerId} />
          </div>
          {/* 得分：兩側各一組 2×2 結束方式 */}
          <div className="mt-2 flex gap-3">
            <FinishGrid
              side={1}
              size="screen"
              disabled={pending || !!winnerId}
              onPick={scoreFor(1)}
            />
            <FinishGrid
              side={2}
              size="screen"
              disabled={pending || !!winnerId}
              onPick={scoreFor(2)}
            />
          </div>
          {/* 修正：犯規扣分、重射與復原同一列 */}
          <div className="mt-2 flex gap-2">
            <MinusButton side={1} />
            <ReshootButton
              size="screen"
              disabled={pending || !!winnerId}
              onPick={(reason: ReshootReason) =>
                run(() => addReshoot(eventId, matchId, reason))
              }
            />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => undoLastPoint(eventId, matchId),
                  () => beepUndo()
                )
              }
              className="flex-1 rounded-xl border border-arena-line py-[1vh] text-[1.5vh] text-slate-400 transition hover:border-gold hover:text-gold disabled:opacity-30"
            >
              ↩ 復原上一筆
            </button>
            <MinusButton side={2} />
          </div>
        </>
      ) : (
        <footer className="text-center text-[1.6vh] text-slate-600">
          先取得 {WIN_POINTS} 分者獲勝｜陀螺集結 X-BeyLink
        </footer>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-center text-[1.6vh] text-red-300">
          {error}
        </p>
      )}

      {showWin && winnerId && (
        <button
          onClick={() => setShowWin(false)}
          className={`fixed inset-0 z-[70] flex flex-col items-center justify-center backdrop-blur-sm ${
            winnerId === player1.id ? "bg-cyanx/20" : "bg-red-500/20"
          }`}
        >
          <span className="animate-floaty text-[22vh] leading-none">
            {winnerId === player1.id ? player1.avatar : player2.avatar}
          </span>
          <p className="mt-3 text-[6vh] font-black text-gold text-glow">
            🎉 {winnerId === player1.id ? "藍方" : "紅方"}{" "}
            {winnerId === player1.id ? player1.nickname : player2.nickname}{" "}
            獲勝！
          </p>
          <p className="font-num text-[5vh] font-bold text-slate-200">
            {s1} : {s2}
          </p>
          <p className="mt-4 text-[2vh] text-slate-400">
            已寫入對戰表・點畫面任意處關閉
          </p>
        </button>
      )}
    </div>
  );
}
