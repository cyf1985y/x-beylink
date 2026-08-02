import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { DbEvent, EVENT_STATUS_LABEL, formatTaipei } from "@/lib/events";
import { loadBracketView } from "@/lib/bracketView";
import { TierBadge, StatusChip } from "@/components/TierBadge";
import { BracketView } from "@/components/BracketView";

export const dynamic = "force-dynamic";

/** 公開觀戰頁：即時晉級圖（每 8 秒自動更新） */
export default async function PublicBracketPage({
  params,
}: {
  params: { id: string };
}) {
  const db = supabaseAdmin();
  const { data: event } = await db
    .from("events")
    .select("*")
    .eq("id", params.id)
    .single<DbEvent>();
  if (!event) notFound();

  const { view } = await loadBracketView(db, event.id);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href={`/event/${event.id}`}
        className="text-sm text-slate-400 hover:text-slate-200"
      >
        ← 賽事頁
      </Link>

      <div className="mt-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-black">⚔️ 對戰表｜{event.title}</h1>
        <div className="flex items-center gap-2">
          <TierBadge tier={event.tier} />
          <StatusChip
            status={event.status}
            label={EVENT_STATUS_LABEL[event.status]}
          />
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        🗓 {formatTaipei(event.starts_at)}｜畫面每 8 秒自動更新
      </p>

      <div className="mt-5">
        {view.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-arena-line p-8 text-center text-sm text-slate-500">
            對戰表還沒公布——報到截止後由主辦方產生，敬請期待！
          </div>
        ) : (
          <BracketView
            eventId={event.id}
            matches={view}
            interactive={false}
            autoRefresh
          />
        )}
      </div>
    </main>
  );
}
