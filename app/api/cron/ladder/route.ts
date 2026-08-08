import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * 天梯維護 cron：
 * 1) 逾時未確認的對戰自動成立（積分由 ladder_confirm_result 計算）
 * 2) 作廢過期未完成的對戰
 *
 * 即時性主要靠頁面載入補跑（見 lib/ladder.ts runLadderMaintenance），
 * 這支 cron 是每日掃底，處理沒有人開頁面的殘留。
 * 以 CRON_SECRET 保護，比照 /api/cron/confirm。
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db.rpc("ladder_maintenance");
  if (error) {
    console.error("天梯維護失敗：", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    autoconfirmed: row?.autoconfirmed ?? 0,
    voided_stale: row?.voided_stale ?? 0,
  });
}
