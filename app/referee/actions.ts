"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";

export type JoinResult = { ok: boolean; error?: string };

/** 兌換裁判碼 RPC 的錯誤碼對應訊息 */
const REDEEM_ERROR_MESSAGES: Record<string, string> = {
  invalid_code: "邀請碼無效",
  event_closed: "此賽事已結束或取消",
  code_not_active:
    "邀請碼尚未生效——賽事當天（開賽前後 12 小時內）才能加入裁判",
};

/**
 * 掃主辦方的邀請碼成為本場裁判（獲得記分權，不含結算權）。
 *
 * 驗證與寫入交給資料庫函式 `redeem_referee_code`：它會檢查賽事狀態與有效視窗
 * （開賽前後 12 小時），並冪等地寫入 referees 表。賽事結束／取消／流局時
 * 資料庫觸發器會自動更換 referee_code，舊連結立即失效（已加入的裁判不受影響）。
 */
export async function joinAsReferee(
  _prev: JoinResult,
  formData: FormData
): Promise<JoinResult> {
  const code = String(formData.get("code") ?? "");
  const session = await getSession();
  if (!session) return { ok: false, error: "請先登入" };
  if (!/^[0-9a-f-]{36}$/i.test(code)) {
    return { ok: false, error: "邀請碼格式不正確" };
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .rpc("redeem_referee_code", { p_code: code, p_user_id: session.uid })
    .single<{
      ok: boolean;
      event_id: string | null;
      error_code: string | null;
    }>();

  if (error || !data) return { ok: false, error: "加入失敗，請稍後再試" };

  if (!data.ok || !data.event_id) {
    return {
      ok: false,
      error: REDEEM_ERROR_MESSAGES[data.error_code ?? ""] ?? "加入失敗",
    };
  }

  redirect(`/referee/event/${data.event_id}`);
}
