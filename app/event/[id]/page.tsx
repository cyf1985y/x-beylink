import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import {
  DbEvent,
  DbRegistration,
  EVENT_STATUS_LABEL,
  TIERS,
  formatTaipei,
  isPlayerBanned,
} from "@/lib/events";
import { TierBadge, StatusChip } from "@/components/TierBadge";
import {
  RegistrationPanel,
  type PlayerRegState,
} from "@/components/RegistrationPanel";
import { settleDueEvents } from "@/lib/settle";

export const dynamic = "force-dynamic";

export default async function EventPage({
  params,
}: {
  params: { id: string };
}) {
  const db = supabaseAdmin();
  await settleDueEvents(db);
  const { data: event } = await db
    .from("events")
    .select("*")
    .eq("id", params.id)
    .single<DbEvent>();
  if (!event) notFound();

  const session = await getSession();

  const { data: organizer } = await db
    .from("organizers")
    .select("name,verified,score,events_held")
    .eq("id", event.organizer_id)
    .single<{
      name: string;
      verified: boolean;
      score: number;
      events_held: number;
    }>();

  const { data: regs } = await db
    .from("registrations")
    .select("*")
    .eq("event_id", event.id)
    .neq("status", "cancelled")
    .returns<DbRegistration[]>();
  const okCount = (regs ?? []).filter((r) => r.status === "ok").length;
  const waitCount = (regs ?? []).filter((r) => r.status === "waitlist").length;

  let myPlayers: PlayerRegState[] = [];
  if (session) {
    const { data: players } = await db
      .from("players")
      .select("*")
      .eq("user_id", session.uid)
      .order("created_at", { ascending: true })
      .returns<DbPlayer[]>();
    myPlayers = (players ?? []).map((p) => {
      const reg = (regs ?? []).find((r) => r.player_id === p.id) ?? null;
      return {
        playerId: p.id,
        nickname: p.nickname,
        avatar: p.avatar,
        banned: isPlayerBanned(p),
        registrationId: reg?.id ?? null,
        regStatus: reg ? (reg.status as "ok" | "waitlist") : null,
      };
    });
  }

  const closed =
    (event.status !== "open" && event.status !== "confirmed") ||
    new Date(event.starts_at) <= new Date();
  const progress = Math.min(
    100,
    Math.round((okCount / event.min_required) * 100)
  );

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
        ← 賽事列表
      </Link>

      <div className="card-x mt-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <TierBadge tier={event.tier} />
          <StatusChip
            status={event.status}
            label={EVENT_STATUS_LABEL[event.status]}
          />
        </div>
        <h1 className="mt-2 text-2xl font-black">{event.title}</h1>
        <dl className="mt-3 space-y-1.5 text-sm text-slate-300">
          <div>🗓 {formatTaipei(event.starts_at)}（台灣時間）</div>
          <div>📍 {event.venue}</div>
          {event.address && (
            <div>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyanx underline decoration-cyanx/40 hover:decoration-cyanx"
              >
                🗺️ {event.address}
              </a>
              <span className="ml-1 text-xs text-slate-500">（點開導航）</span>
            </div>
          )}
          <div>🎯 {event.division}</div>
          {event.rules_note && (
            <div className="rounded-lg bg-arena p-3 text-xs text-slate-400">
              📋 {event.rules_note}
            </div>
          )}
        </dl>

        <div className="mt-4">
          <div className="flex justify-between text-xs text-slate-400">
            <span>
              成行進度 {okCount}/{event.min_required} 人
              {okCount >= event.min_required && " ✅ 已達標"}
            </span>
            <span>
              名額 {okCount}/{event.capacity}
              {waitCount > 0 && `｜候補 ${waitCount}`}
            </span>
          </div>
          <div className="mt-1 h-2.5 -skew-x-12 overflow-hidden rounded-sm bg-arena">
            <div
              className={`h-full bg-stripes bg-[length:34px_34px] ${
                okCount >= event.min_required
                  ? "animate-stripes bg-emerald-400"
                  : "bg-cyanx"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {TIERS[event.tier].label}賽事需滿 {event.min_required}{" "}
            人才成團；若 {formatTaipei(event.confirm_deadline)}{" "}
            前未達標將流局，所有人信譽不受影響。開賽前 72
            小時內取消將記 0.5 點信譽點數。
          </p>
        </div>
      </div>

      {organizer && (
        <div className="card-x mt-4 flex items-center gap-3 p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-arena-line bg-arena text-xl">
            🏟️
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">
              {organizer.name}
              {organizer.verified && (
                <span className="ml-1.5 text-xs font-normal text-cyanx">
                  ✓ 平台認證
                </span>
              )}
            </p>
            <p className="text-xs text-slate-500">主辦方</p>
          </div>
          <div className="text-right">
            <p className="font-num text-lg font-bold text-gold">
              {organizer.score}
              <span className="ml-0.5 text-[10px] font-normal text-slate-500">
                積分
              </span>
            </p>
            <p className="text-xs text-slate-500">
              辦過 {organizer.events_held} 場
            </p>
          </div>
        </div>
      )}

      <Link
        href={`/event/${event.id}/bracket`}
        className="mt-4 block rounded-2xl border border-violetx/40 bg-violetx/10 p-3 text-center text-sm font-bold text-violetx transition hover:bg-violetx/20"
      >
        ⚔️ 看對戰表（比賽日即時晉級圖）→
      </Link>

      <section className="mt-6">
        <h2 className="h-x">我要報名</h2>
        <div className="mt-3">
          {!session && (
            <Link
              href="/login"
              className="block rounded-xl bg-[#06C755] px-6 py-3 text-center font-bold text-white hover:brightness-110"
            >
              先用 LINE 登入再報名
            </Link>
          )}
          {session && myPlayers.length === 0 && (
            <div className="rounded-2xl border border-dashed border-arena-line p-5 text-center text-sm text-slate-500">
              還沒有選手檔案——
              <Link href="/me" className="text-cyanx underline">
                先去建立
              </Link>
              就能報名！
            </div>
          )}
          {session && myPlayers.length > 0 && (
            <RegistrationPanel
              eventId={event.id}
              players={myPlayers}
              closed={closed}
            />
          )}
        </div>
      </section>
    </main>
  );
}
