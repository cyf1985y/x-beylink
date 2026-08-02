import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import { getOrganizerForUser } from "@/lib/organizer";
import {
  DbEvent,
  DbRegistration,
  EVENT_STATUS_LABEL,
  formatTaipei,
} from "@/lib/events";
import { TierBadge, StatusChip } from "@/components/TierBadge";
import { CheckinScanner } from "@/components/CheckinScanner";
import { HostRoster, type RosterRow } from "@/components/HostRoster";

export const dynamic = "force-dynamic";

export default async function HostEventPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const db = supabaseAdmin();
  const organizer = await getOrganizerForUser(db, session.uid);
  if (!organizer) redirect("/host");

  const { data: event } = await db
    .from("events")
    .select("*")
    .eq("id", params.id)
    .single<DbEvent>();
  if (!event || event.organizer_id !== organizer.id) notFound();

  const { data: regs } = await db
    .from("registrations")
    .select("*")
    .eq("event_id", event.id)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true })
    .returns<DbRegistration[]>();

  const playerIds = (regs ?? []).map((r) => r.player_id);
  const { data: players } = playerIds.length
    ? await db
        .from("players")
        .select("id,nickname,avatar")
        .in("id", playerIds)
        .returns<Array<Pick<DbPlayer, "id" | "nickname" | "avatar">>>()
    : { data: [] as Array<Pick<DbPlayer, "id" | "nickname" | "avatar">> };
  const playerMap = new Map((players ?? []).map((p) => [p.id, p]));

  const rows: RosterRow[] = (regs ?? []).map((r) => ({
    regId: r.id,
    nickname: playerMap.get(r.player_id)?.nickname ?? "選手",
    avatar: playerMap.get(r.player_id)?.avatar ?? "🌀",
    status: r.status as "ok" | "waitlist",
    checkedInAt: r.checked_in_at,
  }));
  const okRows = rows.filter((r) => r.status === "ok");
  const waitRows = rows.filter((r) => r.status === "waitlist");
  const checkedIn = okRows.filter((r) => r.checkedInAt).length;

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link href="/host" className="text-sm text-slate-400 hover:text-slate-200">
        ← 我的賽事
      </Link>

      <div className="mt-4 rounded-2xl border border-arena-line bg-arena-card p-5">
        <div className="flex items-center justify-between gap-2">
          <TierBadge tier={event.tier} />
          <StatusChip status={event.status} label={EVENT_STATUS_LABEL[event.status]} />
        </div>
        <h1 className="mt-2 text-xl font-black">{event.title}</h1>
        <p className="mt-1 text-sm text-slate-400">
          🗓 {formatTaipei(event.starts_at)}｜📍 {event.venue}
        </p>
        <p className="mt-2 text-sm text-slate-300">
          報名 {okRows.length}/{event.capacity}｜已報到 {checkedIn}
          {waitRows.length > 0 && `｜候補 ${waitRows.length}`}
        </p>
      </div>

      <div className="mt-4">
        <CheckinScanner eventId={event.id} />
      </div>

      <section className="mt-6">
        <h2 className="font-bold text-slate-200">報名名單（{okRows.length}）</h2>
        <div className="mt-2">
          {okRows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-arena-line p-4 text-center text-sm text-slate-500">
              還沒有人報名
            </p>
          ) : (
            <HostRoster eventId={event.id} rows={okRows} />
          )}
        </div>
      </section>

      {waitRows.length > 0 && (
        <section className="mt-6">
          <h2 className="font-bold text-slate-200">候補名單（{waitRows.length}）</h2>
          <div className="mt-2">
            <HostRoster eventId={event.id} rows={waitRows} />
          </div>
        </section>
      )}
    </main>
  );
}
