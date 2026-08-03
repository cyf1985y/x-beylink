import Link from "next/link";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { DbEvent, EVENT_STATUS_LABEL, TIERS, formatTaipei } from "@/lib/events";
import { TierBadge, StatusChip } from "@/components/TierBadge";
import { LogoMark } from "@/components/Brand";
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
    <main className="mx-auto max-w-md px-4 pb-8">
      {/* Hero */}
      <section className="relative pt-10 text-center">
        <div className="mx-auto w-fit animate-floaty">
          <LogoMark size={96} />
        </div>
        <h1 className="mt-4 text-4xl font-black italic tracking-wide">
          陀螺<span className="text-gradient text-glow">集結</span>
        </h1>
        <p className="mt-1 font-num text-sm tracking-[0.35em] text-slate-500">
          X-BEYLINK
        </p>
        <p className="mt-3 text-sm text-slate-300">
          揪團開打・QR 報到・即時對戰表・數位獎盃
        </p>
        {!session && (
          <Link
            href="/login"
            className="btn-x mt-6 bg-[#06C755] !bg-none px-10 text-white shadow-glow"
          >
            LINE 登入，加入戰局
          </Link>
        )}
        {session && (
          <Link href="/me" className="btn-x mt-6 px-10">
            我的選手檔案 →
          </Link>
        )}
      </section>

      {/* 賽事列表 */}
      <section className="mt-12">
        <h2 className="h-x">近期賽事</h2>
        <div className="mt-4 space-y-4">
          {events.length === 0 && (
            <div className="card-x p-6 text-center text-sm text-slate-500">
              目前沒有開放中的賽事，晚點再來看看！
            </div>
          )}
          {events.map((e) => {
            const progress = Math.min(
              100,
              Math.round((e.okCount / e.min_required) * 100)
            );
            const reached = e.okCount >= e.min_required;
            return (
              <Link
                key={e.id}
                href={`/event/${e.id}`}
                className="card-x block p-5 transition hover:-translate-y-0.5 hover:border-cyanx/60 hover:shadow-glow-strong"
              >
                <div className="flex items-center justify-between gap-2">
                  <TierBadge tier={e.tier} />
                  <StatusChip
                    status={e.status}
                    label={EVENT_STATUS_LABEL[e.status]}
                  />
                </div>
                <h3 className="mt-2.5 text-xl font-black">{e.title}</h3>
                <p className="mt-1.5 text-sm text-slate-400">
                  🗓 {formatTaipei(e.starts_at)}｜📍 {e.venue}
                </p>
                <div className="mt-4">
                  <div className="flex items-end justify-between text-xs text-slate-400">
                    <span className="font-num text-base font-bold text-slate-200">
                      {e.okCount}
                      <span className="text-xs text-slate-500">
                        /{e.min_required} 人成團
                      </span>
                      {reached && <span className="ml-1 text-cyanx">達標！</span>}
                    </span>
                    <span>名額 {e.capacity}</span>
                  </div>
                  <div className="mt-1.5 h-2.5 -skew-x-12 overflow-hidden rounded-sm bg-arena">
                    <div
                      className={`h-full bg-stripes bg-[length:34px_34px] ${
                        reached
                          ? "animate-stripes bg-emerald-400"
                          : "bg-cyanx"
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {TIERS[e.tier].label}需滿 {e.min_required} 人，未達標於{" "}
                    {formatTaipei(e.confirm_deadline)} 流局
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
