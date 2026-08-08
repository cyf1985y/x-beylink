"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addFinish,
  addFoul,
  addReshoot,
  undoLastPoint,
  type ScoreResult,
} from "@/app/referee/scoring";
import { WIN_POINTS } from "@/lib/bracket";
import type { FinishType, ReshootReason, RoundEntry } from "@/lib/finish";
import { beepScore, beepUndo, fanfare, speak } from "@/lib/sound";
import { finishPoints } from "@/lib/finish";
import { FinishGrid, ReshootButton } from "@/components/FinishButtons";
import { RoundCountdown } from "@/components/RoundCountdown";
import { RoundTimeline } from "@/components/RoundTimeline";

export type ScoringMatch = {
  id: string;
  eventId: string;
  roundLabel: string;
  tableNo: number;
  player1: { id: string; nickname: string; avatar: string } | null;
  player2: { id: string; nickname: string; avatar: string } | null;
  score1: number;
  score2: number;
  winnerId: string | null;
};

function ScoreCard({
  player,
  score,
  isWinner,
  accent,
}: {
  player: { nickname: string; avatar: string } | null;
  score: number;
  isWinner: boolean;
  accent: "cyan" | "violet";
}) {
  return (
    <div
      className={`flex-1 rounded-2xl border-2 p-4 text-center transition ${
        isWinner
          ? "border-gold bg-gold/10 shadow-glow-gold"
          : accent === "cyan"
            ? "border-cyanx/40 bg-cyanx/5"
            : "border-violetx/40 bg-violetx/5"
      }`}
    >
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl border border-arena-line bg-arena text-3xl">
        {player?.avatar ?? "❔"}
      </div>
      <p className="mt-2 truncate text-base font-black">
        {player?.nickname ?? "（待定）"}
      </p>
      <p
        className={`font-num text-4xl font-bold leading-tight ${
          isWinner ? "text-gold" : "text-slate-100"
        }`}
      >
        {score}
        <span className="ml-0.5 text-sm font-normal text-slate-500">分</span>
      </p>
    </div>
  );
}

export function ScoringPanel({
  match,
  initialRounds,
}: {
  match: ScoringMatch;
  initialRounds: RoundEntry[];
}) {
  const router = useRouter();
  const [s1, setS1] = useState(match.score1);
  const [s2, setS2] = useState(match.score2);
  const [winnerId, setWinnerId] = useState<string | null>(match.winnerId);
  const [rounds, setRounds] = useState<RoundEntry[]>(initialRounds);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const finished = !!winnerId;
  const ready = !!match.player1 && !!match.player2;

  const handle = (fn: () => Promise<ScoreResult>, onBefore?: () => void) => {
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
      if (r.rounds) setRounds(r.rounds);
      const prev = winnerId;
      setWinnerId(r.winnerId ?? null);
      if (r.winnerId && prev !== r.winnerId) {
        fanfare();
        speak(`${r.winnerSide === 1 ? "藍方" : "紅方"} ${r.winnerName ?? ""} 獲勝`);
      }
      router.refresh();
    });
  };

  const scoreFor = (side: 1 | 2) => (f: FinishType) =>
    handle(
      () => addFinish(match.eventId, match.id, side, f),
      () => beepScore(side, finishPoints(f))
    );

  const foulFor = (side: 1 | 2) => () =>
    handle(
      () => addFoul(match.eventId, match.id, side),
      () => beepUndo()
    );

  const reshoot = (reason: ReshootReason) =>
    handle(() => addReshoot(match.eventId, match.id, reason));

  const undo = () =>
    handle(
      () => undoLastPoint(match.eventId, match.id),
      () => beepUndo()
    );

  // 直接呼叫而非當成 component 用，避免每次 render 都把整組按鈕卸載重掛
  const sideBlock = (side: 1 | 2) => {
    const p = side === 1 ? match.player1 : match.player2;
    return (
      <div key={side} className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-300">
            <span className="mr-1">{p?.avatar ?? "❔"}</span>
            {p?.nickname ?? `選手 ${side}`} 得分
          </span>
          <button
            type="button"
            disabled={pending || !ready}
            onClick={foulFor(side)}
            className="rounded-lg border border-arena-line px-2.5 py-1 text-xs text-slate-500 transition hover:border-red-400 hover:text-red-300 disabled:opacity-40"
          >
            −1 犯規
          </button>
        </div>
        <FinishGrid
          side={side}
          disabled={pending || !ready}
          onPick={scoreFor(side)}
        />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="card-x p-4">
        <p className="text-center text-sm font-black tracking-wider text-slate-300">
          {match.roundLabel}・第 {match.tableNo} 決鬥台
        </p>

        <div className="mt-3 flex items-stretch gap-2">
          <ScoreCard
            player={match.player1}
            score={s1}
            isWinner={!!winnerId && winnerId === match.player1?.id}
            accent="cyan"
          />
          <div className="flex items-center">
            <span className="font-num text-lg font-bold text-violetx">VS</span>
          </div>
          <ScoreCard
            player={match.player2}
            score={s2}
            isWinner={!!winnerId && winnerId === match.player2?.id}
            accent="violet"
          />
        </div>

        {finished ? (
          <div className="mt-4 rounded-xl border border-gold/60 bg-gold/10 p-4 text-center">
            <p className="text-lg font-black text-gold">
              🏆{" "}
              {winnerId === match.player1?.id
                ? match.player1?.nickname
                : match.player2?.nickname}{" "}
              獲勝！
            </p>
            <p className="mt-1 text-xs text-slate-400">
              已自動晉級；按下方「復原上一筆」可修正誤判
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={undo}
              className="mx-auto mt-3 block rounded-lg border border-arena-line px-4 py-2 text-xs text-slate-400 transition hover:border-gold hover:text-gold"
            >
              ↩ 復原上一筆紀錄（誤判修正）
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4">
              <RoundCountdown disabled={pending || !ready} />
            </div>

            {sideBlock(1)}
            {sideBlock(2)}

            <div className="mt-4">
              <ReshootButton
                disabled={pending || !ready}
                onPick={reshoot}
              />
            </div>

            <button
              type="button"
              disabled={pending}
              onClick={undo}
              className="mt-2 w-full rounded-lg border border-arena-line py-2 text-xs text-slate-500 transition hover:border-gold hover:text-gold disabled:opacity-40"
            >
              ↩ 復原上一筆紀錄
            </button>
            <p className="mt-2 text-center text-xs text-slate-500">
              先取得 <b className="text-cyanx">{WIN_POINTS} 分</b>{" "}
              者獲勝・點按即計分
            </p>
          </>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <Link
          href={`/scoreboard/${match.id}`}
          target="_blank"
          className="btn-gold mt-4 block w-full text-sm"
        >
          🖥️ 計分板模式（架在戰鬥盤旁）
        </Link>
      </div>

      <RoundTimeline
        rounds={rounds}
        player1={match.player1}
        player2={match.player2}
      />
    </div>
  );
}
