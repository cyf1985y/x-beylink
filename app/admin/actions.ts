"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin";

export type AdminResult = { ok: boolean; error?: string };

async function requireAdmin(): Promise<string | null> {
  const session = await getSession();
  if (!(await isAdmin(session))) return "沒有管理權限";
  return null;
}

/** 開通主辦方：把某個使用者升級為主辦方（銅級、未認證起跳） */
export async function createOrganizer(
  _prev: AdminResult,
  formData: FormData
): Promise<AdminResult> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };

  const userId = String(formData.get("user_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 30) {
    return { ok: false, error: "主辦方名稱請填 2–30 字" };
  }

  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("organizers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return { ok: false, error: "這個帳號已經是主辦方了" };

  const { error } = await db.from("organizers").insert({
    user_id: userId,
    name,
    verified: false,
    tier_allowed: "bronze",
  });
  if (error) return { ok: false, error: "開通失敗，請稍後再試" };
  revalidatePath("/admin");
  return { ok: true };
}

/** 更新主辦方：認證狀態與可開等級（賽事等級由平台核定的業務規則入口） */
export async function updateOrganizer(
  _prev: AdminResult,
  formData: FormData
): Promise<AdminResult> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };

  const organizerId = String(formData.get("organizer_id") ?? "");
  const verified = formData.get("verified") === "on";
  const tierAllowed = String(formData.get("tier_allowed") ?? "bronze");
  if (!["bronze", "silver", "gold"].includes(tierAllowed)) {
    return { ok: false, error: "等級不正確" };
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("organizers")
    .update({ verified, tier_allowed: tierAllowed })
    .eq("id", organizerId);
  if (error) return { ok: false, error: "更新失敗" };
  revalidatePath("/admin");
  return { ok: true };
}
