import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import { DbRegistration } from "@/lib/events";

export const dynamic = "force-dynamic";

/** 憑證頁輪詢用：查自己這筆報名是否已完成報到（僅本人可查） */
export async function GET(
  _req: Request,
  { params }: { params: { regId: string } }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const db = supabaseAdmin();
  const { data: reg } = await db
    .from("registrations")
    .select("*")
    .eq("id", params.regId)
    .maybeSingle<DbRegistration>();
  if (!reg) return new NextResponse("Not Found", { status: 404 });

  const { data: player } = await db
    .from("players")
    .select("user_id")
    .eq("id", reg.player_id)
    .single<Pick<DbPlayer, "user_id">>();
  if (!player || player.user_id !== session.uid) {
    return new NextResponse("Not Found", { status: 404 });
  }

  return NextResponse.json({
    checkedIn: !!reg.checked_in_at,
    eventId: reg.event_id,
  });
}
