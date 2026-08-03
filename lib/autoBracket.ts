import { SupabaseClient } from "@supabase/supabase-js";
import { DbEvent, formatTaipei } from "@/lib/events";
import { buildBracket } from "@/lib/bracket";
import { pushToPlayers } from "@/lib/push";

/**
 * 報名截止自動抽籤：
 * 到 registration_deadline（開賽前 2 小時）的賽事，若還沒有對戰表，
 * 就用「已報名（ok）」名單隨機配對產生對戰表並推播通知。
 * 爽約的選手其對手直接晉級（運氣是比賽的一環）；
 * 若現場缺席太多，主辦方可在開打前用實到名單「重新抽籤」。
 *
 * 冪等：已有 matches 的賽事會跳過。頁面載入與每日 cron 都會呼叫。
 */
export async function autoGenerateBrackets(
  db: SupabaseClient
): Promise<Array<{ id: string; title: string; players: number }>> {
  const now = new Date().toISOString();
  const { data: due } = await db
    .from("events")
    .select("*")
    .in("status", ["open", "confirmed"])
    .lte("registration_deadline", now)
    .gt("starts_at", new Date(Date.now() - 12 * 3600_000).toISOString())
    .returns<DbEvent[]>();

  const results: Array<{ id: string; title: string; players: number }> = [];
  for (const event of due ?? []) {
    const { count: existing } = await db
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id);
    if ((existing ?? 0) > 0) continue;

    const { data: regs } = await db
      .from("registrations")
      .select("player_id")
      .eq("event_id", event.id)
      .eq("status", "ok")
      .returns<Array<{ player_id: string }>>();
    const playerIds = (regs ?? []).map((r) => r.player_id);
    if (playerIds.length < 2) continue;

    try {
      const rows = buildBracket(event.id, playerIds);
      const { error } = await db.from("matches").insert(rows);
      if (error) continue;
      results.push({
        id: event.id,
        title: event.title,
        players: playerIds.length,
      });
      await pushToPlayers(
        db,
        playerIds,
        `⚔️【${event.title}】對戰表出爐了！\n🗓 ${formatTaipei(event.starts_at)}\n📍 ${event.venue}\n快到賽事頁看看第一輪要對上誰。記得準時到場報到，缺席的話對手會直接晉級喔！`
      );
    } catch {
      continue;
    }
  }
  return results;
}
