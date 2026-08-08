"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  confirmResult,
  disputeResult,
  getMatchState,
  reportResult,
  type MatchState,
} from "@/app/ladder/actions";
import {
  addLadderFinish,
  addLadderFoul,
  addLadderReshoot,
  resetLadderRounds,
  undoLadderRound,
  type LadderScoreResult,
} from "@/app/ladder/scoring";
import { AUTO_CONFIRM_MINUTES } from "@/lib/ladder";
import { WIN_POINTS } from "@/lib/bracket";
import {
  finishPoints,
  scoreFromRounds,
  type FinishType,
  type ReshootReason,
} from "@/lib/finish";
import { beepScore, beepUndo, fanfare } from "@/lib/sound";
import { FinishGrid, ReshootButton } from "@/components/FinishButtons";
import { RoundCountdown } from "@/components/RoundCountdown";
import { RoundTimeline } from "@/components/RoundTimeline";

type P = { id: string; nickname: string; avatar: string };

const POLL_MS = 5_000;

/**
 * 天梯對戰面板：計分 → 回報 → 敗方確認／異議。
 *
 * 計分沿用賽事計分板的規則與音效（先取 4 分、四種結束方式、重射、倒數），
 * 逐回合寫進 match_points（ladder_match_id），因此雙方裝置看到的比分一致、
 * 重整也不會丟。最終比分仍由 ladder_report_result 回報，積分一律由
 * ladder_confirm_result 計算。
 */
