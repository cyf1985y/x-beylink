"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin";
import { DbOrganizerApplication } from "@/lib/organizer";
import { pushText } from "@/lib/push";

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
  const score = Number(formData.get("score"));
  if (!["bronze", "silver", "gold"].includes(tierAllowed)) {
    return { ok: false, error: "等級不正確" };
  }
  if (!Number.isInteger(score) || score < 0 || score > 100000) {
    return { ok: false, error: "積分需為 0 以上的整數" };
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("organizers")
    .update({ verified, tier_allowed: tierAllowed, score })
    .eq("id", organizerId);
  if (error) return { ok: false, error: "更新失敗" };
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * 核准主辦方申請：建立主辦方（銅級、未認證起跳）並標記申請已處理。
 *
 * 先建 organizers 再更新申請狀態。若中間失敗，申請會留在待審清單裡，
 * 管理員再按一次會因為「已經是主辦方」而收到明確訊息——寧可重複看到，
 * 也不要申請消失卻沒開通。
 */
export async function approveApplication(
  _prev: AdminResult,
  formData: FormData
): Promise<AdminResult> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };
  const session = await getSession();
  if (!session) return { ok: false, error: "請先登入" };

  const applicationId = String(formData.get("application_id") ?? "");
  const db = supabaseAdmin();

  const { data: app } = await db
    .from("organizer_applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle<DbOrganizerApplication>();
  if (!app) return { ok: false, error: "找不到這筆申請" };
  if (app.status !== "pending") {
    return { ok: false, error: "這筆申請已經處理過了" };
  }

  const { data: existing } = await db
    .from("organizers")
    .select("id")
    .eq("user_id", app.user_id)
    .maybeSingle();
  if (existing) {
    await db
      .from("organizer_applications")
      .update({
        status: "approved",
        reviewed_at: new Date().toISOString(),
        reviewed_by: session.uid,
      })
      .eq("id", applicationId);
    revalidatePath("/admin");
    return { ok: false, error: "這個帳號已經是主辦方了（申請已標記處理）" };
  }

  const { error: insertError } = await db.from("organizers").insert({
    user_id: app.user_id,
    name: app.shop_name,
    verified: false,
    tier_allowed: "bronze",
  });
  if (insertError) {
    console.error("核准申請時建立主辦方失敗：", { applicationId, insertError });
    return { ok: false, error: "開通失敗，請稍後再試" };
  }

  const { error: updateError } = await db
    .from("organizer_applications")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: session.uid,
    })
    .eq("id", applicationId);
  if (updateError) {
    // 主辦方已經建好了，這裡失敗只是申請還留在清單上，不該讓管理員以為沒開通
    console.error("核准申請時更新狀態失敗：", { applicationId, updateError });
  }

  const { data: applicant } = await db
    .from("users")
    .select("line_user_id")
    .eq("id", app.user_id)
    .maybeSingle<{ line_user_id: string }>();
  if (applicant) {
    await pushText(
      applicant.line_user_id,
      `🏟️ 主辦方申請通過！\n「${app.shop_name}」已開通，現在可以到「主辦」頁開辦銅級賽事了。\n辦滿 3 場後會自動解鎖銀級。`
    );
  }

  revalidatePath("/admin");
  revalidatePath("/host");
  return { ok: true };
}

/** 婉拒主辦方申請（可填原因；對方看得到，並可補資料後重新申請） */
export async function rejectApplication(
  _prev: AdminResult,
  formData: FormData
): Promise<AdminResult> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };
  const session = await getSession();
  if (!session) return { ok: false, error: "請先登入" };

  const applicationId = String(formData.get("application_id") ?? "");
  const reason = String(formData.get("reject_reason") ?? "").trim();
  if (reason.length > 100) {
    return { ok: false, error: "原因請控制在 100 字內" };
  }

  const db = supabaseAdmin();
  const { data: rows, error } = await db
    .from("organizer_applications")
    .update({
      status: "rejected",
      reject_reason: reason || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: session.uid,
    })
    .eq("id", applicationId)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: "操作失敗，請稍後再試" };
  if (!rows || rows.length === 0) {
    return { ok: false, error: "這筆申請已經處理過了" };
  }

  revalidatePath("/admin");
  return { ok: true };
}

/* --------------------------------- 天梯道館 --------------------------------- */

/**
 * 新增道館。
 *
 * 道館原本只能直接在資料庫建，沒有任何介面——「多道館系統」要能落地，
 * 至少得讓平台管理員把地址與圖片填進去。店家自助編輯留到之後的階段
 * （gyms.organizer_id 已經存在，權限模型是現成的）。
 */
export async function createGym(
  _prev: AdminResult,
  formData: FormData
): Promise<AdminResult> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };

  const fields = gymFields(formData);
  if ("error" in fields) return { ok: false, error: fields.error };

  const db = supabaseAdmin();
  const { error } = await db.from("gyms").insert(fields.values);
  if (error) return { ok: false, error: "建立失敗，請稍後再試" };

  revalidatePath("/admin");
  revalidatePath("/ladder");
  return { ok: true };
}

/** 編輯道館資料 */
export async function updateGym(
  _prev: AdminResult,
  formData: FormData
): Promise<AdminResult> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };

  const gymId = String(formData.get("gym_id") ?? "");
  if (!gymId) return { ok: false, error: "缺少道館 id" };

  const fields = gymFields(formData);
  if ("error" in fields) return { ok: false, error: fields.error };

  const db = supabaseAdmin();
  const { error } = await db
    .from("gyms")
    .update(fields.values)
    .eq("id", gymId);
  if (error) return { ok: false, error: "更新失敗，請稍後再試" };

  revalidatePath("/admin");
  revalidatePath(`/ladder/gym/${gymId}`);
  revalidatePath("/ladder");
  return { ok: true };
}

type GymValues = {
  name: string;
  address: string | null;
  logo_url: string | null;
  lat: number;
  lng: number;
  radius_m: number;
  certified: boolean;
  active: boolean;
};

/** 表單欄位驗證。qr_token 不在這裡處理——那是進場憑證，不該由表單經手 */
function gymFields(
  formData: FormData
): { values: GymValues } | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 30) {
    return { error: "道館名稱請填 2–30 字" };
  }

  const lat = Number(formData.get("lat"));
  const lng = Number(formData.get("lng"));
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { error: "緯度要在 -90 到 90 之間" };
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { error: "經度要在 -180 到 180 之間" };
  }

  const radius = Number(formData.get("radius_m"));
  if (!Number.isFinite(radius) || radius < 20 || radius > 2000) {
    return { error: "進場範圍請填 20–2000 公尺" };
  }

  const logo = String(formData.get("logo_url") ?? "").trim();
  // 只收 http(s)：javascript: 之類的協定會變成點擊即執行的破口
  if (logo && !/^https?:\/\//i.test(logo)) {
    return { error: "圖片網址請用 http:// 或 https:// 開頭" };
  }

  return {
    values: {
      name,
      address: String(formData.get("address") ?? "").trim() || null,
      logo_url: logo || null,
      lat,
      lng,
      radius_m: Math.round(radius),
      certified: formData.get("certified") === "on",
      active: formData.get("active") === "on",
    },
  };
}
