import { supabaseAdmin } from "@/lib/supabase";
import { Session } from "@/lib/session";

/**
 * 平台管理員判定：ADMIN_LINE_USER_IDS 環境變數（逗號分隔的 LINE userId）。
 * LINE userId 可在 LINE Developers → Messaging API channel → Your user ID 找到。
 */
export async function isAdmin(session: Session | null): Promise<boolean> {
  if (!session) return false;
  const raw = process.env.ADMIN_LINE_USER_IDS;
  if (!raw) return false;
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return false;

  const db = supabaseAdmin();
  const { data: user } = await db
    .from("users")
    .select("line_user_id")
    .eq("id", session.uid)
    .single<{ line_user_id: string }>();
  return !!user && allowed.includes(user.line_user_id);
}
