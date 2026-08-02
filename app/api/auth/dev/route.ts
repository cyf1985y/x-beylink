import { NextRequest, NextResponse } from "next/server";
import { createSessionCookie } from "@/lib/session";
import { supabaseAdmin, DbUser } from "@/lib/supabase";
import { baseUrl } from "@/lib/line";

export const dynamic = "force-dynamic";

/**
 * 開發模式假登入（僅 next dev 可用，production build 一律 404）。
 * 用法：GET /api/auth/dev?as=tester1
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }
  const as = new URL(req.url).searchParams.get("as") ?? "tester1";
  const lineUserId = `DEV_${as}`;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("users")
    .upsert(
      { line_user_id: lineUserId, display_name: `測試員 ${as}` },
      { onConflict: "line_user_id" }
    )
    .select()
    .single<DbUser>();
  if (error || !data) {
    return new NextResponse(`dev login 失敗：${error?.message}`, { status: 500 });
  }
  await createSessionCookie({ uid: data.id, name: data.display_name ?? as });
  return NextResponse.redirect(`${baseUrl()}/me`);
}
