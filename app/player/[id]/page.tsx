import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import { TIERS, Tier, formatTaipei, isTier } from "@/lib/events";
import { careerFinishStats } from "@/lib/rounds";
import {
  BASE_RATING,
  CLASS_LABEL,
  DbLadderRating,
  activeSeason,
  ladderClassOf,
  rankOf,
} from "@/lib/ladder";

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

  // 天梯：當季積分（沒有賽季或尚未出賽都不顯示區塊）
  const season = await activeSeason(db);
  const { data: ladder } = season
    ? await db
        .from("ladder_ratings")
        .select("*")
        .eq("season_id", season.id)
        .eq("player_id", player.id)
        .maybeSingle<DbLadderRating>()
    : { data: null };
  const ladderRank = ladder ? rankOf(ladder.rating) : null;

  // 生涯結束方式（只算已結算的賽事與已成立的天梯場）
  const finishes = await careerFinishStats(db, player.id);

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

      <div className="mt-4 overflow-hidden rounded-2xl border border-cyanx/40 bg-arena-card shadow-glow-strong">
        <div className="relative bg-gradient-to-r from-cyanx/20 via-bluex/10 to-violetx/20 p-6 text-center">
          <div className="absolute inset-0 bg-stripes bg-[length:34px_34px] opacity-[0.04]" />
          <div className="relative mx-auto flex h-20 w-20 animate-floaty items-center justify-center rounded-2xl border border-cyanx/40 bg-arena text-5xl shadow-glow">
            {player.avatar}
          </div>
          <h1 className="relative mt-3 text-3xl font-black italic tracking-wide text-glow">
            {player.nickname}
          </h1>
          <p className="relative mt-1.5 text-sm text-slate-300">
            {player.city ?? ""}
            {player.team_name && (
              <span className="ml-2 font-bold text-cyanx">
                🏴 {player.team_name}
              </span>
            )}
          </p>
          <p className="relative mt-1 font-num text-xs tracking-[0.3em] text-slate-400">
            SINCE {new Date(player.created_at).getFullYear()}
          </p>
        </div>

        <div className="grid grid-cols-3 divide-x divide-arena-line border-t border-arena-line text-center">
          <div className="p-4">
            <p className="font-num text-2xl font-bold text-cyanx">
              {(trophies ?? []).length}
            </p>
            <p className="text-xs tracking-wider text-slate-500">獎盃</p>
          </div>
          <div className="p-4">
            <p className="font-num text-2xl font-bold text-gold">{champions}</p>
            <p className="text-xs tracking-wider text-slate-500">冠軍</p>
          </div>
          <div className="p-4">
            <p className="font-num text-2xl font-bold text-slate-200">
              {attendanceRate === null ? "—" : `${attendanceRate}%`}
            </p>
            <p className="text-xs tracking-wider text-slate-500">出席率</p>
          </div>
        </div>

        {/* 生涯數據：怎麼贏的（只算已結算的賽事與已成立的天梯場） */}
        <div className="grid grid-cols-2 divide-x divide-arena-line border-t border-arena-line text-center">
          <div className="p-4">
            <p className="font-num text-2xl font-bold text-violetx">
              {finishes.xtreme}
            </p>
            <p className="text-xs tracking-wider text-slate-500">
              ⚡ Xtreme 次數
            </p>
          </div>
          <div className="p-4">
            <p className="font-num text-2xl font-bold text-orange-300">
              {finishes.burst}
            </p>
            <p className="text-xs tracking-wider text-slate-500">
              💥 Burst 次數
            </p>
          </div>
        </div>
      </div>

      {season && ladder && ladderRank && (
        <section className="mt-6">
          <h2 className="h-x">天梯</h2>
          <div
            className={`mt-3 rounded-2xl border p-4 ${ladderRank.border}`}
          >
            <div className="flex items-center gap-3">
              <span className="text-4xl">{ladderRank.icon}</span>
              <div className="min-w-0 flex-1">
                <p className={`text-xl font-black ${ladderRank.text}`}>
                  {ladderRank.label}
                </p>
                <p className="text-xs text-slate-400">
                  {season.name}｜{CLASS_LABEL[ladderClassOf(player.role)]}
                </p>
              </div>
              <div className="text-right">
                <p className="font-num text-2xl font-bold">{ladder.rating}</p>
                <p className="text-[10px] tracking-wider text-slate-500">積分</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 divide-x divide-arena-line border-t border-arena-line pt-3 text-center">
              <div>
                <p className="font-num text-lg font-bold text-slate-200">
                  {ladder.matches}
                </p>
                <p className="text-[10px] tracking-wider text-slate-500">場次</p>
              </div>
              <div>
                <p className="font-num text-lg font-bold text-emerald-300">
                  {ladder.wins}勝 {ladder.losses}敗
                </p>
                <p className="text-[10px] tracking-wider text-slate-500">戰績</p>
              </div>
              <div>
                <p className="font-num text-lg font-bold text-gold">
                  {ladder.peak_rating}
                </p>
                <p className="text-[10px] tracking-wider text-slate-500">
                  最高分
                </p>
              </div>
            </div>
            {ladder.rating === BASE_RATING && ladder.matches === 0 && (
              <p className="mt-2 text-center text-xs text-slate-500">
                還沒打過排位——到道館進場就能開始。
              </p>
            )}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="h-x text-gold">獎盃牆</h2>
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
