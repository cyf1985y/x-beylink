import { supabaseAdmin } from "@/lib/supabase";
import { Session } from "@/lib/session";

/**
 * 平台管理員判定，兩條路任一成立即可：
 * 1. users.is_admin 為 true（直接在資料庫指定，不需要改環境變數重新部署）
 * 2. ADMIN_LINE_USER_IDS 環境變數列出該 LINE userId（逗號分隔）
 *
 * 保留環境變數這條路是保險用的：萬一資料庫的 is_admin 被誤改成全部 false，
 * 還能靠環境變數把管理權限救回來。LINE userId 可在 LINE Developers →
 * Messaging API channel → Your user ID 找到。
 */
export async function isAdmin(session: Session | null): Promise<boolean> {
  if (!session) return false;

  const db = supabaseAdmin();
  const { data: user } = await db
    .from("users")
    .select("line_user_id,is_admin")
    .eq("id", session.uid)
    .single<{ line_user_id: string; is_admin: boolean }>();
  if (!user) return false;
  if (user.is_admin) return true;

  const raw = process.env.ADMIN_LINE_USER_IDS;
  if (!raw) return false;
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(user.line_user_id);
}
