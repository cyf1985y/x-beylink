import { NextRequest, NextResponse } from "next/server";
import { lineAuthorizeUrl } from "@/lib/line";
import { createOAuthState, safeNext } from "@/lib/oauthState";

export const dynamic = "force-dynamic";

/**
 * 導向 LINE 授權頁。
 *
 * CSRF state 是簽章過的短效 JWT，直接掛在授權 URL 上，不寫任何 cookie——
 * LINE app-to-app 授權回程讀不到我們寫的 cookie（見 lib/oauthState.ts）。
 * ?next=/path 登入後導回的頁面也一併塞進 state payload。
 */
export async function GET(req: NextRequest) {
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  const state = await createOAuthState(next);
  return NextResponse.redirect(lineAuthorizeUrl(state));
}
