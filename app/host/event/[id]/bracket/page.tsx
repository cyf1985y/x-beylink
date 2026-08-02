import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { getOrganizerForUser } from "@/lib/organizer";
import { DbEvent, EVENT_STATUS_LABEL, formatTaipei } from "@/lib/events";
import { bracketComplete } from "@/lib/bracket";
import { loadBracketView } from "@/lib/bracketView";
import { TierBadge, StatusChip } from "@/components/TierBadge";
import {
  BracketView,
  GenerateBracketButton,
  SettleFromBracketButton,
} from "@/components/BracketView";

export const dynamic = "force-dynamic";

export default async function HostBracketPage({
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

  const { matches, view } = await loadBracketView(db, event.id);
  const complete = matches.length > 0 && bracketComplete(matches);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href={`/host/event/${event.id}`}
        className="text-sm text-slate-400 hover:text-slate-200"
      >
        ← 賽事管理
      </Link>

      <div className="mt-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-black">⚔️ 對戰表｜{event.title}</h1>
          <p className="mt-1 text-sm text-slate-400">
            🗓 {formatTaipei(event.starts_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TierBadge tier={event.tier} />
          <StatusChip
            status={event.status}
            label={EVENT_STATUS_LABEL[event.status]}
          />
        </div>
      </div>

      <div className="mt-5">
        {view.length === 0 ? (
          <div className="rounded-2xl border border-arena-line bg-arena-card p-5">
            <p className="mb-3 text-sm text-slate-400">
              還沒有對戰表。報到完成後按下面的按鈕，系統會把「已報到」的選手隨機配對成單淘汰賽程（含季軍戰，人數不是
              2 的次方時自動輪空）。
            </p>
            <GenerateBracketButton eventId={event.id} />
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">
              點選手名字＝該場獲勝並晉級；點錯可按該場右上「撤銷」。玩家可在賽事頁看到即時晉級圖。
            </p>
            <BracketView eventId={event.id} matches={view} interactive />
            {complete && event.status !== "done" && (
              <SettleFromBracketButton eventId={event.id} />
            )}
            {event.status === "done" && (
              <p className="mt-4 rounded-lg border border-emerald-400/50 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">
                ✅ 本場已結算，獎盃見
                <Link href={`/host/event/${event.id}`} className="underline">
                  賽事管理頁
                </Link>
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
