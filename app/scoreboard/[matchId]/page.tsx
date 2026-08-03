import { notFound } from "next/navigation";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import { DbEvent } from "@/lib/events";
import { DbMatch, roundName, loadMatches, finalRoundOf } from "@/lib/bracket";
import { ScoreboardLive } from "@/components/ScoreboardLive";

export const dynamic = "force-dynamic";

/** 計分板模式：架在戰鬥盤旁的大螢幕，2 秒自動更新 */
export default async function ScoreboardPage({
  params,
}: {
  params: { matchId: string };
}) {
  const db = supabaseAdmin();
  const { data: match } = await db
    .from("matches")
    .select("*")
    .eq("id", params.matchId)
    .maybeSingle<DbMatch>();
  if (!match) notFound();

  const [{ data: event }, { data: players }] = await Promise.all([
    db.from("events").select("*").eq("id", match.event_id).single<DbEvent>(),
    db
      .from("players")
      .select("id,nickname,avatar")
      .in(
        "id",
        [match.player1_id, match.player2_id].filter((x): x is string => !!x)
      )
      .returns<Array<Pick<DbPlayer, "id" | "nickname" | "avatar">>>(),
  ]);
  const map = new Map((players ?? []).map((p) => [p.id, p]));
  const matches = await loadMatches(db, match.event_id);
  const finalRound = finalRoundOf(matches);

  const p = (id: string | null) => {
    if (!id) return { id: "", nickname: "（待定）", avatar: "❔" };
    const found = map.get(id);
    return {
      id,
      nickname: found?.nickname ?? "選手",
      avatar: found?.avatar ?? "🌀",
    };
  };

  return (
    <ScoreboardLive
      matchId={match.id}
      title={event?.title ?? "戰鬥陀螺對戰"}
      roundLabel={
        match.kind === "third" ? "季軍戰" : roundName(match.round, finalRound)
      }
      tableNo={match.slot + 1}
      player1={p(match.player1_id)}
      player2={p(match.player2_id)}
      initialScore1={match.score1}
      initialScore2={match.score2}
      initialWinnerId={match.winner_id}
    />
  );
}
