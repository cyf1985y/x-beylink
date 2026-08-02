import { SupabaseClient } from "@supabase/supabase-js";
import { DbEvent, formatTaipei } from "@/lib/events";
import { pushToPlayers } from "@/lib/push";

/**
 * 成行／流局判定：把所有已到 confirm_deadline 的 open 賽事結算掉。
 * 達 min_required → confirmed；未達 → void（玩家信譽一律不受影響）。
 * 冪等、通常零筆，除了每日 cron 外也在列表／詳情頁載入時呼叫，
 * 彌補 Vercel 免費層 cron 只能每日一次的限制。
 */
export async function settleDueEvents(
  db: SupabaseClient
): Promise<Array<{ id: string; title: string; to: "confirmed" | "void" }>> {
  const { data: due } = await db
    .from("events")
    .select("*")
    .eq("status", "open")
    .lte("confirm_deadline", new Date().toISOString())
    .returns<DbEvent[]>();

  const results: Array<{ id: string; title: string; to: "confirmed" | "void" }> =
    [];
  for (const event of due ?? []) {
    const { count } = await db
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id)
      .eq("status", "ok");
    const to = (count ?? 0) >= event.min_required ? "confirmed" : "void";
    await db.from("events").update({ status: to }).eq("id", event.id);
    results.push({ id: event.id, title: event.title, to });

    // LINE 推播成團／流局通知（沒設 token 時自動略過）
    const { data: regs } = await db
      .from("registrations")
      .select("player_id")
      .eq("event_id", event.id)
      .in("status", ["ok", "waitlist"])
      .returns<Array<{ player_id: string }>>();
    const playerIds = (regs ?? []).map((r) => r.player_id);
    const when = formatTaipei(event.starts_at);
    await pushToPlayers(
      db,
      playerIds,
      to === "confirmed"
        ? `🎉【${event.title}】人數達標，確定開打！\n🗓 ${when}\n📍 ${event.venue}\n記得帶陀螺與發射器，到場出示報到 QR Code。`
        : `😢【${event.title}】報名人數未達成團門檻，本場流局。\n所有人的信譽不受影響，期待下一場再集結！`
    );
  }
  return results;
}
