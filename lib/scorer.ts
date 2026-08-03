import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { getOrganizerForUser } from "@/lib/organizer";
import { DbEvent } from "@/lib/events";

/**
 * 記分權限：該賽事主辦方，或掃碼加入的裁判。
 * 裁判只能記分；產生對戰表、結算發獎仍限主辦方本人。
 */
export async function requireScorer(
  eventId: string
): Promise<{ error?: string; event?: DbEvent; isOwner?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "請先登入" };
  const db = supabaseAdmin();
  const { data: event } = await db
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single<DbEvent>();
  if (!event) return { error: "找不到賽事" };

  const organizer = await getOrganizerForUser(db, session.uid);
  if (organizer && event.organizer_id === organizer.id) {
    return { event, isOwner: true };
  }

  const { data: referee } = await db
    .from("referees")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", session.uid)
    .maybeSingle();
  if (referee) return { event, isOwner: false };
  return { error: "沒有記分權限（請向主辦方索取裁判邀請碼）" };
}
