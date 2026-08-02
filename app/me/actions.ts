"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import {
  checkNickname,
  checkTeamName,
  isValidAvatar,
  isValidBirthYear,
  isValidCity,
} from "@/lib/moderation";

export type ActionResult = { ok: boolean; error?: string };

/**
 * 新增選手檔案。
 * 業務規則：一個帳號最多 2 位選手——家長、小孩各 1 位；
 * 資料建立後不可修改（比賽現場才能認定本人），建錯只能在尚無任何
 * 報名／獎盃紀錄時刪除重建。
 */
export async function createPlayer(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "請先登入" };

  const nickname = String(formData.get("nickname") ?? "").trim();
  const birthYear = Number(formData.get("birth_year"));
  const role = String(formData.get("role") ?? "");
  const city = String(formData.get("city") ?? "");
  const teamName = String(formData.get("team_name") ?? "").trim();
  const avatar = String(formData.get("avatar") ?? "🌀");

  if (role !== "parent" && role !== "child") {
    return { ok: false, error: "請選擇身分（家長或小孩）" };
  }
  const nicknameError = checkNickname(nickname);
  if (nicknameError) return { ok: false, error: nicknameError };
  if (!isValidBirthYear(birthYear)) return { ok: false, error: "出生年不正確" };
  if (!isValidCity(city)) return { ok: false, error: "請選擇居住縣市" };
  const teamError = checkTeamName(teamName);
  if (teamError) return { ok: false, error: teamError };
  if (!isValidAvatar(avatar)) return { ok: false, error: "頭像不正確" };

  const db = supabaseAdmin();

  // 暱稱全平台不可重複（比賽現場認定本人的依據）
  const { data: sameName } = await db
    .from("players")
    .select("id")
    .eq("nickname", nickname)
    .maybeSingle();
  if (sameName) {
    return { ok: false, error: "這個暱稱已經有人使用了，請換一個" };
  }

  const { data: existing } = await db
    .from("players")
    .select("id,role")
    .eq("user_id", session.uid)
    .returns<Array<{ id: string; role: string }>>();
  if ((existing ?? []).some((p) => p.role === role)) {
    return {
      ok: false,
      error:
        role === "parent"
          ? "你已經建立過家長選手了（每個帳號家長、小孩各限 1 位）"
          : "你已經建立過小孩選手了（每個帳號家長、小孩各限 1 位）",
    };
  }

  const { error } = await db.from("players").insert({
    user_id: session.uid,
    nickname,
    birth_year: birthYear,
    role,
    city,
    team_name: teamName || null,
    avatar,
  });
  if (error) {
    // unique index 攔截同時送出的重複暱稱
    if (error.code === "23505") {
      return { ok: false, error: "這個暱稱已經有人使用了，請換一個" };
    }
    return { ok: false, error: "建立失敗，請稍後再試" };
  }

  revalidatePath("/me");
  return { ok: true };
}

/** 刪除選手檔案（有報名或獎盃紀錄則不可刪，player_id 永不變更原則） */
export async function deletePlayer(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "請先登入" };

  const playerId = String(formData.get("player_id") ?? "");
  const db = supabaseAdmin();

  const { data: player } = await db
    .from("players")
    .select("id,user_id")
    .eq("id", playerId)
    .single<Pick<DbPlayer, "id" | "user_id">>();
  if (!player || player.user_id !== session.uid) {
    return { ok: false, error: "找不到選手或沒有權限" };
  }

  const [{ count: regCount }, { count: trophyCount }] = await Promise.all([
    db
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .eq("player_id", playerId),
    db
      .from("trophies")
      .select("id", { count: "exact", head: true })
      .eq("player_id", playerId),
  ]);
  if ((regCount ?? 0) > 0 || (trophyCount ?? 0) > 0) {
    return { ok: false, error: "此選手已有報名或獎盃紀錄，不可刪除" };
  }

  const { error } = await db.from("players").delete().eq("id", playerId);
  if (error) return { ok: false, error: "刪除失敗，請稍後再試" };

  revalidatePath("/me");
  return { ok: true };
}
