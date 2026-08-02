"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import { checkNickname, isValidAvatar, isValidBirthYear } from "@/lib/moderation";

export type ActionResult = { ok: boolean; error?: string };

function parsePlayerInput(formData: FormData): {
  error?: string;
  nickname?: string;
  birthYear?: number;
  avatar?: string;
} {
  const nickname = String(formData.get("nickname") ?? "").trim();
  const birthYear = Number(formData.get("birth_year"));
  const avatar = String(formData.get("avatar") ?? "🌀");

  const nicknameError = checkNickname(nickname);
  if (nicknameError) return { error: nicknameError };
  if (!isValidBirthYear(birthYear)) return { error: "出生年不正確" };
  if (!isValidAvatar(avatar)) return { error: "頭像不正確" };
  return { nickname, birthYear, avatar };
}

/** 新增選手檔案（一個帳號最多 6 位，防止灌水） */
export async function createPlayer(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "請先登入" };

  const parsed = parsePlayerInput(formData);
  if (parsed.error) return { ok: false, error: parsed.error };

  const db = supabaseAdmin();

  const { count } = await db
    .from("players")
    .select("id", { count: "exact", head: true })
    .eq("user_id", session.uid);
  if ((count ?? 0) >= 6) {
    return { ok: false, error: "一個帳號最多建立 6 位選手" };
  }

  const { error } = await db.from("players").insert({
    user_id: session.uid,
    nickname: parsed.nickname,
    birth_year: parsed.birthYear,
    avatar: parsed.avatar,
  });
  if (error) return { ok: false, error: "建立失敗，請稍後再試" };

  revalidatePath("/me");
  return { ok: true };
}

/** 編輯選手檔案（僅暱稱／出生年／頭像；戰績與信譽欄位不可改） */
export async function updatePlayer(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "請先登入" };

  const playerId = String(formData.get("player_id") ?? "");
  const parsed = parsePlayerInput(formData);
  if (parsed.error) return { ok: false, error: parsed.error };

  const db = supabaseAdmin();
  const { data: player } = await db
    .from("players")
    .select("id,user_id")
    .eq("id", playerId)
    .single<Pick<DbPlayer, "id" | "user_id">>();
  if (!player || player.user_id !== session.uid) {
    return { ok: false, error: "找不到選手或沒有權限" };
  }

  const { error } = await db
    .from("players")
    .update({
      nickname: parsed.nickname,
      birth_year: parsed.birthYear,
      avatar: parsed.avatar,
    })
    .eq("id", playerId);
  if (error) return { ok: false, error: "更新失敗，請稍後再試" };

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
