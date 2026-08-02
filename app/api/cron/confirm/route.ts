import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { settleDueEvents } from "@/lib/settle";

export const dynamic = "force-dynamic";

/**
 * 流局判定 cron（Vercel Cron 每日呼叫；頁面載入時也會補跑，見 lib/settle.ts）。
 * 以 CRON_SECRET 保護（Vercel 設定後會自動帶 Authorization header）。
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const results = await settleDueEvents(supabaseAdmin());
  return NextResponse.json({ processed: results.length, results });
}
