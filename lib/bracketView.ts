import { SupabaseClient } from "@supabase/supabase-js";
import { DbMatch, loadMatches } from "@/lib/bracket";
import { DbPlayer } from "@/lib/supabase";
import type { ViewMatch } from "@/components/BracketView";

/** 讀對戰表＋選手資料，組成前端用的 ViewMatch 結構 */
export async function loadBracketView(
  db: SupabaseClient,
  eventId: string
): Promise<{ matches: DbMatch[]; view: ViewMatch[] }> {
  const matches = await loadMatches(db, eventId);
  if (matches.length === 0) return { matches, view: [] };

  const playerIds = Array.from(
    new Set(
      matches
        .flatMap((m) => [m.player1_id, m.player2_id])
        .filter((x): x is string => !!x)
    )
  );
  const [{ data: players }, { data: regs }] = await Promise.all([
    playerIds.length
      ? db
          .from("players")
          .select("id,nickname,avatar")
          .in("id", playerIds)
          .returns<Array<Pick<DbPlayer, "id" | "nickname" | "avatar">>>()
      : Promise.resolve({
          data: [] as Array<Pick<DbPlayer, "id" | "nickname" | "avatar">>,
        }),
    db
      .from("registrations")
      .select("player_id,checked_in_at")
      .eq("event_id", eventId)
      .returns<Array<{ player_id: string; checked_in_at: string | null }>>(),
  ]);
  const map = new Map((players ?? []).map((p) => [p.id, p]));
  const checkedIn = new Set(
    (regs ?? []).filter((r) => r.checked_in_at).map((r) => r.player_id)
  );

  const toP = (id: string | null) => {
    if (!id) return null;
    const p = map.get(id);
    return {
      id,
      nickname: p?.nickname ?? "選手",
      avatar: p?.avatar ?? "🌀",
      checkedIn: checkedIn.has(id),
    };
  };

  const view: ViewMatch[] = matches.map((m) => ({
    id: m.id,
    round: m.round,
    slot: m.slot,
    kind: m.kind,
    player1: toP(m.player1_id),
    player2: toP(m.player2_id),
    winnerId: m.winner_id,
    score1: m.score1,
    score2: m.score2,
  }));
  return { matches, view };
}
