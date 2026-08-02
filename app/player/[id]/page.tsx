import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import { TIERS, Tier, formatTaipei, isTier } from "@/lib/events";

export const dynamic = "force-dynamic";

const RANK_LABEL: Record<number, string> = {
  1: "🥇 冠軍",
  2: "🥈 亞軍",
  3: "🥉 季軍",
  4: "🎖️ 殿軍",
  8: "🎗️ 八強",
};

const TIER_TEXT: Record<Tier, string> = {
  gold: "text-gold",
  silver: "text-silver",
  bronze: "text-bronze",
};

/** 選手卡公開頁：只顯示暱稱＋虛擬頭像（兒少保護，不露任何個資） */
export default async function PlayerPage({
  params,
}: {
  params: { id: string };
}) {
  const db = supabaseAdmin();
  const { data: player } = await db
    .from("players")
    .select("*")
    .eq("id", params.id)
    .single<DbPlayer>();
  if (!player) notFound();

  const { data: trophies } = await db
    .from("trophies")
    .select("id,event_id,tier,rank,issued_at,revoked_at")
    .eq("player_id", player.id)
    .is("revoked_at", null)
    .order("issued_at", { ascending: false })
    .returns<
      Array<{
        id: string;
        event_id: string;
        tier: string;
        rank: number;
        issued_at: string;
        revoked_at: string | null;
      }>
    >();

  const eventIds = Array.from(new Set((trophies ?? []).map((t) => t.event_id)));
  const { data: events } = eventIds.length
    ? await db
        .from("events")
        .select("id,title")
        .in("id", eventIds)
        .returns<Array<{ id: string; title: string }>>()
    : { data: [] as Array<{ id: string; title: string }> };
  const eventTitle = new Map((events ?? []).map((e) => [e.id, e.title]));

  const attendanceRate =
    player.attendance_total > 0
      ? Math.round((player.attendance_ok / player.attendance_total) * 100)
      : null;
  const champions = (trophies ?? []).filter((t) => t.rank === 1).length;

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
        ← 首頁
      </Link>

      <div className="mt-4 overflow-hidden rounded-2xl border border-cyanx/40 bg-arena-card shadow-glow">
        <div className="bg-gradient-to-r from-cyanx/20 to-violetx/20 p-6 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl border border-arena-line bg-arena text-5xl">
            {player.avatar}
          </div>
          <h1 className="mt-3 text-2xl font-black">{player.nickname}</h1>
          <p className="mt-1 text-xs text-slate-400">
            出道於 {new Date(player.created_at).getFullYear()} 年
          </p>
        </div>

        <div className="grid grid-cols-3 divide-x divide-arena-line border-t border-arena-line text-center">
          <div className="p-4">
            <p className="text-xl font-black text-cyanx">
              {(trophies ?? []).length}
            </p>
            <p className="text-xs text-slate-500">獎盃</p>
          </div>
          <div className="p-4">
            <p className="text-xl font-black text-gold">{champions}</p>
            <p className="text-xs text-slate-500">冠軍</p>
          </div>
          <div className="p-4">
            <p className="text-xl font-black text-slate-200">
              {attendanceRate === null ? "—" : `${attendanceRate}%`}
            </p>
            <p className="text-xs text-slate-500">出席率</p>
          </div>
        </div>
      </div>

      <section className="mt-6">
        <h2 className="text-lg font-bold text-gold">🏆 獎盃牆</h2>
        <div className="mt-3 space-y-2">
          {(trophies ?? []).length === 0 && (
            <p className="rounded-2xl border border-dashed border-arena-line p-6 text-center text-sm text-slate-500">
              還沒有獎盃——下一場比賽就是起點！
            </p>
          )}
          {(trophies ?? []).map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-xl border border-arena-line bg-arena-card p-3"
            >
              <span
                className={`text-sm font-bold ${
                  isTier(t.tier) ? TIER_TEXT[t.tier] : "text-slate-300"
                }`}
              >
                {isTier(t.tier) ? TIERS[t.tier].label : t.tier}
              </span>
              <span className="font-bold">{RANK_LABEL[t.rank] ?? `第 ${t.rank} 名`}</span>
              <span className="min-w-0 flex-1 truncate text-right text-xs text-slate-500">
                {eventTitle.get(t.event_id) ?? "賽事"}｜
                {formatTaipei(t.issued_at)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
