import Link from "next/link";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import {
  DbEvent,
  EVENT_STATUS_LABEL,
  TIERS,
  formatTaipei,
  registrationDeadlineOf,
} from "@/lib/events";
import { TierBadge, StatusChip } from "@/components/TierBadge";
import { LogoMark } from "@/components/Brand";
import { settleDueEvents } from "@/lib/settle";
import { autoGenerateBrackets } from "@/lib/autoBracket";

export const dynamic = "force-dynamic";

async function loadEvents(): Promise<
  Array<DbEvent & { okCount: number; hasBracket: boolean }>
> {
  const db = supabaseAdmin();
  await Promise.all([settleDueEvents(db), autoGenerateBrackets(db)]);
  // 進行中的賽事（開賽後 12 小時內）也留在列表上，方便現場觀戰
  const { data: events } = await db
    .from("events")
    .select("*")
    .in("status", ["open", "confirmed"])
    .gt("starts_at", new Date(Date.now() - 12 * 3600_000).toISOString())
    .order("starts_at", { ascending: true })
    .returns<DbEvent[]>();
  if (!events || events.length === 0) return [];

  const ids = events.map((e) => e.id);
  const [{ data: regs }, { data: matches }] = await Promise.all([
    db
      .from("registrations")
      .select("event_id")
      .in("event_id", ids)
      .eq("status", "ok")
      .returns<Array<{ event_id: string }>>(),
    db
      .from("matches")
      .select("event_id")
      .in("event_id", ids)
      .returns<Array<{ event_id: string }>>(),
  ]);

  const counts = new Map<string, number>();
  for (const r of regs ?? []) {
    counts.set(r.event_id, (counts.get(r.event_id) ?? 0) + 1);
  }
  const withBracket = new Set((matches ?? []).map((m) => m.event_id));
  return events.map((e) => ({
    ...e,
    okCount: counts.get(e.id) ?? 0,
    hasBracket: withBracket.has(e.id),
  }));
}

export default async function HomePage() {
  const [session, events] = await Promise.all([getSession(), loadEvents()]);

  const tiles = [
    { href: "/me", icon: "🧑‍🚀", label: "選手檔案", desc: "建立與管理選手" },
    { href: "/records", icon: "🏆", label: "生涯戰績", desc: "獎盃與出席紀錄" },
    { href: "/registrations", icon: "🎟️", label: "已報名賽事", desc: "報名狀態與憑證" },
    { href: "#events", icon: "🏟️", label: "近期賽事", desc: "找比賽、揪團開打" },
  ];

  return (
    <main className="mx-auto max-w-md px-4 pb-8">
      {/* 功能導航 */}
      <section className="grid grid-cols-2 gap-3 pt-6">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="card-x p-4 text-center transition hover:-translate-y-0.5 hover:border-cyanx/60 hover:shadow-glow"
          >
            <span className="text-3xl">{t.icon}</span>
            <p className="mt-1.5 font-black">{t.label}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{t.desc}</p>
          </Link>
        ))}
      </section>

      {/* 賽事列表 */}
      <section id="events" className="mt-10 scroll-mt-20">
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
            const live = e.hasBracket;
            return (
              <div
                key={e.id}
                className="card-x block p-5 transition hover:-translate-y-0.5 hover:border-cyanx/60 hover:shadow-glow-strong"
              >
                <Link href={`/event/${e.id}`} className="block">
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
                </Link>
                {live && (
                  <Link
                    href={`/event/${e.id}/bracket`}
                    className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-red-400/50 bg-red-500/10 py-2 text-sm font-black text-red-300 transition hover:bg-red-500/20"
                  >
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
                    賽事進行中・看即時對戰表 →
                  </Link>
                )}
                <Link href={`/event/${e.id}`} className="mt-4 block">
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
                    {live
                      ? "報名已截止，對戰表已抽出"
                      : `${TIERS[e.tier].label}需滿 ${e.min_required} 人，報名至 ${formatTaipei(
                          registrationDeadlineOf(e).toISOString()
                        )} 截止`}
                  </p>
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* 品牌區（移到最下方） */}
      <section className="relative mt-16 border-t border-arena-line/40 pt-10 text-center">
        <div className="mx-auto w-fit animate-floaty">
          <LogoMark size={80} />
        </div>
        <h1 className="mt-4 text-3xl font-black italic tracking-wide">
          陀螺<span className="text-gradient text-glow">集結</span>
        </h1>
        <p className="mt-1 font-num text-xs tracking-[0.35em] text-slate-500">
          X-BEYLINK
        </p>
        <p className="mt-3 text-sm text-slate-400">
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
      </section>
    </main>
  );
}
