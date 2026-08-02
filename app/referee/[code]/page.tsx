import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { DbEvent, EVENT_STATUS_LABEL, formatTaipei } from "@/lib/events";
import { TierBadge, StatusChip } from "@/components/TierBadge";
import { RefereeJoinForm } from "@/components/RefereeJoin";

export const dynamic = "force-dynamic";

/** 裁判邀請頁：主辦方分享的 QR／連結會帶到這裡 */
export default async function RefereeInvitePage({
  params,
}: {
  params: { code: string };
}) {
  if (!/^[0-9a-f-]{36}$/i.test(params.code)) notFound();

  const db = supabaseAdmin();
  const { data: event } = await db
    .from("events")
    .select("*")
    .eq("referee_code", params.code)
    .maybeSingle<DbEvent>();
  if (!event) notFound();

  const session = await getSession();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-2xl border border-violetx/40 bg-arena-card p-6 text-center">
        <div className="text-4xl">🧑‍⚖️</div>
        <h1 className="mt-2 text-xl font-black">裁判邀請</h1>
        <p className="mt-2 text-sm text-slate-400">
          主辦方邀請你擔任這場賽事的裁判，加入後可以在對戰表記錄每場勝負。
        </p>

        <div className="mt-4 rounded-xl border border-arena-line bg-arena p-4 text-left">
          <div className="flex items-center justify-between gap-2">
            <TierBadge tier={event.tier} />
            <StatusChip
              status={event.status}
              label={EVENT_STATUS_LABEL[event.status]}
            />
          </div>
          <p className="mt-2 font-bold">{event.title}</p>
          <p className="mt-1 text-sm text-slate-400">
            🗓 {formatTaipei(event.starts_at)}｜📍 {event.venue}
          </p>
        </div>

        <div className="mt-5">
          {session ? (
            <RefereeJoinForm code={params.code} />
          ) : (
            <a
              href={`/api/auth/line?next=${encodeURIComponent(`/referee/${params.code}`)}`}
              className="block rounded-xl bg-[#06C755] px-6 py-3 font-bold text-white transition hover:brightness-110"
            >
              先用 LINE 登入（登入後會自動回到這頁）
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
