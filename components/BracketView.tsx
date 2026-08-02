"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import {
  reportWinner,
  undoMatch,
  settleFromBracket,
  generateBracket,
  type FormResult,
} from "@/app/host/actions";
import { roundName } from "@/lib/bracket";

const initialState: FormResult = { ok: false };

export type ViewMatch = {
  id: string;
  round: number;
  slot: number;
  kind: "normal" | "third";
  player1: { id: string; nickname: string; avatar: string } | null;
  player2: { id: string; nickname: string; avatar: string } | null;
  winnerId: string | null;
};

function WinnerButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <span
      className={`ml-auto rounded-md border px-2 py-0.5 text-xs ${
        disabled
          ? "border-transparent"
          : "border-arena-line text-slate-400 group-hover:border-cyanx group-hover:text-cyanx"
      }`}
    >
      {pending ? "…" : disabled ? "" : "獲勝"}
    </span>
  );
}

function PlayerRow({
  eventId,
  matchId,
  player,
  isWinner,
  decided,
  interactive,
}: {
  eventId: string;
  matchId: string;
  player: { id: string; nickname: string; avatar: string } | null;
  isWinner: boolean;
  decided: boolean;
  interactive: boolean;
}) {
  const [, formAction] = useFormState(reportWinner, initialState);

  const inner = (
    <div
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
        isWinner
          ? "bg-cyanx/15 font-bold text-cyanx"
          : decided
            ? "text-slate-500 line-through decoration-slate-600"
            : "text-slate-200"
      }`}
    >
      <span>{player?.avatar ?? "❔"}</span>
      <span className="truncate">{player?.nickname ?? "（待定）"}</span>
      {isWinner && <span className="ml-auto text-xs">✔</span>}
      {interactive && player && !decided && <WinnerButton />}
    </div>
  );

  if (!interactive || !player || decided) return inner;
  return (
    <form action={formAction} className="group w-full">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="match_id" value={matchId} />
      <input type="hidden" name="winner_id" value={player.id} />
      <button type="submit" className="w-full text-left">
        {inner}
      </button>
    </form>
  );
}

function UndoButton({ eventId, matchId }: { eventId: string; matchId: string }) {
  const [state, formAction] = useFormState(undoMatch, initialState);
  return (
    <form action={formAction} className="text-right">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="match_id" value={matchId} />
      <button className="text-[10px] text-slate-600 hover:text-red-300">
        撤銷
      </button>
      {state.error && (
        <p className="text-[10px] text-red-300">{state.error}</p>
      )}
    </form>
  );
}

function MatchCard({
  eventId,
  m,
  finalRound,
  interactive,
}: {
  eventId: string;
  m: ViewMatch;
  finalRound: number;
  interactive: boolean;
}) {
  const decided = !!m.winnerId;
  const isBye = m.round === 1 && (!m.player1 || !m.player2);
  return (
    <div
      className={`w-52 shrink-0 rounded-xl border p-2 ${
        m.kind === "third"
          ? "border-bronze/40 bg-arena-card"
          : m.round === finalRound
            ? "border-gold/40 bg-arena-card"
            : "border-arena-line bg-arena-card"
      }`}
    >
      <div className="mb-1 flex items-center justify-between px-1 text-[10px] text-slate-500">
        <span>
          {m.kind === "third"
            ? "季軍戰"
            : `${roundName(m.round, finalRound)} 第 ${m.slot + 1} 場`}
          {isBye && "（輪空）"}
        </span>
        {interactive && decided && !isBye && (
          <UndoButton eventId={eventId} matchId={m.id} />
        )}
      </div>
      <PlayerRow
        eventId={eventId}
        matchId={m.id}
        player={m.player1}
        isWinner={decided && m.winnerId === m.player1?.id}
        decided={decided}
        interactive={interactive}
      />
      <PlayerRow
        eventId={eventId}
        matchId={m.id}
        player={m.player2}
        isWinner={decided && m.winnerId === m.player2?.id}
        decided={decided}
        interactive={interactive}
      />
    </div>
  );
}

export function BracketView({
  eventId,
  matches,
  interactive,
  autoRefresh,
}: {
  eventId: string;
  matches: ViewMatch[];
  interactive: boolean;
  autoRefresh?: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [autoRefresh, router]);

  const finalRound = Math.max(...matches.map((m) => m.round));
  const rounds: number[] = Array.from(
    new Set(matches.filter((m) => m.kind === "normal").map((m) => m.round))
  ).sort((a, b) => a - b);
  const third = matches.find((m) => m.kind === "third");

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex items-start gap-4">
        {rounds.map((r) => (
          <div key={r} className="flex flex-col gap-3">
            <p className="text-center text-xs font-bold text-slate-400">
              {roundName(r, finalRound)}
            </p>
            <div
              className="flex flex-col justify-around gap-3"
              style={{ minHeight: "100%" }}
            >
              {matches
                .filter((m) => m.kind === "normal" && m.round === r)
                .map((m) => (
                  <MatchCard
                    key={m.id}
                    eventId={eventId}
                    m={m}
                    finalRound={finalRound}
                    interactive={interactive}
                  />
                ))}
            </div>
          </div>
        ))}
        {third && (
          <div className="flex flex-col gap-3">
            <p className="text-center text-xs font-bold text-bronze">季軍戰</p>
            <MatchCard
              eventId={eventId}
              m={third}
              finalRound={finalRound}
              interactive={interactive}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function SettleFromBracketButton({ eventId }: { eventId: string }) {
  const [state, formAction] = useFormState(settleFromBracket, initialState);
  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="event_id" value={eventId} />
      <button className="w-full rounded-xl bg-gold px-4 py-3 font-bold text-arena transition hover:brightness-110">
        🏆 依對戰表結果一鍵結算發獎
      </button>
      {state.error && (
        <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="mt-2 rounded-lg border border-emerald-400/50 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">
          ✅ 結算完成，獎盃已發放！
        </p>
      )}
    </form>
  );
}

export function GenerateBracketButton({ eventId }: { eventId: string }) {
  const [state, formAction] = useFormState(generateBracket, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="event_id" value={eventId} />
      <button className="w-full rounded-xl bg-violetx px-4 py-3 font-bold text-white transition hover:brightness-110">
        ⚔️ 產生對戰表（從已報到選手隨機配對）
      </button>
      {state.error && (
        <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}
