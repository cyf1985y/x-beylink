"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addLadderFinish,
  addLadderPenalty,
  addLadderReshoot,
  clearLadderRounds,
  confirmResult,
  disputeResult,
  getLadderRounds,
  getMatchState,
  getNextMatch,
  reportResult,
  undoLadderRound,
  type LadderRoundsResult,
  type MatchState,
  type NextMatch,
} from "@/app/ladder/actions";
import { AUTO_CONFIRM_MINUTES } from "@/lib/ladder";
import {
  WIN_POINTS,
  FINISH_TYPES,
  isDecided,
  type ReshootReason,
} from "@/lib/bracket";
import { scoreOf, type DbMatchPoint } from "@/lib/rounds";
import {
  beepScore,
  beepUndo,
  beepReshoot,
  beepNextMatch,
  fanfare,
} from "@/lib/sound";
import { RoundCountdown } from "@/components/RoundCountdown";
import { ReshootButton } from "@/components/ReshootButton";
import { RoundTimeline } from "@/components/RoundTimeline";

type P = { id: string; nickname: string; avatar: string };

const POLL_MS = 5_000;
/** 結果成立後改查「下一場來了沒」，節奏可以慢一點 */
const NEXT_POLL_MS = 10_000;
/** 轉場橫幅自動進入的倒數秒數 */
const NEXT_COUNTDOWN = 5;

/**
 * 天梯對戰面板：計分 → 回報 → 敗方確認／異議。
 *
 * 計分沿用賽事計分板的規則與音效（先取 4 分、四種結束方式、重射不計分），
 * 逐回合寫進 match_points（帶 ladder_match_id），所以兩支手機看到的比分一致，
 * 重整也不會丟；按下「回報結果」才把最終比分寫進 ladder_matches。
 * 積分一律由 ladder_confirm_result 計算。
 */
