import { SupabaseClient } from "@supabase/supabase-js";

export type DbOrganizer = {
  id: string;
  user_id: string;
  name: string;
  verified: boolean;
  events_held: number;
  tier_allowed: "bronze" | "silver" | "gold";
  created_at: string;
};

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
