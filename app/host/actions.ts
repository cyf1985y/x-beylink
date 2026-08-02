"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { getOrganizerForUser, DbOrganizer } from "@/lib/organizer";
import {
  DbEvent,
  DbRegistration,
  TIERS,
  isTier,
  bannedUntilFor,
} from "@/lib/events";
import { pushToPlayers } from "@/lib/push";

const RANK_TEXT: Record<number, string> = {
  1: "冠軍 🥇",
  2: "亞軍 🥈",
  3: "季軍 🥉",
  4: "殿軍 🎖️",
  8: "八強 🎗️",
};

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

/* ---------- M4：開賽 ---------- */

export type FormResult = { ok: boolean; error?: string };

const TIER_ORDER = { bronze: 0, silver: 1, gold: 2 } as const;

async function requireOrganizer(): Promise<
  { error: string; organizer?: undefined } | { error?: undefined; organizer: DbOrganizer }
> {
  const session = await getSession();
  if (!session) return { error: "請先登入" };
  const organizer = await getOrganizerForUser(supabaseAdmin(), session.uid);
  if (!organizer) return { error: "你不是主辦方" };
  return { organizer };
}

/** 開賽：等級不可超過 tier_allowed；成團門檻由等級決定（後端寫死）；判定時間自動計算 */
export async function createEvent(
  _prev: FormResult,
  formData: FormData
): Promise<FormResult> {
  const auth = await requireOrganizer();
  if (auth.error || !auth.organizer) {
    return { ok: false, error: auth.error ?? "你不是主辦方" };
  }
  const organizer = auth.organizer;

  const title = String(formData.get("title") ?? "").trim();
  const tier = String(formData.get("tier") ?? "");
  const startsAtRaw = String(formData.get("starts_at") ?? "");
  const venue = String(formData.get("venue") ?? "").trim();
  const region = String(formData.get("region") ?? "宜蘭").trim();
  const division = String(formData.get("division") ?? "通常組");
  const capacity = Number(formData.get("capacity"));
  const rulesNote = String(formData.get("rules_note") ?? "").trim();

  if (title.length < 2 || title.length > 40) {
    return { ok: false, error: "賽事名稱請填 2–40 字" };
  }
  if (!isTier(tier)) return { ok: false, error: "等級不正確" };
  if (TIER_ORDER[tier] > TIER_ORDER[organizer.tier_allowed]) {
    return {
      ok: false,
      error: `你目前可開的最高等級是${TIERS[organizer.tier_allowed].label}`,
    };
  }
  const minRequired = TIERS[tier].minRequired;

  // datetime-local 送來的是台灣當地時間（無時區），轉為 UTC 儲存
  const startsAt = new Date(`${startsAtRaw}:00+08:00`);
  if (isNaN(startsAt.getTime())) return { ok: false, error: "開賽時間格式不正確" };
  if (startsAt.getTime() < Date.now() + 3600_000) {
    return { ok: false, error: "開賽時間至少要在 1 小時之後" };
  }
  if (!venue) return { ok: false, error: "請填場地" };
  if (!["通常組", "公開組", "親子組"].includes(division)) {
    return { ok: false, error: "組別不正確" };
  }
  if (!Number.isInteger(capacity) || capacity < minRequired || capacity > 128) {
    return {
      ok: false,
      error: `名額需為 ${minRequired}（成團門檻）到 128 之間的整數`,
    };
  }

  // 成行判定時間：開賽前 24 小時；若開賽在 26 小時內，改為開賽前 2 小時
  const dayBefore = startsAt.getTime() - 24 * 3600_000;
  const confirmDeadline = new Date(
    dayBefore > Date.now() + 2 * 3600_000
      ? dayBefore
      : startsAt.getTime() - 2 * 3600_000
  );

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("events")
    .insert({
      organizer_id: organizer.id,
      title,
      tier,
      starts_at: startsAt.toISOString(),
      venue,
      region: region || "宜蘭",
      division,
      capacity,
      min_required: minRequired,
      confirm_deadline: confirmDeadline.toISOString(),
      rules_note: rulesNote || null,
      status: "open",
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return { ok: false, error: "建立賽事失敗，請稍後再試" };

  revalidatePath("/");
  revalidatePath("/host");
  redirect(`/host/event/${data.id}`);
}

/* ---------- M4：結算發獎盃 ---------- */

/**
 * 結算：寫名次 → 發獎盃（等級跟隨賽事）→ 未報到者記 1 點 → 更新出席數 → 賽事結束。
 * 僅該賽事主辦方可執行（業務規則：獎盃只能由該賽事主辦方發放）。
 */
export async function settleEvent(
  _prev: FormResult,
  formData: FormData
): Promise<FormResult> {
  const eventId = String(formData.get("event_id") ?? "");
  const owner = await requireEventOwner(eventId);
  if (owner.error || !owner.event) return { ok: false, error: owner.error };
  const event = owner.event;

  if (event.status === "done") return { ok: false, error: "此賽事已結算過了" };
  if (event.status !== "open" && event.status !== "confirmed") {
    return { ok: false, error: "流局或已取消的賽事不能結算" };
  }

  const db = supabaseAdmin();
  const { data: regs } = await db
    .from("registrations")
    .select("*")
    .eq("event_id", eventId)
    .eq("status", "ok")
    .returns<DbRegistration[]>();
  const okRegs = regs ?? [];
  const checkedIn = okRegs.filter((r) => r.checked_in_at);
  if (checkedIn.length === 0) {
    return { ok: false, error: "還沒有任何選手報到，無法結算" };
  }

  // 讀名次：rank_<regId> ∈ {1,2,3,4,8}；1–4 不可重複；上榜者必須已報到
  const ranks = new Map<string, number>(); // regId -> rank
  const usedTop = new Set<number>();
  for (const reg of okRegs) {
    const v = String(formData.get(`rank_${reg.id}`) ?? "");
    if (!v) continue;
    const rank = Number(v);
    if (![1, 2, 3, 4, 8].includes(rank)) {
      return { ok: false, error: "名次只能是 1、2、3、4 或八強" };
    }
    if (!reg.checked_in_at) {
      return { ok: false, error: "未報到的選手不能列入名次" };
    }
    if (rank <= 4) {
      if (usedTop.has(rank)) {
        return { ok: false, error: `第 ${rank} 名重複了，請檢查` };
      }
      usedTop.add(rank);
    }
    ranks.set(reg.id, rank);
  }
  if (!usedTop.has(1)) return { ok: false, error: "至少要選出冠軍（第 1 名）" };

  // 寫入名次與獎盃（＋推播獎盃通知）
  for (const reg of okRegs) {
    const rank = ranks.get(reg.id);
    if (!rank) continue;
    await db.from("results").upsert(
      { event_id: eventId, player_id: reg.player_id, final_rank: rank },
      { onConflict: "event_id,player_id" }
    );
    await db.from("trophies").insert({
      player_id: reg.player_id,
      event_id: eventId,
      tier: event.tier,
      rank,
      issued_by: event.organizer_id,
    });
    await pushToPlayers(
      db,
      [reg.player_id],
      `🏆 恭喜！你的選手在【${event.title}】拿下${TIERS[event.tier].label}${RANK_TEXT[rank] ?? `第 ${rank} 名`}！\n獎盃已放進選手卡的獎盃牆。`
    );
  }

  // 出席數與缺席記點：ok 名單全員 total+1；已報到 ok+1；未報到記 1 點並檢查停權
  for (const reg of okRegs) {
    const { data: player } = await db
      .from("players")
      .select("*")
      .eq("id", reg.player_id)
      .single();
    if (!player) continue;
    const update: Record<string, unknown> = {
      attendance_total: (player.attendance_total ?? 0) + 1,
    };
    if (reg.checked_in_at) {
      update.attendance_ok = (player.attendance_ok ?? 0) + 1;
    } else {
      const newPoints = Number(player.penalty_points ?? 0) + 1;
      update.penalty_points = newPoints;
      const ban = bannedUntilFor(newPoints);
      if (ban) update.banned_until = ban;
    }
    await db.from("players").update(update).eq("id", reg.player_id);
  }

  await db.from("events").update({ status: "done" }).eq("id", eventId);

  // 主辦方辦賽場次 +1
  const { data: org } = await db
    .from("organizers")
    .select("events_held")
    .eq("id", event.organizer_id)
    .single<{ events_held: number }>();
  await db
    .from("organizers")
    .update({ events_held: (org?.events_held ?? 0) + 1 })
    .eq("id", event.organizer_id);

  revalidatePath(`/host/event/${eventId}`);
  revalidatePath("/");
  return { ok: true };
}

/** 撤回獎盃（誤發 48 小時內可撤回，僅發放的主辦方） */
export async function revokeTrophy(
  _prev: FormResult,
  formData: FormData
): Promise<FormResult> {
  const trophyId = String(formData.get("trophy_id") ?? "");
  const auth = await requireOrganizer();
  if (auth.error || !auth.organizer) {
    return { ok: false, error: auth.error ?? "你不是主辦方" };
  }
  const organizer = auth.organizer;

  const db = supabaseAdmin();
  const { data: trophy } = await db
    .from("trophies")
    .select("*")
    .eq("id", trophyId)
    .single<{
      id: string;
      issued_by: string;
      issued_at: string;
      revoked_at: string | null;
      event_id: string;
    }>();
  if (!trophy || trophy.issued_by !== organizer.id) {
    return { ok: false, error: "找不到獎盃或沒有權限" };
  }
  if (trophy.revoked_at) return { ok: false, error: "此獎盃已撤回過了" };
  if (Date.now() - new Date(trophy.issued_at).getTime() > 48 * 3600_000) {
    return { ok: false, error: "已超過 48 小時，無法撤回" };
  }
  await db
    .from("trophies")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", trophyId);
  revalidatePath(`/host/event/${trophy.event_id}`);
  return { ok: true };
}
