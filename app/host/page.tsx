import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { getOrganizerForUser } from "@/lib/organizer";
import { DbEvent, EVENT_STATUS_LABEL, formatTaipei, TIERS } from "@/lib/events";
import { TierBadge, StatusChip } from "@/components/TierBadge";

export const dynamic = "force-dynamic";

export default async function HostPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const db = supabaseAdmin();
  const organizer = await getOrganizerForUser(db, session.uid);
  if (!organizer) {
    return (
      <main className="mx-auto max-w-md px-4 py-10 text-center">
        <p className="text-4xl">🏟️</p>
        <h1 className="mt-3 text-xl font-black">主辦方專區</h1>
        <p className="mt-3 text-sm text-slate-400">
          你目前還不是主辦方。想在你的店裡辦賽事嗎？主辦方申請功能即將推出（M4／M5），
          先跟平台管理員聯絡開通。
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm text-cyanx underline"
        >
          ← 回首頁
        </Link>
      </main>
    );
  }

  const { data: events } = await db
    .from("events")
    .select("*")
    .eq("organizer_id", organizer.id)
    .order("starts_at", { ascending: false })
    .returns<DbEvent[]>();

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
          ← 首頁
        </Link>
        <span className="text-xs text-slate-500">
          可開等級：{TIERS[organizer.tier_allowed].label}以下
        </span>
      </header>

      <h1 className="mt-4 text-2xl font-black">
        🏟️ {organizer.name}
        {organizer.verified && (
          <span className="ml-2 align-middle text-xs font-normal text-cyanx">
            ✓ 已認證
          </span>
        )}
      </h1>
      <p className="mt-1 text-sm text-slate-400">我的賽事</p>

      <section className="mt-5 space-y-3">
        {(events ?? []).length === 0 && (
          <div className="rounded-2xl border border-dashed border-arena-line p-6 text-center text-sm text-slate-500">
            還沒有賽事（開賽表單將在 M4 推出）
          </div>
        )}
        {(events ?? []).map((e) => (
          <Link
            key={e.id}
            href={`/host/event/${e.id}`}
            className="block rounded-2xl border border-arena-line bg-arena-card p-4 transition hover:border-cyanx/60"
          >
            <div className="flex items-center justify-between gap-2">
              <TierBadge tier={e.tier} />
              <StatusChip status={e.status} label={EVENT_STATUS_LABEL[e.status]} />
            </div>
            <h3 className="mt-2 font-bold">{e.title}</h3>
            <p className="mt-1 text-sm text-slate-400">
              🗓 {formatTaipei(e.starts_at)}｜📍 {e.venue}
            </p>
            <p className="mt-1 text-xs text-cyanx">名單與掃碼報到 →</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
