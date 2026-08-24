import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSessionCookie } from "@/lib/session";
import { supabaseAdmin, DbUser } from "@/lib/supabase";
import { baseUrl } from "@/lib/line";

export const dynamic = "force-dynamic";

/** 已部署環境允許假登入的測試帳號（對應 users.line_user_id 的 DEV_ 後綴） */
const DEPLOYED_ACCOUNTS = ["DUMMY"];

/**
 * 開發／測試用假登入。
 *
 * 兩條路才進得來，都不成立就當作這個路由不存在（404，不是 403——
 * 403 等於告訴外面「這裡有東西」）：
 *
 * 1. `next dev` 本機開發：直接放行，不必帶 token
 * 2. 已部署的環境：必須設 `DEV_LOGIN_TOKEN` 環境變數，且網址帶對 token
 *
 * 第 2 條是為了在 Vercel 的 Preview 環境跑跨裝置測試——preview 是
 * production build，原本的 `NODE_ENV === "production"` 擋板會讓它 404。
 * 正式站只要不設 `DEV_LOGIN_TOKEN`，行為和以前完全一樣：一律 404。
 *
 * ⚠️ 這條路能直接變成任何測試帳號，**絕對不要**在正式站設這個環境變數。
 * 測完把 Preview 的環境變數刪掉即可關閉，不必再改程式。
 *
 * 用法：GET /api/auth/dev?as=tester1&token=<DEV_LOGIN_TOKEN>
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (!devLoginAllowed(url.searchParams.get("token"))) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const as = url.searchParams.get("as") ?? "tester1";
  // 已部署的環境只認白名單裡的測試帳號。少了這道，帶對 token 的人可以
  // 隨意捏造 DEV_xxx 帳號灌進排行榜；本機開發不受限，想開幾個都行。
  if (process.env.NODE_ENV === "production" && !DEPLOYED_ACCOUNTS.includes(as)) {
    return new NextResponse("Not Found", { status: 404 });
  }
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
  return NextResponse.redirect(`${baseUrl()}/`);
}

function devLoginAllowed(token: string | null): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const expected = process.env.DEV_LOGIN_TOKEN;
  if (!expected) return false;
  return !!token && safeEqual(token, expected);
}

/** 定值時間比對，避免用回應時間一個字元一個字元試出 token */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
