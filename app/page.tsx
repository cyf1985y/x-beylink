import Link from "next/link";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { DbEvent, EVENT_STATUS_LABEL, TIERS, formatTaipei } from "@/lib/events";
import { TierBadge, StatusChip } from "@/components/TierBadge";
import { settleDueEvents } from "@/lib/settle";

export const dynamic = "force-dynamic";

async function loadEvents(): Promise<Array<DbEvent & { okCount: number }>> {
  const db = supabaseAdmin();
  await settleDueEvents(db);
  const { data: events } = await db
    .from("events")
    .select("*")
    .in("status", ["open", "confirmed"])
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .returns<DbEvent[]>();
  if (!events || events.length === 0) return [];

  const { data: regs } = await db
    .from("registrations")
    .select("event_id")
    .in(
      "event_id",
      events.map((e) => e.id)
    )
    .eq("status", "ok")
    .returns<Array<{ event_id: string }>>();

  const counts = new Map<string, number>();
  for (const r of regs ?? []) {
    counts.set(r.event_id, (counts.get(r.event_id) ?? 0) + 1);
  }
  return events.map((e) => ({ ...e, okCount: counts.get(e.id) ?? 0 }));
}

export default async function HomePage() {
  const [session, events] = await Promise.all([getSession(), loadEvents()]);

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-wide">
            🌀 陀螺<span className="text-cyanx">集結</span>
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            BEYBLADE X 比賽報名平台｜宜蘭試點
          </p>
        </div>
        {session ? (
          <Link
            href="/me"
            className="rounded-xl border border-arena-line px-3 py-2 text-sm text-cyanx hover:border-cyanx"
          >
            我的選手
          </Link>
        ) : (
          <Link
            href="/login"
            className="rounded-xl bg-[#06C755] px-3 py-2 text-sm font-bold text-white hover:brightness-110"
          >
            LINE 登入
          </Link>
        )}
      </header>

      <h2 className="mt-8 text-lg font-bold text-slate-200">🏟️ 近期賽事</h2>
      <section className="mt-3 space-y-4">
        {events.length === 0 && (
          <div className="rounded-2xl border border-dashed border-arena-line p-6 text-center text-sm text-slate-500">
            目前沒有開放中的賽事，晚點再來看看！
          </div>
        )}
        {events.map((e) => {
          const progress = Math.min(
            100,
            Math.round((e.okCount / e.min_required) * 100)
          );
          return (
            <Link
              key={e.id}
              href={`/event/${e.id}`}
              className="block rounded-2xl border border-arena-line bg-arena-card p-5 transition hover:border-cyanx/60 hover:shadow-glow"
            >
              <div className="flex items-center justify-between gap-2">
                <TierBadge tier={e.tier} />
                <StatusChip
                  status={e.status}
                  label={EVENT_STATUS_LABEL[e.status]}
                />
              </div>
              <h3 className="mt-2 text-lg font-bold">{e.title}</h3>
              <p className="mt-1 text-sm text-slate-400">
                🗓 {formatTaipei(e.starts_at)}｜📍 {e.venue}
              </p>
              <div className="mt-3">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>
                    成行進度 {e.okCount}/{e.min_required} 人
                    {e.okCount >= e.min_required && " ✅"}
                  </span>
                  <span>名額 {e.capacity}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-arena">
                  <div
                    className={`h-full rounded-full ${
                      e.okCount >= e.min_required ? "bg-emerald-400" : "bg-cyanx"
                    }`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {TIERS[e.tier].label}需滿 {e.min_required} 人才成團，未達標於{" "}
                  {formatTaipei(e.confirm_deadline)} 流局
                </p>
              </div>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
