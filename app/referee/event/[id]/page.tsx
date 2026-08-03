import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { requireScorer } from "@/lib/scorer";
import { EVENT_STATUS_LABEL, formatTaipei } from "@/lib/events";
import {
  roundName,
  finalRoundOf,
  bracketComplete,
  WIN_POINTS,
} from "@/lib/bracket";
import { loadBracketView } from "@/lib/bracketView";
import { autoGenerateBrackets } from "@/lib/autoBracket";
import { TierBadge, StatusChip } from "@/components/TierBadge";
import {
  BracketView,
  SettleFromBracketButton,
} from "@/components/BracketView";
import { HostTabBar } from "@/components/HostTabBar";

export const dynamic = "force-dynamic";

/** 裁判主頁：待打對戰列表（點進去計分）＋完整對戰表 */
export default async function RefereeEventPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const auth = await requireScorer(params.id);
  if (auth.error || !auth.event) notFound();
  const event = auth.event;

  const db = supabaseAdmin();
  await autoGenerateBrackets(db); // 報名截止即自動抽籤（補跑）
  const { matches, view } = await loadBracketView(db, event.id);
  const locked = event.status === "done";
  const finalRound = matches.length ? finalRoundOf(matches) : 1;
  const allDone = matches.length > 0 && bracketComplete(matches);

  const nameOf = (id: string | null) =>
    view.find((v) => v.player1?.id === id)?.player1 ??
    view.find((v) => v.player2?.id === id)?.player2 ??
    null;

  // 可計分：雙方都到位且尚未分出勝負
  const playable = view.filter(
    (m) => m.player1 && m.player2 && !m.winnerId
  );
  const finished = view.filter((m) => m.winnerId && m.player1 && m.player2);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full border border-violetx/50 bg-violetx/10 px-2.5 py-0.5 text-xs text-violetx">
          🧑‍⚖️ 裁判模式
        </span>
        <div className="flex items-center gap-2">
          <TierBadge tier={event.tier} />
          <StatusChip
            status={event.status}
            label={EVENT_STATUS_LABEL[event.status]}
          />
        </div>
      </div>

      <h1 className="mt-3 text-xl font-black">⚔️ {event.title}</h1>
      <p className="mt-1 text-sm text-slate-400">
        🗓 {formatTaipei(event.starts_at)}｜📍 {event.venue}
      </p>

      {view.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-arena-line p-8 text-center text-sm text-slate-500">
          對戰表還沒產生——報名截止（開賽前 2 小時）會自動抽籤。
        </div>
      ) : (
        <>
          {allDone && !locked && (
            <section className="mt-6 rounded-2xl border-2 border-gold/60 bg-gold/10 p-5 text-center shadow-glow-gold">
              <p className="text-3xl">🏁</p>
              <p className="mt-1 text-lg font-black text-gold">
                所有對戰已完成！
              </p>
              {auth.isOwner ? (
                <>
                  <p className="mt-1 text-xs text-slate-400">
                    名次已由對戰結果自動判定，按下去就發獎盃、記出席、結束賽事
                  </p>
                  <SettleFromBracketButton eventId={event.id} />
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-400">
                  請主辦方進行結算發獎（裁判無發獎權限）
                </p>
              )}
            </section>
          )}

          {locked && (
            <section className="mt-6 rounded-2xl border border-emerald-400/50 bg-emerald-400/10 p-4 text-center text-sm text-emerald-300">
              ✅ 本場已結算發獎完畢
            </section>
          )}

          <section className="mt-6">
            <h2 className="h-x">
              待進行對戰
              <span className="ml-1 font-num text-sm text-slate-500">
                {playable.length}
              </span>
            </h2>
            <div className="mt-3 space-y-2">
              {playable.length === 0 && (
                <p className="rounded-xl border border-dashed border-arena-line p-4 text-center text-sm text-slate-500">
                  目前沒有可進行的對戰（等上一輪打完）
                </p>
              )}
              {playable.map((m) => (
                <Link
                  key={m.id}
                  href={
                    locked ? "#" : `/referee/event/${event.id}/match/${m.id}`
                  }
                  className="card-x flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:border-cyanx/60"
                >
                  <div className="shrink-0 text-center">
                    <p className="font-num text-2xl font-bold text-cyanx">
                      {m.slot + 1}
                    </p>
                    <p className="text-[10px] text-slate-500">決鬥台</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold tracking-wider text-slate-500">
                      {m.kind === "third"
                        ? "季軍戰"
                        : roundName(m.round, finalRound)}
                    </p>
                    <p className="truncate font-black">
                      {m.player1?.avatar} {m.player1?.nickname}
                      <span className="mx-1.5 font-num text-xs text-violetx">
                        VS
                      </span>
                      {m.player2?.avatar} {m.player2?.nickname}
                    </p>
                    {(m.score1 > 0 || m.score2 > 0) && (
                      <p className="font-num text-xs text-slate-400">
                        {m.score1} － {m.score2}（先到 {WIN_POINTS} 分）
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-lg bg-cyanx px-3 py-1.5 text-xs font-black text-arena">
                    計分
                  </span>
                </Link>
              ))}
            </div>
          </section>

          {finished.length > 0 && (
            <section className="mt-6">
              <h2 className="h-x text-slate-400">已完成</h2>
              <div className="mt-3 space-y-1.5">
                {finished.map((m) => {
                  const w = nameOf(m.winnerId);
                  return (
                    <Link
                      key={m.id}
                      href={`/referee/event/${event.id}/match/${m.id}`}
                      className="flex items-center gap-2 rounded-xl border border-arena-line bg-arena px-3 py-2 text-sm hover:border-cyanx/40"
                    >
                      <span className="text-[10px] text-slate-500">
                        {m.kind === "third"
                          ? "季軍戰"
                          : roundName(m.round, finalRound)}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-bold text-gold">
                        🏆 {w?.nickname ?? "獲勝者"}
                      </span>
                      <span className="font-num text-xs text-slate-400">
                        {m.score1}－{m.score2}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mt-8">
            <h2 className="h-x text-slate-400">完整對戰表</h2>
            <p className="mb-2 mt-2 text-xs text-slate-500">
              未報到的選手若沒出現，可直接點對手名字判定獲勝（爽約視同棄權）。
            </p>
            <BracketView
              eventId={event.id}
              matches={view}
              interactive={!locked}
              autoRefresh
            />
          </section>
        </>
      )}

      <p className="mt-8 text-center text-xs text-slate-600">
        <Link
          href={`/event/${event.id}/bracket`}
          className="hover:text-slate-400"
        >
          觀眾版對戰表 →
        </Link>
      </p>

      <HostTabBar
        eventId={event.id}
        active="referee"
        isOwner={!!auth.isOwner}
      />
    </main>
  );
}
