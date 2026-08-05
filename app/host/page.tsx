import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import {
  getOrganizerForUser,
  getLatestApplication,
  effectiveTierAllowed,
  SILVER_UNLOCK_EVENTS,
} from "@/lib/organizer";
import { DbUser } from "@/lib/supabase";
import { HostApplyForm } from "@/components/HostApplyForm";
import { DbEvent, EVENT_STATUS_LABEL, formatTaipei, TIERS } from "@/lib/events";
import { TierBadge, StatusChip } from "@/components/TierBadge";

export const dynamic = "force-dynamic";

export default async function HostPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const db = supabaseAdmin();
  const organizer = await getOrganizerForUser(db, session.uid);
  if (!organizer) {
    const application = await getLatestApplication(db, session.uid);
    const { data: me } = await db
      .from("users")
      .select("display_name")
      .eq("id", session.uid)
      .maybeSingle<Pick<DbUser, "display_name">>();

    return (
      <main className="mx-auto max-w-md px-4 py-10 text-center">
        <p className="text-4xl">🏟️</p>
        <h1 className="mt-3 text-xl font-black">主辦方專區</h1>

        {application?.status === "pending" ? (
          <div className="card-x mt-6 p-5">
            <p className="text-3xl">⏳</p>
            <h2 className="mt-2 font-black text-cyanx">審核中</h2>
            <p className="mt-2 text-sm text-slate-400">
              你已申請以「{application.shop_name}」開辦賽事，
              平台管理員正在審核。通過後會用 LINE 通知你，這一頁也會變成你的主辦後台。
            </p>
          </div>
        ) : (
          <>
            <p className="mt-3 text-sm text-slate-400">
              想在你的店裡、或跟朋友揪一場比賽嗎？填一下資料就可以申請開辦。
            </p>
            {application?.status === "rejected" && (
              <p className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-200">
                上次的申請沒有通過
                {application.reject_reason
                  ? `：${application.reject_reason}`
                  : "。"}
                補充資料後可以再送一次。
              </p>
            )}
            <HostApplyForm defaultName={me?.display_name ?? ""} />
          </>
        )}

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
          可開等級：{TIERS[effectiveTierAllowed(organizer)].label}以下
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
      <p className="mt-1.5 text-sm text-slate-400">
        主辦積分 <span className="font-num font-bold text-gold">{organizer.score}</span>
        ｜辦過 <span className="font-num font-bold text-cyanx">{organizer.events_held}</span> 場
        {!organizer.verified &&
          organizer.events_held < SILVER_UNLOCK_EVENTS && (
            <span className="ml-1 text-xs text-slate-500">
              （再辦 {SILVER_UNLOCK_EVENTS - organizer.events_held} 場解鎖銀級，或申請平台認證）
            </span>
          )}
      </p>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-sm text-slate-400">我的賽事</p>
        <Link
          href="/host/new"
          className="rounded-xl bg-cyanx px-4 py-2 text-sm font-bold text-arena hover:brightness-110"
        >
          ＋ 開新賽事
        </Link>
      </div>

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