export function LadderMatchPanel({
  matchId,
  playerA,
  playerB,
  myPlayerId,
  initial,
}: {
  matchId: string;
  playerA: P;
  playerB: P;
  /** 我在這場的選手 id；旁觀者為 null */
  myPlayerId: string | null;
  initial: MatchState;
}) {
  const router = useRouter();
  const [state, setState] = useState<MatchState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const live = state.status === "playing" || state.status === "pending_confirm";

  // 進行中的比分由回合紀錄推導（side 1 = playerA、side 2 = playerB）
  const { s1: sA, s2: sB } = scoreFromRounds(state.rounds);

  const refresh = useCallback(async () => {
    const s = await getMatchState(matchId);
    if (s) setState(s);
  }, [matchId]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [live, refresh]);

  // 結算完成時更新頁面其他區塊（積分卡等）
  useEffect(() => {
    if (state.status === "confirmed") router.refresh();
  }, [state.status, router]);

  const isParticipant = !!myPlayerId;
  const iAmA = myPlayerId === playerA.id;
  const me = iAmA ? playerA : playerB;
  const opponent = iAmA ? playerB : playerA;

  const winnerIsMe = !!state.winner && state.winner === myPlayerId;
  const myScore = iAmA ? state.scoreA : state.scoreB;
  const oppScore = iAmA ? state.scoreB : state.scoreA;

  /** 回合操作共用流程：寫入 → 用回傳的回合紀錄更新畫面 */
  const score = async (
    fn: (playerId: string) => Promise<LadderScoreResult>,
    onBefore?: () => void
  ) => {
    if (!myPlayerId) return;
    setError(null);
    setMessage(null);
    onBefore?.();
    setBusy(true);
    const r = await fn(myPlayerId);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "計分失敗");
      return;
    }
    if (r.rounds) setState((s) => ({ ...s, rounds: r.rounds ?? s.rounds }));
  };

  const addFinish = (side: 1 | 2) => (f: FinishType) =>
    score(
      (pid) => addLadderFinish(matchId, pid, side, f),
      () => beepScore(side, finishPoints(f))
    );

  const addFoul = (side: 1 | 2) => () =>
    score(
      (pid) => addLadderFoul(matchId, pid, side),
      () => beepUndo()
    );

  const decided = sA !== sB && (sA >= WIN_POINTS || sB >= WIN_POINTS);

  const submit = async () => {
    if (!myPlayerId) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    const r = await reportResult(matchId, myPlayerId, sA, sB);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "回報失敗");
      return;
    }
    setMessage(r.message ?? "已回報");
    fanfare();
    refresh();
  };

  const doConfirm = async () => {
    if (!myPlayerId) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    const r = await confirmResult(matchId, myPlayerId);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "確認失敗");
      return;
    }
    setMessage(r.message ?? "結果已成立");
    refresh();
  };

  const doDispute = async () => {
    if (!myPlayerId) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    const r = await disputeResult(matchId, myPlayerId);
    setBusy(false);
    if (!r.ok) setError(r.error ?? "操作失敗");
    else setMessage(r.message ?? "已標記爭議");
    refresh();
  };

  const Side = ({ p, score, side }: { p: P; score: number; side: 1 | 2 }) => (
    <div
      className={`flex-1 rounded-2xl border-2 p-3 text-center ${
        side === 1
          ? "border-cyanx/60 bg-cyanx/5"
          : "border-red-400/60 bg-red-500/5"
      }`}
    >
      <p
        className={`text-[10px] font-black tracking-widest ${
          side === 1 ? "text-cyanx" : "text-red-300"
        }`}
      >
        {side === 1 ? "藍方" : "紅方"}
      </p>
      <p className="text-4xl">{p.avatar}</p>
      <p className="mt-1 truncate text-sm font-black">{p.nickname}</p>
      <p className="font-num text-5xl font-bold leading-none">{score}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 比分顯示 */}
      <div className="flex items-stretch gap-2">
        <Side
          p={playerA}
          score={state.status === "playing" ? sA : (state.scoreA ?? 0)}
          side={1}
        />
        <div className="flex items-center">
          <span className="font-num text-2xl font-bold text-violetx">:</span>
        </div>
        <Side
          p={playerB}
          score={state.status === "playing" ? sB : (state.scoreB ?? 0)}
          side={2}
        />
      </div>

      {/* 進行中：計分 */}
      {state.status === "playing" && isParticipant && (
        <section className="card-x p-4">
          <p className="text-center text-xs text-slate-400">
            先取 {WIN_POINTS} 分獲勝｜天梯沒有裁判，開始回合由你們自己喊
          </p>

          <div className="mt-3">
            <RoundCountdown disabled={busy} />
          </div>

          <div className="mt-3 space-y-3">
            {([1, 2] as const).map((side) => {
              const p = side === 1 ? playerA : playerB;
              return (
                <div key={side}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-300">
                      <span className="mr-1">{p.avatar}</span>
                      {p.nickname} 得分
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={addFoul(side)}
                      className="rounded-lg border border-arena-line px-2.5 py-1 text-xs text-slate-500 transition hover:border-red-400 hover:text-red-300 disabled:opacity-40"
                    >
                      −1 犯規
                    </button>
                  </div>
                  <FinishGrid
                    side={side}
                    disabled={busy}
                    onPick={addFinish(side)}
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-3">
            <ReshootButton
              disabled={busy}
              onPick={(reason: ReshootReason) =>
                score((pid) => addLadderReshoot(matchId, pid, reason))
              }
            />
          </div>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                score(
                  (pid) => undoLadderRound(matchId, pid),
                  () => beepUndo()
                )
              }
              className="flex-1 rounded-xl border border-arena-line py-2 text-xs text-slate-400 transition hover:border-gold hover:text-gold disabled:opacity-40"
            >
              ↩ 復原上一筆
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                score(
                  (pid) => resetLadderRounds(matchId, pid),
                  () => beepUndo()
                )
              }
              className="flex-1 rounded-xl border border-arena-line py-2 text-xs text-slate-400 transition hover:border-red-400 hover:text-red-300 disabled:opacity-40"
            >
              歸零重來
            </button>
          </div>

          <button
            onClick={submit}
            disabled={busy || sA === sB}
            className="btn-x mt-4 w-full disabled:opacity-40"
          >
            {sA === sB
              ? "比分相同，無法回報"
              : decided
                ? `回報結果 ${sA}:${sB}`
                : `提前回報 ${sA}:${sB}`}
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-500">
            回報後由敗方確認才計分，{AUTO_CONFIRM_MINUTES}{" "}
            分鐘未確認自動成立。
          </p>
        </section>
      )}

      {state.status === "playing" && !isParticipant && (
        <p className="rounded-2xl border border-dashed border-arena-line p-6 text-center text-sm text-slate-500">
          對戰進行中——你不是這場的選手，只能觀戰。
        </p>
      )}

      {/* 待確認 */}
      {state.status === "pending_confirm" && isParticipant && (
        <section className="card-x p-5 text-center">
          {winnerIsMe ? (
            <>
              <p className="text-lg font-black">
                已回報 {myScore}:{oppScore}，你獲勝
              </p>
              <p className="mt-1 text-sm text-slate-400">
                等待 {opponent.nickname} 按下確認後才會計分。
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-black">
                {state.reportedBy === myPlayerId ? "你" : "對手"}回報{" "}
                {oppScore}:{myScore} 由 {opponent.nickname} 獲勝，正確嗎？
              </p>
              <p className="mt-1 text-sm text-slate-400">
                確認後雙方積分會立刻變動。
              </p>
            </>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={doConfirm}
              disabled={busy}
              className="btn-x flex-1 disabled:opacity-40"
            >
              確認
            </button>
            <button
              onClick={doDispute}
              disabled={busy}
              className="flex-1 rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 font-bold text-red-300 transition active:scale-95 disabled:opacity-40"
            >
              有問題
            </button>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            {AUTO_CONFIRM_MINUTES} 分鐘內未操作，這個結果會自動成立。
            只有敗方可以確認結果。
          </p>
        </section>
      )}

      {state.status === "pending_confirm" && !isParticipant && (
        <p className="rounded-2xl border border-dashed border-arena-line p-6 text-center text-sm text-slate-500">
          已回報比分，等待敗方確認。
        </p>
      )}

      {/* 已成立 */}
      {state.status === "confirmed" && (
        <section className="card-x p-5 text-center">
          <p className="text-lg font-black text-gold">🏆 結果已成立</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {(
              [
                [playerA, state.deltaA, state.ratingA],
                [playerB, state.deltaB, state.ratingB],
              ] as const
            ).map(([p, delta, rating]) => (
              <div
                key={p.id}
                className="rounded-xl border border-arena-line bg-arena p-3"
              >
                <p className="truncate text-sm font-bold">{p.nickname}</p>
                <p className="font-num text-2xl font-bold">{rating ?? "—"}</p>
                <p
                  className={`font-num text-sm font-bold ${
                    (delta ?? 0) > 0
                      ? "text-emerald-300"
                      : (delta ?? 0) < 0
                        ? "text-red-300"
                        : "text-slate-500"
                  }`}
                >
                  {delta === null
                    ? "—"
                    : delta > 0
                      ? `+${delta}`
                      : `${delta}`}
                </p>
              </div>
            ))}
          </div>
          {state.deltaA === 0 && state.deltaB === 0 && (
            <p className="mt-3 text-xs text-slate-500">
              這一場不計分：同一天和同一位對手已達上限，或今日計分場數已滿 3 場。
            </p>
          )}
          <button
            onClick={() => router.push("/ladder")}
            className="btn-x mt-4 w-full"
          >
            回天梯
          </button>
        </section>
      )}

      {state.status === "disputed" && (
        <p className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-center text-sm text-red-300">
          這場對戰被標記為有爭議，積分不會變動。請找現場主辦方協助處理。
        </p>
      )}

      {state.status === "voided" && (
        <p className="rounded-2xl border border-dashed border-arena-line p-6 text-center text-sm text-slate-500">
          這場對戰已作廢。
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {message && !error && (
        <p className="rounded-lg border border-emerald-400/50 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">
          ✅ {message}
        </p>
      )}

      <RoundTimeline
        rounds={state.rounds}
        player1={playerA}
        player2={playerB}
      />

      {isParticipant && (
        <p className="text-center text-xs text-slate-600">
          你以「{me.avatar} {me.nickname}」出賽
        </p>
      )}
    </div>
  );
}
