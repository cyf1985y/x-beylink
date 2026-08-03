import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { settleDueEvents } from "@/lib/settle";
import { autoGenerateBrackets } from "@/lib/autoBracket";
import { pushToPlayers } from "@/lib/push";
import { DbEvent, formatTaipei } from "@/lib/events";

export const dynamic = "force-dynamic";

/**
 * 每日 cron（Vercel Cron，台灣午夜）：
 * 1) 流局判定（頁面載入時也會補跑，見 lib/settle.ts）
 * 2) 賽前提醒：24 小時內開打的 confirmed 賽事推播提醒（每日跑一次，不會重複轟炸）
 * 以 CRON_SECRET 保護（Vercel 設定後會自動帶 Authorization header）。
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const db = supabaseAdmin();
  const results = await settleDueEvents(db);
  const brackets = await autoGenerateBrackets(db);

  // 賽前提醒
  let reminded = 0;
  const { data: upcoming } = await db
    .from("events")
    .select("*")
    .eq("status", "confirmed")
    .gt("starts_at", new Date().toISOString())
    .lte("starts_at", new Date(Date.now() + 24 * 3600_000).toISOString())
    .returns<DbEvent[]>();
  for (const event of upcoming ?? []) {
    const { data: regs } = await db
      .from("registrations")
      .select("player_id")
      .eq("event_id", event.id)
      .eq("status", "ok")
      .returns<Array<{ player_id: string }>>();
    const playerIds = (regs ?? []).map((r) => r.player_id);
    await pushToPlayers(
      db,
      playerIds,
      `⏰ 賽前提醒：【${event.title}】明天開打！\n🗓 ${formatTaipei(event.starts_at)}\n📍 ${event.venue}\n記得帶陀螺與發射器，到場出示報到 QR Code。無故缺席會記 1 點信譽點數喔。`
    );
    reminded += playerIds.length;
  }

  return NextResponse.json({
    processed: results.length,
    results,
    brackets,
    reminded,
  });
}
