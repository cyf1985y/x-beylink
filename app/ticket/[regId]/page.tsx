import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import {
  DbEvent,
  DbRegistration,
  EVENT_STATUS_LABEL,
  formatTaipei,
} from "@/lib/events";
import { TierBadge, StatusChip } from "@/components/TierBadge";

export const dynamic = "force-dynamic";

export default async function TicketPage({
  params,
}: {
  params: { regId: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const db = supabaseAdmin();
  const { data: reg } = await db
    .from("registrations")
    .select("*")
    .eq("id", params.regId)
    .single<DbRegistration>();
  if (!reg || reg.status === "cancelled") notFound();

  const [{ data: player }, { data: event }] = await Promise.all([
    db.from("players").select("*").eq("id", reg.player_id).single<DbPlayer>(),
    db.from("events").select("*").eq("id", reg.event_id).single<DbEvent>(),
  ]);
  if (!player || !event) notFound();
  if (player.user_id !== session.uid) notFound();

  const qrDataUrl =
    reg.status === "ok"
      ? await QRCode.toDataURL(`xb-checkin:${reg.qr_token}`, {
          width: 280,
          margin: 2,
          color: { dark: "#0b1026", light: "#ffffff" },
        })
      : null;

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link
        href={`/event/${event.id}`}
        className="text-sm text-slate-400 hover:text-slate-200"
      >
        ← 回賽事頁
      </Link>

      <div className="mt-4 rounded-2xl border border-arena-line bg-arena-card p-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <TierBadge tier={event.tier} />
          <StatusChip
            status={event.status}
            label={EVENT_STATUS_LABEL[event.status]}
          />
        </div>
        <h1 className="mt-2 text-xl font-black">{event.title}</h1>
        <p className="mt-1 text-sm text-slate-400">
          🗓 {formatTaipei(event.starts_at)}｜📍 {event.venue}
        </p>

        <div className="mt-5 flex items-center justify-center gap-3">
          <span className="text-3xl">{player.avatar}</span>
          <span className="text-lg font-bold">{player.nickname}</span>
        </div>

        {reg.checked_in_at ? (
          <div className="mt-6 rounded-xl border border-emerald-400/50 bg-emerald-400/10 p-6">
            <p className="text-2xl">✅</p>
            <p className="mt-1 font-bold text-emerald-300">已完成報到</p>
            <p className="mt-1 text-xs text-slate-400">
              {formatTaipei(reg.checked_in_at)}
            </p>
          </div>
        ) : qrDataUrl ? (
          <>
            <div className="mt-6 inline-block rounded-2xl bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="報到 QR Code" width={280} height={280} />
            </div>
            <p className="mt-3 text-sm text-slate-400">
              到場後出示此 QR Code 給主辦方掃描報到
            </p>
          </>
        ) : (
          <div className="mt-6 rounded-xl border border-gold/50 bg-gold/10 p-6">
            <p className="font-bold text-gold">⏳ 候補中</p>
            <p className="mt-1 text-xs text-slate-400">
              遞補成功後這裡就會出現報到 QR Code
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
