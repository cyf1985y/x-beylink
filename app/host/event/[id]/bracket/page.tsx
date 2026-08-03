import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { getOrganizerForUser } from "@/lib/organizer";
import { DbEvent, EVENT_STATUS_LABEL, formatTaipei } from "@/lib/events";
import { bracketComplete } from "@/lib/bracket";
import { loadBracketView } from "@/lib/bracketView";
import QRCode from "qrcode";
import { baseUrl } from "@/lib/line";
import { TierBadge, StatusChip } from "@/components/TierBadge";
import {
  BracketView,
  GenerateBracketButton,
  RegenerateBracketButton,
  SettleFromBracketButton,
} from "@/components/BracketView";
import { autoGenerateBrackets } from "@/lib/autoBracket";
import { RefereePanel, type RefereeRow } from "@/components/RefereePanel";
import { HostTabBar } from "@/components/HostTabBar";

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

  await autoGenerateBrackets(db); // 報名截止即自動抽籤（補跑）
  const { matches, view } = await loadBracketView(db, event.id);
  const complete = matches.length > 0 && bracketComplete(matches);
  const anyPlayed = matches.some(
    (m) => m.winner_id && m.player1_id && m.player2_id
  );

  // 裁判邀請資訊
  const joinUrl = `${baseUrl()}/referee/${(event as DbEvent & { referee_code: string }).referee_code}`;
  const qrDataUrl = await QRCode.toDataURL(joinUrl, { width: 180, margin: 2 });
  const { data: refRows } = await db
    .from("referees")
    .select("id,user_id")
    .eq("event_id", event.id)
    .returns<Array<{ id: string; user_id: string }>>();
  let referees: RefereeRow[] = [];
  if (refRows && refRows.length > 0) {
    const { data: refUsers } = await db
      .from("users")
      .select("id,display_name")
      .in(
        "id",
        refRows.map((r) => r.user_id)
      )
      .returns<Array<{ id: string; display_name: string | null }>>();
    const nameMap = new Map((refUsers ?? []).map((u) => [u.id, u.display_name]));
    referees = refRows.map((r) => ({
      refereeId: r.id,
      displayName: nameMap.get(r.user_id) ?? "裁判",
    }));
  }

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

      <div className="mt-4">
        <RefereePanel
          eventId={event.id}
          joinUrl={joinUrl}
          qrDataUrl={qrDataUrl}
          referees={referees}
        />
      </div>

      <div className="mt-5">
        {view.length === 0 ? (
          <div className="rounded-2xl border border-arena-line bg-arena-card p-5">
            <p className="mb-3 text-sm text-slate-400">
              對戰表會在<b className="text-cyanx">報名截止（開賽前 2 小時）</b>
              時自動抽籤產生。想提前抽也可以按下面的按鈕——系統會把已報名的選手隨機配對成單淘汰賽程（含季軍戰，人數不是
              2 的次方時自動輪空）。
            </p>
            <GenerateBracketButton eventId={event.id} />
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">
              點選手名字＝該場獲勝並晉級；點錯可按該場右上「撤銷」。標示
              <span className="text-red-300">「未報到」</span>
              的選手若沒出現，直接點對手獲勝即可（爽約視同棄權）。
            </p>
            <BracketView eventId={event.id} matches={view} interactive />
            {complete && event.status !== "done" && (
              <SettleFromBracketButton eventId={event.id} />
            )}
            {!anyPlayed && event.status !== "done" && (
              <RegenerateBracketButton eventId={event.id} />
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
      <HostTabBar eventId={event.id} active="settle" />
    </main>
  );
}
