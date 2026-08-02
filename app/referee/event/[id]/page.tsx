import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { getOrganizerForUser } from "@/lib/organizer";
import { DbEvent, EVENT_STATUS_LABEL, formatTaipei } from "@/lib/events";
import { loadBracketView } from "@/lib/bracketView";
import { TierBadge, StatusChip } from "@/components/TierBadge";
import { BracketView } from "@/components/BracketView";

export const dynamic = "force-dynamic";

/** 裁判記分頁：可記勝負／撤銷，不能產生對戰表或結算 */
export default async function RefereeScoringPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect(`/login`);

  const db = supabaseAdmin();
  const { data: event } = await db
    .from("events")
    .select("*")
    .eq("id", params.id)
    .single<DbEvent>();
  if (!event) notFound();

  // 主辦方本人或本場裁判才能進來
  const organizer = await getOrganizerForUser(db, session.uid);
  const isOwner = !!organizer && event.organizer_id === organizer.id;
  if (!isOwner) {
    const { data: referee } = await db
      .from("referees")
      .select("id")
      .eq("event_id", event.id)
      .eq("user_id", session.uid)
      .maybeSingle();
    if (!referee) notFound();
  }

  const { view } = await loadBracketView(db, event.id);
  const locked = event.status === "done";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full border border-violetx/50 bg-violetx/10 px-2.5 py-0.5 text-xs text-violetx">
          🧑‍⚖️ 裁判模式
        </span>
        <div className="flex items-center gap-2">
          <TierBadge tier={event.tier} />
          <StatusChip
            status={event.status}
            label={EVENT_STATUS_LABEL[event.status]}
          />
        </div>
      </div>

      <h1 className="mt-3 text-xl font-black">⚔️ {event.title}</h1>
      <p className="mt-1 text-sm text-slate-400">
        🗓 {formatTaipei(event.starts_at)}｜📍 {event.venue}
      </p>

      <div className="mt-5">
        {view.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-arena-line p-8 text-center text-sm text-slate-500">
            對戰表還沒產生——請等主辦方按下「產生對戰表」。
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">
              {locked
                ? "賽事已結算，勝負已鎖定。"
                : "點選手名字＝該場獲勝並晉級；點錯可按該場右上「撤銷」。"}
            </p>
            <BracketView
              eventId={event.id}
              matches={view}
              interactive={!locked}
              autoRefresh
            />
          </>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-slate-600">
        <Link href={`/event/${event.id}/bracket`} className="hover:text-slate-400">
          觀眾版對戰表 →
        </Link>
      </p>
    </main>
  );
}