export function LadderMatchPanel({
  matchId,
  playerA,
  playerB,
  myPlayerId,
  initial,
  initialRounds,
}: {
  matchId: string;
  playerA: P;
  playerB: P;
  /** 我在這場的選手 id；旁觀者為 null */
  myPlayerId: string | null;
  initial: MatchState;
  initialRounds: DbMatchPoint[];
}) {
  const router = useRouter();
  const [state, setState] = useState<MatchState>(initial);
  const [rounds, setRounds] = useState<DbMatchPoint[]>(initialRounds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [next, setNext] = useState<NextMatch | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [visible, setVisible] = useState(true);

  const live = state.status === "playing" || state.status === "pending_confirm";
  const { s1: sA, s2: sB } = scoreOf(rounds);

  const refresh = useCallback(async () => {
    const [s, r] = await Promise.all([
      getMatchState(matchId),
      getLadderRounds(matchId),
    ]);
    if (s) setState(s);
    if (r.rounds) setRounds(r.rounds);
  }, [matchId]);

  // 手機會鎖屏、也會切到別的 app——背景時不要繼續打伺服器
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (!live || !visible) return;
    refresh(); // 切回前景立刻補一次，不用等下一個週期
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [live, visible, refresh]);

  /**
   * 結果成立後繼續盯著「我有沒有新的一場」。
   * 守台的人贏完，挑戰者一發起挑戰就會建立新對戰——不盯的話這頁會停在
   * 結果畫面，下一個挑戰者已經在等了卻沒人知道。找到就停止輪詢。
   */
  useEffect(() => {
    if (state.status !== "confirmed" || !myPlayerId || !visible || next) return;
    const check = async () => {
      const r = await getNextMatch(myPlayerId, matchId);
      if (r) {
        setNext(r);
        setCountdown(NEXT_COUNTDOWN);
        beepNextMatch();
      }
    };
    check();
    const timer = setInterval(check, NEXT_POLL_MS);
    return () => clearInterval(timer);
  }, [state.status, myPlayerId, visible, next, matchId]);

  // 看得見的倒數，數完自動進場
  useEffect(() => {
    if (countdown === null || !next) return;
    if (countdown <= 0) {
      router.push(`/ladder/match/${next.matchId}`);
      return;
    }
    const t = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, next, router]);

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
  /** 我這場的積分變化（轉場橫幅要一起顯示） */
  const myDelta = iAmA ? state.deltaA : state.deltaB;
  const myRating = iAmA ? state.ratingA : state.ratingB;

  /** 逐回合計分：寫進資料庫後以回傳的回合列為準 */
  const runRound = async (
    fn: (playerId: string) => Promise<LadderRoundsResult>,
    onBefore?: () => void
  ) => {
    if (!myPlayerId) return;
    setError(null);
    onBefore?.();
    setBusy(true);
    const r = await fn(myPlayerId);
    setBusy(false);
    if (r.rounds) setRounds(r.rounds);
    if (!r.ok) setError(r.error ?? "計分失敗");
  };

  /**
   * 分出勝負後鎖住計分（比照賽事版），但「−1」與「復原上一筆」仍可按，
   * 那是誤判復原的路徑。判定用 lib/bracket 的共用函式，
   * 和 addLadderFinish 的伺服器端守門是同一份邏輯。
   */
  const decided = isDecided(sA, sB);
  const winnerSide: 1 | 2 | null = decided ? (sA > sB ? 1 : 2) : null;
  const winner = winnerSide === 1 ? playerA : playerB;

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

  /** 該側的四顆結束方式（2×2） */
  const Finishes = ({ side }: { side: 1 | 2 }) => (
    <div className="grid flex-1 grid-cols-2 gap-1.5">
      {FINISH_TYPES.map((f) => (
        <button
          key={f.type}
          type="button"
          disabled={busy || decided}
          onClick={() =>
            runRound(
              (pid) => addLadderFinish(matchId, pid, side, f.type),
              () => beepScore(side, f.points)
            )
          }
          className={`rounded-xl border-2 py-2.5 transition active:scale-95 disabled:opacity-30 ${
            side === 1
              ? "border-cyanx/50 bg-cyanx/10"
              : "border-red-400/50 bg-red-500/10"
          }`}
        >
          <span className="block text-base leading-none">{f.icon}</span>
          <span className="mt-0.5 block text-xs font-black leading-none">
            {f.label}
          </span>
          <span className="mt-0.5 block font-num text-[10px] text-slate-400">
            ＋{f.points}
          </span>
        </button>
      ))}
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
            先取 {WIN_POINTS} 分獲勝｜任一方計分後由該裝置回報
          </p>

          {/* 天梯沒有裁判，這顆按鈕就是裁判 */}
          <div className="mt-3">
            <RoundCountdown disabled={busy || decided} />
            <p className="mt-1.5 text-center text-[11px] text-slate-500">
              按下會全螢幕倒數 3、2、1、GO SHOOT（有聲音）
            </p>
          </div>

          <div className="mt-3 flex gap-2">
            <Finishes side={1} />
            <Finishes side={2} />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                runRound(
                  (pid) => addLadderPenalty(matchId, pid, 1),
                  () => beepUndo()
                )
              }
              className="flex-1 rounded-xl border border-cyanx/30 py-1.5 text-xs text-cyanx/70 disabled:opacity-30"
            >
              藍方 −1
            </button>
            <ReshootButton
              disabled={busy || decided}
              onPick={(reason: ReshootReason) =>
                runRound(
                  (pid) => addLadderReshoot(matchId, pid, reason),
                  () => beepReshoot()
                )
              }
            />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                runRound(
                  (pid) => addLadderPenalty(matchId, pid, 2),
                  () => beepUndo()
                )
              }
              className="flex-1 rounded-xl border border-red-400/30 py-1.5 text-xs text-red-300/70 disabled:opacity-30"
            >
              紅方 −1
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                runRound(
                  (pid) => undoLadderRound(matchId, pid),
                  () => beepUndo()
                )
              }
              className="flex-1 rounded-xl border border-arena-line py-1.5 text-xs text-slate-400 disabled:opacity-30"
            >
              ↩ 復原上一筆
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                runRound(
                  (pid) => clearLadderRounds(matchId, pid),
                  () => beepUndo()
                )
              }
              className="flex-1 rounded-xl border border-arena-line py-1.5 text-xs text-slate-400 disabled:opacity-30"
            >
              歸零重來
            </button>
          </div>

          {/* 分出勝負：計分已鎖，回報成為主要動作 */}
          {decided && (
            <div className="mt-4 rounded-xl border border-gold/60 bg-gold/10 p-3 text-center">
              <p className="text-base font-black text-gold">
                🏆 {winnerSide === 1 ? "藍方" : "紅方"} {winner.nickname} 獲勝
              </p>
              <p className="font-num text-3xl font-bold leading-tight">
                {sA} : {sB}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                判錯了？按「−1」或「復原上一筆」就能解鎖繼續打
              </p>
            </div>
          )}

          <button
            onClick={submit}
            disabled={busy || sA === sB}
            className={
              decided
                ? "btn-gold mt-3 w-full disabled:opacity-40"
                : "mt-4 w-full rounded-xl border border-arena-line py-2.5 text-sm font-bold text-slate-300 transition active:scale-95 hover:border-cyanx/60 disabled:opacity-40"
            }
          >
            {sA === sB
              ? "比分相同，無法回報"
              : decided
                ? `回報結果 ${sA}:${sB}`
                : `提前回報 ${sA}:${sB}`}
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-500">
            {decided
              ? `回報後由敗方確認才計分，${AUTO_CONFIRM_MINUTES} 分鐘未確認自動成立。`
              : "還沒打完——對手中途離場之類的狀況才需要提前回報。"}
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

          {/* 只有敗方能確認——勝方看到按鈕只會按出錯誤訊息，所以不顯示 */}
          {!winnerIsMe && (
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
          )}
          <p className="mt-3 text-[11px] text-slate-500">
            {AUTO_CONFIRM_MINUTES} 分鐘內未操作，這個結果會自動成立；
            對手接受下一場挑戰時，這場也會直接成立。
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

      <RoundTimeline rows={rounds} player1={playerA} player2={playerB} />

      {isParticipant && (
        <p className="text-center text-xs text-slate-600">
          你以「{me.avatar} {me.nickname}」出賽
        </p>
      )}

      {/* 下一場來了：積分變化一起放進來，不必為了看它而按「稍等」 */}
      {next && (
        <div className="fixed inset-x-0 bottom-0 z-[80] border-t-2 border-cyanx/60 bg-arena-deep/95 p-3 pb-5 backdrop-blur">
          <div className="mx-auto max-w-md">
            <div className="flex items-center gap-3">
              {myDelta !== null && (
                <span className="shrink-0 rounded-xl border border-gold/50 bg-gold/10 px-3 py-1.5 text-center">
                  <span
                    className={`block font-num text-lg font-black leading-none ${
                      myDelta > 0
                        ? "text-emerald-300"
                        : myDelta < 0
                          ? "text-red-300"
                          : "text-slate-400"
                    }`}
                  >
                    {myDelta > 0 ? `+${myDelta}` : myDelta}
                  </span>
                  <span className="mt-0.5 block font-num text-[11px] text-slate-400">
                    → {myRating ?? "—"}
                  </span>
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] tracking-widest text-cyanx">
                  ⚔️ 下一場
                </span>
                <span className="block truncate text-base font-black">
                  {next.opponentAvatar} {next.opponentNickname} 向你挑戰
                </span>
              </span>
              {countdown !== null && (
                <span className="shrink-0 font-num text-4xl font-black leading-none text-cyanx text-glow">
                  {countdown}
                </span>
              )}
            </div>

            <div className="mt-2.5 flex gap-2">
              <button
                onClick={() => router.push(`/ladder/match/${next.matchId}`)}
                className="btn-x flex-[2] py-2.5 text-sm"
              >
                進入對戰
              </button>
              {countdown !== null && (
                <button
                  onClick={() => setCountdown(null)}
                  className="flex-1 rounded-xl border border-arena-line py-2.5 text-sm text-slate-400 transition hover:border-slate-300 hover:text-slate-200"
                >
                  稍等
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
