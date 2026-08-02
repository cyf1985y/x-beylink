import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { lineAuthorizeUrl } from "@/lib/line";

export const dynamic = "force-dynamic";

/** 導向 LINE 授權頁，並用 cookie 保存 state 防 CSRF；?next=/path 登入後導回 */
export async function GET(req: NextRequest) {
  const state = crypto.randomUUID();
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 10 * 60,
  };
  cookies().set("xb_oauth_state", state, cookieOpts);

  // 登入後返回頁（僅限站內路徑，防 open redirect）
  const next = new URL(req.url).searchParams.get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    cookies().set("xb_next", next, cookieOpts);
  }
  return NextResponse.redirect(lineAuthorizeUrl(state));
}
