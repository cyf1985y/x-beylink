"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addFinish,
  addPenalty,
  addReshoot,
  undoLastPoint,
  type ScoreResult,
} from "@/app/referee/scoring";
import {
  FINISH_TYPES,
  WIN_POINTS,
  type FinishType,
  type ReshootReason,
} from "@/lib/bracket";
import type { DbMatchPoint } from "@/lib/rounds";
import { beepScore, beepUndo, beepReshoot, fanfare, speak } from "@/lib/sound";
import { RoundCountdown } from "@/components/RoundCountdown";
import { ReshootButton } from "@/components/ReshootButton";
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
  rounds: DbMatchPoint[];
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

/** 該選手的四顆結束方式（2×2，按鈕要大） */
function FinishRow({
  label,
  avatar,
  accent,
  disabled,
  onFinish,
  onPenalty,
}: {
  label: string;
  avatar: string;
  accent: "cyan" | "violet";
  disabled: boolean;
  onFinish: (finish: FinishType) => void;
  onPenalty: () => void;
}) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-300">
          <span className="mr-1">{avatar}</span>
          {label} 得分
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={onPenalty}
          className="rounded-lg border border-arena-line px-2.5 py-1 text-xs text-slate-500 transition hover:border-red-400 hover:text-red-300 disabled:opacity-40"
        >
          −1 犯規
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {FINISH_TYPES.map((f) => (
          <button
            key={f.type}
            type="button"
            disabled={disabled}
            onClick={() => onFinish(f.type)}
            className={`rounded-xl border py-3.5 text-center transition active:scale-95 disabled:opacity-40 ${
              accent === "cyan"
                ? "border-cyanx/40 bg-cyanx/10 hover:bg-cyanx/20"
                : "border-violetx/40 bg-violetx/10 hover:bg-violetx/20"
            }`}
          >
            <span className="block text-lg leading-none">{f.icon}</span>
            <span className="mt-1 block text-sm font-black">{f.label}</span>
            <span className="block font-num text-xs text-slate-400">
              +{f.points}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ScoringPanel({ match }: { match: ScoringMatch }) {
  const router = useRouter();
  const [s1, setS1] = useState(match.score1);
  const [s2, setS2] = useState(match.score2);
  const [winnerId, setWinnerId] = useState<string | null>(match.winnerId);
  const [rounds, setRounds] = useState<DbMatchPoint[]>(match.rounds);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const finished = !!winnerId;
  const ready = !!match.player1 && !!match.player2;

  const handle = (fn: () => Promise<ScoreResult>, onBefore?: () => void) => {
    setError(null);
    onBefore?.();
    startTransition(async () => {
      const r = await fn();
      if (r.rounds) setRounds(r.rounds);
      if (!r.ok) {
        setError(r.error ?? "操作失敗");
        return;
      }
      if (typeof r.score1 === "number") setS1(r.score1);
      if (typeof r.score2 === "number") setS2(r.score2);
      const prev = winnerId;
      setWinnerId(r.winnerId ?? null);
      if (r.winnerId && prev !== r.winnerId) {
        fanfare();
        speak(`${r.winnerSide === 1 ? "藍方" : "紅方"} ${r.winnerName ?? ""} 獲勝`);
      }
      router.refresh();
    });
  };

  const reshoot = (reason: ReshootReason) =>
    handle(
      () => addReshoot(match.eventId, match.id, reason),
      () => beepReshoot()
    );

  return (
    <>
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
              onClick={() =>
                handle(
                  () => undoLastPoint(match.eventId, match.id),
                  () => beepUndo()
                )
              }
              className="mx-auto mt-3 block rounded-lg border border-arena-line px-4 py-2 text-xs text-slate-400 transition hover:border-gold hover:text-gold"
            >
              ↩ 復原上一筆計分（誤判修正）
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4">
              <RoundCountdown disabled={!ready} />
              <p className="mt-1.5 text-center text-[11px] text-slate-500">
                按下會全螢幕倒數 3、2、1、GO SHOOT（有聲音）
              </p>
            </div>

            <FinishRow
              label={match.player1?.nickname ?? "選手 1"}
              avatar={match.player1?.avatar ?? "❔"}
              accent="cyan"
              disabled={pending || !ready}
              onFinish={(f) =>
                handle(
                  () => addFinish(match.eventId, match.id, 1, f),
                  () => beepScore(1, FINISH_TYPES.find((x) => x.type === f)!.points)
                )
              }
              onPenalty={() =>
                handle(
                  () => addPenalty(match.eventId, match.id, 1),
                  () => beepUndo()
                )
              }
            />
            <FinishRow
              label={match.player2?.nickname ?? "選手 2"}
              avatar={match.player2?.avatar ?? "❔"}
              accent="violet"
              disabled={pending || !ready}
              onFinish={(f) =>
                handle(
                  () => addFinish(match.eventId, match.id, 2, f),
                  () => beepScore(2, FINISH_TYPES.find((x) => x.type === f)!.points)
                )
              }
              onPenalty={() =>
                handle(
                  () => addPenalty(match.eventId, match.id, 2),
                  () => beepUndo()
                )
              }
            />

            <div className="mt-3 flex gap-2">
              <ReshootButton
                disabled={pending || !ready}
                onPick={reshoot}
                className="flex-1 rounded-lg border border-slate-500/50 py-2 text-xs text-slate-300 transition hover:border-slate-300 disabled:opacity-40"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  handle(
                    () => undoLastPoint(match.eventId, match.id),
                    () => beepUndo()
                  )
                }
                className="flex-1 rounded-lg border border-arena-line py-2 text-xs text-slate-500 transition hover:border-gold hover:text-gold disabled:opacity-40"
              >
                ↩ 復原上一筆
              </button>
            </div>
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
        className="mt-6"
        rows={rounds}
        player1={match.player1}
        player2={match.player2}
      />
    </>
  );
}
