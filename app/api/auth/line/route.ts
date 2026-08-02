import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { lineAuthorizeUrl } from "@/lib/line";

export const dynamic = "force-dynamic";

/** 導向 LINE 授權頁，並用 cookie 保存 state 防 CSRF */
export async function GET() {
  const state = crypto.randomUUID();
  cookies().set("xb_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return NextResponse.redirect(lineAuthorizeUrl(state));
}
