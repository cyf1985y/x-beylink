import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import { requireScorer } from "@/lib/scorer";
import { loadMatches, roundName, finalRoundOf } from "@/lib/bracket";
import { getMatchRounds } from "@/app/referee/scoring";
import { ScoringPanel, type ScoringMatch } from "@/components/ScoringPanel";

export const dynamic = "force-dynamic";

export default async function RefereeMatchPage({
  params,
}: {
  params: { id: string; matchId: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const auth = await requireScorer(params.id);
  if (auth.error || !auth.event) notFound();
  const event = auth.event;

  const db = supabaseAdmin();
  const matches = await loadMatches(db, event.id);
  const match = matches.find((m) => m.id === params.matchId);
  if (!match) notFound();

  const ids = [match.player1_id, match.player2_id].filter(
    (x): x is string => !!x
  );
  const { data: players } = ids.length
    ? await db
        .from("players")
        .select("id,nickname,avatar")
        .in("id", ids)
        .returns<Array<Pick<DbPlayer, "id" | "nickname" | "avatar">>>()
    : { data: [] as Array<Pick<DbPlayer, "id" | "nickname" | "avatar">> };
  const map = new Map((players ?? []).map((p) => [p.id, p]));
  const toP = (id: string | null) => {
    if (!id) return null;
    const p = map.get(id);
    return {
      id,
      nickname: p?.nickname ?? "選手",
      avatar: p?.avatar ?? "🌀",
    };
  };

  const rounds = await getMatchRounds(match.id);
  const finalRound = finalRoundOf(matches);
  const view: ScoringMatch = {
    id: match.id,
    eventId: event.id,
    roundLabel:
      match.kind === "third" ? "季軍戰" : roundName(match.round, finalRound),
    tableNo: match.slot + 1,
    player1: toP(match.player1_id),
    player2: toP(match.player2_id),
    score1: match.score1,
    score2: match.score2,
    winnerId: match.winner_id,
  };

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <div className="flex items-center justify-between">
        <Link
          href={`/referee/event/${event.id}`}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← 對戰列表
        </Link>
        <span className="rounded-full border border-violetx/50 bg-violetx/10 px-2.5 py-0.5 text-xs text-violetx">
          🧑‍⚖️ 裁判模式
        </span>
      </div>
      <h1 className="mt-3 truncate text-lg font-black">{event.title}</h1>

      <div className="mt-4">
        <ScoringPanel match={view} initialRounds={rounds} />
      </div>

      <p className="mt-6 text-center text-xs text-slate-600">
        成績由裁判輸入（誰判定、誰輸入）——選手多為 6–12
        歲無手機，且成績直接餵獎盃與信譽系統，裁判輸入才有公信力。
      </p>
    </main>
  );
}
