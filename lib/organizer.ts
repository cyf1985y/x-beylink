import { SupabaseClient } from "@supabase/supabase-js";
import { Tier } from "@/lib/events";

export type DbOrganizer = {
  id: string;
  user_id: string;
  name: string;
  verified: boolean;
  events_held: number;
  score: number;
  tier_allowed: "bronze" | "silver" | "gold";
  created_at: string;
};

/** 未認證主辦方辦滿幾場（結算完成）解鎖銀級 */
export const SILVER_UNLOCK_EVENTS = 3;

/** 各等級結算完成的主辦方積分 */
export const TIER_SCORE: Record<Tier, number> = {
  bronze: 1,
  silver: 3,
  gold: 8,
};

/**
 * 主辦方實際可開的最高等級（業務規則）：
 * - 已認證：依平台核定的 tier_allowed（可到金級）
 * - 未認證：銅級起步；辦滿 SILVER_UNLOCK_EVENTS 場解鎖銀級；金級一律需認證
 */
export function effectiveTierAllowed(o: DbOrganizer): Tier {
  if (o.verified) return o.tier_allowed;
  return o.events_held >= SILVER_UNLOCK_EVENTS ? "silver" : "bronze";
}

/** 取得目前登入者的主辦方身分（沒有則回 null） */
export async function getOrganizerForUser(
  db: SupabaseClient,
  uid: string
): Promise<DbOrganizer | null> {
  const { data } = await db
    .from("organizers")
    .select("*")
    .eq("user_id", uid)
    .maybeSingle<DbOrganizer>();
  return data ?? null;
}
