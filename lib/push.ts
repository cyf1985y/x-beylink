import { SupabaseClient } from "@supabase/supabase-js";

/**
 * LINE Messaging API 推播（官方帳號）。
 * 沒設 LINE_MESSAGING_ACCESS_TOKEN 時安全略過（不影響主流程）；
 * 推播失敗（例如使用者未加官方帳號好友）也只記 log 不拋錯。
 */
export async function pushText(
  lineUserId: string,
  text: string
): Promise<void> {
  const token = process.env.LINE_MESSAGING_ACCESS_TOKEN;
  if (!token) return;
  if (!lineUserId || lineUserId.startsWith("DEV_")) return;
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: "text", text: text.slice(0, 4900) }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`LINE 推播失敗（${res.status}）：${lineUserId}`);
    }
  } catch (e) {
    console.warn("LINE 推播錯誤：", e);
  }
}

/** 推播給多位選手的監護帳號（自動去重，同一家長多選手只推一次） */
export async function pushToPlayers(
  db: SupabaseClient,
  playerIds: string[],
  text: string
): Promise<void> {
  if (playerIds.length === 0) return;
  if (!process.env.LINE_MESSAGING_ACCESS_TOKEN) return;

  const { data: players } = await db
    .from("players")
    .select("user_id")
    .in("id", playerIds)
    .returns<Array<{ user_id: string }>>();
  const userIds = Array.from(new Set((players ?? []).map((p) => p.user_id)));
  if (userIds.length === 0) return;

  const { data: users } = await db
    .from("users")
    .select("line_user_id")
    .in("id", userIds)
    .returns<Array<{ line_user_id: string }>>();

  await Promise.all(
    (users ?? []).map((u) => pushText(u.line_user_id, text))
  );
}
