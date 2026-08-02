import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForToken, fetchLineProfile, baseUrl } from "@/lib/line";
import { createSessionCookie } from "@/lib/session";
import { supabaseAdmin, DbUser } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** LINE OAuth callback：換 token → 取 profile → upsert users → 建 session */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = cookies().get("xb_oauth_state")?.value;
  cookies().delete("xb_oauth_state");

  const loginFail = (reason: string) =>
    NextResponse.redirect(`${baseUrl()}/login?error=${encodeURIComponent(reason)}`);

  if (url.searchParams.get("error")) {
    return loginFail("你取消了 LINE 登入");
  }
  if (!code || !state || !savedState || state !== savedState) {
    return loginFail("登入驗證失敗，請重試");
  }

  try {
    const { access_token } = await exchangeCodeForToken(code);
    const profile = await fetchLineProfile(access_token);

    const db = supabaseAdmin();
    const { data, error } = await db
      .from("users")
      .upsert(
        { line_user_id: profile.userId, display_name: profile.displayName },
        { onConflict: "line_user_id" }
      )
      .select()
      .single<DbUser>();
    if (error || !data) throw new Error(error?.message ?? "users upsert 失敗");

    await createSessionCookie({ uid: data.id, name: profile.displayName });
    return NextResponse.redirect(`${baseUrl()}/me`);
  } catch (e) {
    console.error("LINE 登入失敗：", e);
    return loginFail("登入過程發生錯誤，請重試");
  }
}
