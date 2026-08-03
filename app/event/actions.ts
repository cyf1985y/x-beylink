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

/** 報名 RPC 的錯誤碼對應訊息 */
const REGISTER_ERROR_MESSAGES: Record<string, string> = {
  event_not_found: "找不到賽事",
  event_closed: "此賽事目前不開放報名",
  registration_closed: `報名已截止（開賽前 ${REGISTRATION_CLOSE_HOURS} 小時），對戰表已抽出`,
  bracket_drawn: "對戰表已經抽出，本場報名已關閉",
  already_registered: "這位選手已經報名了",
};

/**
 * 報名：名額內 ok，滿了進候補；停權中不可報名。
 *
 * 名額判定與寫入交給資料庫函式 `register_player_atomic`——它會對 event 那一列
 * 下 FOR UPDATE 鎖，在同一個交易內完成「判斷名額 → 寫入」，避免兩人同時報名
 * 時雙方都讀到同一個數字而超賣。賽事狀態、報名截止、對戰表已抽出、重複報名
 * 等檢查也都在函式內完成，這裡只保留資料庫看不到 session 的兩項：
 * 選手擁有權與停權狀態。
 */
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
  const { data, error } = await db
    .rpc("register_player_atomic", {
      p_event_id: eventId,
      p_player_id: playerId,
    })
    .single<{
      ok: boolean;
      reg_status: string | null;
      error_code: string | null;
    }>();

  if (error || !data) {
    console.error("register_player_atomic 呼叫失敗：", {
      eventId,
      playerId,
      error,
    });
    return { ok: false, error: "報名失敗，請稍後再試" };
  }

  if (!data.ok) {
    return {
      ok: false,
      error:
        REGISTER_ERROR_MESSAGES[data.error_code ?? ""] ??
        "報名失敗，請稍後再試",
    };
  }

  revalidatePath(`/event/${eventId}`);
  revalidatePath("/");
  return {
    ok: true,
    message:
      data.reg_status === "ok"
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

  // 併發保護：只有在狀態仍與我們讀到的一致時才寫入。連點兩下時只有第一個
  // 請求會影響到資料列，第二個拿到 0 筆而提早返回，避免重複記點與重複遞補。
  // 用 .eq("status", reg.status) 而非 .neq("cancelled")，是為了確保底下的
  // wasOk 判斷成立——若這筆在我們讀取後剛好被遞補（waitlist→ok），
  // 這次更新會落空並要求使用者重新確認，而不是靜靜地漏掉一次遞補。
  const wasOk = reg.status === "ok";
  const { data: cancelledRows, error } = await db
    .from("registrations")
    .update({ status: "cancelled" })
    .eq("id", regId)
    .eq("status", reg.status)
    .select("id");
  if (error) {
    console.error("取消報名寫入失敗：", { regId, error });
    return { ok: false, error: "取消失敗，請稍後再試" };
  }
  if (!cancelledRows || cancelledRows.length === 0) {
    return {
      ok: false,
      error: "這筆報名剛剛已有異動（可能已取消或已遞補），請重新整理後再確認",
    };
  }

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

  // 自動遞補：交給 promote_next_waitlist（鎖 event 列，且只在確實空出名額時
  // 才遞補），避免兩筆同時取消只遞補到一人、名額白白空掉。
  if (wasOk) {
    const { data: promotedPlayerId, error: promoteError } = await db.rpc(
      "promote_next_waitlist",
      { p_event_id: reg.event_id }
    );

    // 取消已經寫入，這裡失敗不該讓使用者的取消失敗——但要留下線索，
    // 否則名額會空著、候補第一位永遠不會被遞補也不會收到通知。
    if (promoteError) {
      console.error("候補遞補失敗（名額可能空置）：", {
        eventId: reg.event_id,
        regId,
        error: promoteError,
      });
    }

    if (promotedPlayerId) {
      await pushToPlayers(
        db,
        [promotedPlayerId as string],
        `🎊 候補遞補成功！你的選手已正式報上【${event.title}】\n🗓 ${formatTaipei(event.starts_at)}\n📍 ${event.venue}\n請到賽事頁查看報到 QR Code。`
      );
    }
  }

  revalidatePath(`/event/${reg.event_id}`);
  revalidatePath("/");
  return { ok: true, message: `已取消報名${penaltyNote}` };
}
