"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { DbEvent } from "@/lib/events";

export type JoinResult = { ok: boolean; error?: string };

/** 掃主辦方的邀請碼成為本場裁判（獲得記分權，不含結算權） */
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
  const { data: event } = await db
    .from("events")
    .select("*")
    .eq("referee_code", code)
    .maybeSingle<DbEvent>();
  if (!event) return { ok: false, error: "邀請碼無效" };
  if (event.status === "done" || event.status === "cancelled" || event.status === "void") {
    return { ok: false, error: "此賽事已結束，不需要裁判了" };
  }

  await db
    .from("referees")
    .upsert(
      { event_id: event.id, user_id: session.uid },
      { onConflict: "event_id,user_id", ignoreDuplicates: true }
    );

  redirect(`/referee/event/${event.id}`);
}
