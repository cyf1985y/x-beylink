"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { getOrganizerForUser } from "@/lib/organizer";
import { DbEvent, DbRegistration } from "@/lib/events";

export type CheckinResult = {
  ok: boolean;
  error?: string;
  nickname?: string;
  already?: boolean;
};

async function requireEventOwner(
  eventId: string
): Promise<{ error?: string; event?: DbEvent }> {
  const session = await getSession();
  if (!session) return { error: "請先登入" };
  const db = supabaseAdmin();
  const organizer = await getOrganizerForUser(db, session.uid);
  if (!organizer) return { error: "你不是主辦方" };
  const { data: event } = await db
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single<DbEvent>();
  if (!event || event.organizer_id !== organizer.id) {
    return { error: "找不到賽事或沒有權限" };
  }
  return { event };
}

async function doCheckin(reg: DbRegistration): Promise<CheckinResult> {
  const db = supabaseAdmin();
  const { data: player } = await db
    .from("players")
    .select("nickname")
    .eq("id", reg.player_id)
    .single<{ nickname: string }>();
  const nickname = player?.nickname ?? "選手";

  if (reg.checked_in_at) {
    return { ok: true, already: true, nickname };
  }
  const { error } = await db
    .from("registrations")
    .update({ checked_in_at: new Date().toISOString() })
    .eq("id", reg.id);
  if (error) return { ok: false, error: "報到寫入失敗，請重試" };
  return { ok: true, nickname };
}

/** 掃碼報到：驗證 qr_token 屬於本賽事的有效報名 */
export async function checkinByToken(
  eventId: string,
  rawToken: string
): Promise<CheckinResult> {
  const owner = await requireEventOwner(eventId);
  if (owner.error) return { ok: false, error: owner.error };

  const token = rawToken.replace(/^xb-checkin:/, "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return { ok: false, error: "這不是本平台的報到 QR Code" };
  }

  const db = supabaseAdmin();
  const { data: reg } = await db
    .from("registrations")
    .select("*")
    .eq("qr_token", token)
    .eq("event_id", eventId)
    .maybeSingle<DbRegistration>();
  if (!reg) return { ok: false, error: "查無此報名（可能是別場賽事的憑證）" };
  if (reg.status === "cancelled") return { ok: false, error: "此報名已取消" };
  if (reg.status === "waitlist") {
    return { ok: false, error: "此選手在候補名單，尚未遞補成功" };
  }

  const result = await doCheckin(reg);
  revalidatePath(`/host/event/${eventId}`);
  return result;
}

/** 手動報到（相機不能用時的備援），一樣限本賽事主辦方 */
export async function checkinByRegistrationId(
  eventId: string,
  regId: string
): Promise<CheckinResult> {
  const owner = await requireEventOwner(eventId);
  if (owner.error) return { ok: false, error: owner.error };

  const db = supabaseAdmin();
  const { data: reg } = await db
    .from("registrations")
    .select("*")
    .eq("id", regId)
    .eq("event_id", eventId)
    .maybeSingle<DbRegistration>();
  if (!reg || reg.status !== "ok") {
    return { ok: false, error: "找不到有效報名" };
  }

  const result = await doCheckin(reg);
  revalidatePath(`/host/event/${eventId}`);
  return result;
}
