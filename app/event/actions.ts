"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import {
  DbEvent,
  DbRegistration,
  FREE_CANCEL_HOURS,
  REGISTRATION_CLOSE_HOURS,
  bannedUntilFor,
  formatTaipei,
  isPlayerBanned,
  isRegistrationClosed,
  registrationDeadlineOf,
} from "@/lib/events";
import { pushToPlayers } from "@/lib/push";

export type ActionResult = { ok: boolean; error?: string; message?: string };

async function loadOwnedPlayer(
  playerId: string,
  uid: string
): Promise<DbPlayer | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("players")
    .select("*")
    .eq("id", playerId)
    .single<DbPlayer>();
  if (!data || data.user_id !== uid) return null;
  return data;
}

/** 報名：名額內 ok，滿了進候補；停權中不可報名 */
export async function registerPlayer(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "請先登入" };

  const eventId = String(formData.get("event_id") ?? "");
  const playerId = String(formData.get("player_id") ?? "");

  const player = await loadOwnedPlayer(playerId, session.uid);
  if (!player) return { ok: false, error: "找不到選手或沒有權限" };
  if (isPlayerBanned(player)) {
    return { ok: false, error: "此選手停權中，暫時無法報名" };
  }

  const db = supabaseAdmin();
  const { data: event } = await db
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single<DbEvent>();
  if (!event) return { ok: false, error: "找不到賽事" };
  if (event.status !== "open" && event.status !== "confirmed") {
    return { ok: false, error: "此賽事目前不開放報名" };
  }
  if (isRegistrationClosed(event)) {
    return {
      ok: false,
      error: `報名已於 ${formatTaipei(registrationDeadlineOf(event).toISOString())} 截止（開賽前 ${REGISTRATION_CLOSE_HOURS} 小時），對戰表已抽出`,
    };
  }

  // 既有報名紀錄（unique(event_id, player_id)）
  const { data: existing } = await db
    .from("registrations")
    .select("*")
    .eq("event_id", eventId)
    .eq("player_id", playerId)
    .maybeSingle<DbRegistration>();
  if (existing && existing.status !== "cancelled") {
    return { ok: false, error: "這位選手已經報名了" };
  }

  const { count: okCount } = await db
    .from("registrations")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("status", "ok");
  const newStatus = (okCount ?? 0) < event.capacity ? "ok" : "waitlist";

  if (existing) {
    const { error } = await db
      .from("registrations")
      .update({ status: newStatus })
      .eq("id", existing.id);
    if (error) return { ok: false, error: "報名失敗，請稍後再試" };
  } else {
    const { error } = await db.from("registrations").insert({
      event_id: eventId,
      player_id: playerId,
      status: newStatus,
    });
    if (error) return { ok: false, error: "報名失敗，請稍後再試" };
  }

  revalidatePath(`/event/${eventId}`);
  revalidatePath("/");
  return {
    ok: true,
    message:
      newStatus === "ok"
        ? "報名成功！"
        : "名額已滿，已排入候補——有人取消會自動遞補。",
  };
}

/** 取消報名：賽前 72 小時內取消記 0.5 點；取消後自動遞補候補第一位 */
export async function cancelRegistration(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "請先登入" };

  const regId = String(formData.get("registration_id") ?? "");
  const db = supabaseAdmin();

  const { data: reg } = await db
    .from("registrations")
    .select("*")
    .eq("id", regId)
    .single<DbRegistration>();
  if (!reg || reg.status === "cancelled") {
    return { ok: false, error: "找不到報名紀錄" };
  }

  const player = await loadOwnedPlayer(reg.player_id, session.uid);
  if (!player) return { ok: false, error: "沒有權限取消這筆報名" };

  const { data: event } = await db
    .from("events")
    .select("*")
    .eq("id", reg.event_id)
    .single<DbEvent>();
  if (!event) return { ok: false, error: "找不到賽事" };
  if (isRegistrationClosed(event)) {
    return {
      ok: false,
      error: "報名已截止、對戰表已抽出，無法自行取消——請直接聯絡主辦方",
    };
  }

  const wasOk = reg.status === "ok";
  const { error } = await db
    .from("registrations")
    .update({ status: "cancelled" })
    .eq("id", regId);
  if (error) return { ok: false, error: "取消失敗，請稍後再試" };

  // 賽前 72 小時內取消 → 記 0.5 點（賽事仍為有效狀態時才記）
  let penaltyNote = "";
  const hoursToStart =
    (new Date(event.starts_at).getTime() - Date.now()) / 3600_000;
  const eventActive = event.status === "open" || event.status === "confirmed";
  if (eventActive && hoursToStart < FREE_CANCEL_HOURS) {
    const newPoints = Number(player.penalty_points) + 0.5;
    await db
      .from("players")
      .update({
        penalty_points: newPoints,
        banned_until: bannedUntilFor(newPoints) ?? player.banned_until,
      })
      .eq("id", player.id);
    penaltyNote = `（距開賽不到 ${FREE_CANCEL_HOURS} 小時，已記 0.5 點信譽點數）`;
  }

  // 自動遞補：候補最早的一位轉正取，並推播通知
  if (wasOk) {
    const { data: next } = await db
      .from("registrations")
      .select("id,player_id")
      .eq("event_id", reg.event_id)
      .eq("status", "waitlist")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<{ id: string; player_id: string }>();
    if (next) {
      await db.from("registrations").update({ status: "ok" }).eq("id", next.id);
      await pushToPlayers(
        db,
        [next.player_id],
        `🎊 候補遞補成功！你的選手已正式報上【${event.title}】\n🗓 ${formatTaipei(event.starts_at)}\n📍 ${event.venue}\n請到賽事頁查看報到 QR Code。`
      );
    }
  }

  revalidatePath(`/event/${reg.event_id}`);
  revalidatePath("/");
  return { ok: true, message: `已取消報名${penaltyNote}` };
}
