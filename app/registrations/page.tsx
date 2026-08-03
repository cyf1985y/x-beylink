import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import {
  DbEvent,
  DbRegistration,
  EVENT_STATUS_LABEL,
  formatTaipei,
} from "@/lib/events";
import { TierBadge, StatusChip } from "@/components/TierBadge";

export const dynamic = "force-dynamic";

/** 已報名賽事：自己選手的所有有效報名 */
export default async function RegistrationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const db = supabaseAdmin();
  const { data: players } = await db
    .from("players")
    .select("id,nickname,avatar")
    .eq("user_id", session.uid)
    .returns<Array<Pick<DbPlayer, "id" | "nickname" | "avatar">>>();
  const playerMap = new Map((players ?? []).map((p) => [p.id, p]));
  const playerIds = [...playerMap.keys()];

  const { data: regs } = playerIds.length
    ? await db
        .from("registrations")
        .select("*")
        .in("player_id", playerIds)
        .neq("status", "cancelled")
        .returns<DbRegistration[]>()
    : { data: [] as DbRegistration[] };

  const eventIds = Array.from(new Set((regs ?? []).map((r) => r.event_id)));
  const { data: events } = eventIds.length
    ? await db
        .from("events")
        .select("*")
        .in("id", eventIds)
        .order("starts_at", { ascending: true })
        .returns<DbEvent[]>()
    : { data: [] as DbEvent[] };

  const rows = (events ?? []).flatMap((e) =>
    (regs ?? [])
      .filter((r) => r.event_id === e.id)
      .map((r) => ({ event: e, reg: r }))
  );

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
        ← 首頁
      </Link>
      <h1 className="h-x mt-4 text-2xl">已報名賽事</h1>

      <div className="mt-4 space-y-3">
        {rows.length === 0 && (
          <div className="card-x p-6 text-center text-sm text-slate-500">
            目前沒有報名中的賽事——
            <Link href="/#events" className="text-cyanx underline">
              去看看近期賽事
            </Link>
            ！
          </div>
        )}
        {rows.map(({ event, reg }) => {
          const p = playerMap.get(reg.player_id);
          return (
            <div key={reg.id} className="card-x p-4">
              <div className="flex items-center justify-between gap-2">
                <TierBadge tier={event.tier} />
                <StatusChip
                  status={event.status}
                  label={EVENT_STATUS_LABEL[event.status]}
                />
              </div>
              <Link
                href={`/event/${event.id}`}
                className="mt-2 block font-black hover:text-cyanx"
              >
                {event.title}
              </Link>
              <p className="mt-1 text-sm text-slate-400">
                🗓 {formatTaipei(event.starts_at)}｜📍 {event.venue}
              </p>
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-arena-line bg-arena px-3 py-2">
                <span className="text-xl">{p?.avatar ?? "🌀"}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold">
                  {p?.nickname ?? "選手"}
                </span>
                {reg.status === "waitlist" ? (
                  <span className="text-xs text-gold">⏳ 候補中</span>
                ) : reg.checked_in_at ? (
                  <span className="text-xs text-emerald-300">✅ 已報到</span>
                ) : (
                  <Link
                    href={`/ticket/${reg.id}`}
                    className="rounded-lg border border-cyanx/50 px-3 py-1 text-xs font-bold text-cyanx hover:bg-cyanx/10"
                  >
                    報到憑證
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
