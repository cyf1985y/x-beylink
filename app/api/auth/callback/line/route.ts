import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, fetchLineProfile, baseUrl } from "@/lib/line";
import { verifyOAuthState } from "@/lib/oauthState";
import { createSessionCookie } from "@/lib/session";
import { supabaseAdmin, DbUser } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** LINE OAuth callback：驗 state → 換 token → 取 profile → upsert users → 建 session */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  const loginFail = (reason: string) =>
    NextResponse.redirect(`${baseUrl()}/login?error=${encodeURIComponent(reason)}`);

  if (url.searchParams.get("error")) {
    return loginFail("你取消了 LINE 登入");
  }

  // state 是簽章 JWT，驗證不依賴 cookie（LINE 內建瀏覽器讀不到 cookie）
  const verified = await verifyOAuthState(url.searchParams.get("state"));
  if (!verified.ok) {
    return loginFail(
      verified.reason === "expired"
        ? "登入逾時，請重新登入"
        : "登入驗證失敗，請重試"
    );
  }
  if (!code) {
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

    // 登入後導回原本要去的頁（已在 state 內驗證過只收站內路徑）
    // 沒指定 next 就回首頁。首頁有「選手檔案」入口磚，還沒建檔的人不會迷路；
    // 直接丟到 /me 會讓已經建好檔的老使用者每次登入都先看到一頁跟他無關的表單。
    return NextResponse.redirect(`${baseUrl()}${verified.state.next ?? "/"}`);
  } catch (e) {
    console.error("LINE 登入失敗：", e);
    return loginFail("登入過程發生錯誤，請重試");
  }
}
