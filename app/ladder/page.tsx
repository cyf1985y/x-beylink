import Link from "next/link";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import {
  CLASS_LABEL,
  DbGymPublic,
  DbLadderRating,
  LEADERBOARD_LIMIT,
  LadderClass,
  activeSeason,
  ladderClassOf,
  rankOf,
  runLadderMaintenance,
} from "@/lib/ladder";
import { findActiveMatchId } from "@/app/ladder/actions";

export const dynamic = "force-dynamic";

/** 一次撈進記憶體再分組的上限（M1 規模足夠；每組只顯示前 20） */
const SCAN_LIMIT = 500;

type Row = {
  playerId: string;
  nickname: string;
  avatar: string;
  rating: number;
  matches: number;
  wins: number;
  losses: number;
  cls: LadderClass;
};

export default async function LadderPage() {
  const db = supabaseAdmin();
  // 逾時未確認的對戰在這裡補跑成立（cron 另外每日掃底）
  await runLadderMaintenance(db);

  const season = await activeSeason(db);
  const session = await getSession();

  const [{ data: gyms }, { data: mine }] = await Promise.all([
    db
      .from("gyms_public")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .returns<DbGymPublic[]>(),
    session
      ? db
          .from("players")
          .select("*")
          .eq("user_id", session.uid)
          .order("created_at", { ascending: true })
          .returns<DbPlayer[]>()
      : Promise.resolve({ data: [] as DbPlayer[] }),
  ]);

  const myPlayers = mine ?? [];
  const activeMatchId = await findActiveMatchId(myPlayers.map((p) => p.id));

  let rows: Row[] = [];
  const myRating = new Map<string, DbLadderRating>();

  if (season) {
    const { data: ratings } = await db
      .from("ladder_ratings")
      .select("*")
      .eq("season_id", season.id)
      .order("rating", { ascending: false })
      .limit(SCAN_LIMIT)
      .returns<DbLadderRating[]>();

    const ids = (ratings ?? []).map((r) => r.player_id);
    const { data: players } = ids.length
      ? await db
          .from("players")
          .select("id,nickname,avatar,role")
          .in("id", ids)
          .returns<Array<Pick<DbPlayer, "id" | "nickname" | "avatar" | "role">>>()
      : { data: [] as Array<Pick<DbPlayer, "id" | "nickname" | "avatar" | "role">> };
    const pmap = new Map((players ?? []).map((p) => [p.id, p]));

    for (const r of ratings ?? []) {
      if (myPlayers.some((p) => p.id === r.player_id)) myRating.set(r.player_id, r);
      const p = pmap.get(r.player_id);
      if (!p) continue;
      rows.push({
        playerId: p.id,
        nickname: p.nickname,
        avatar: p.avatar,
        rating: r.rating,
        matches: r.matches,
        wins: r.wins,
        losses: r.losses,
        cls: ladderClassOf(p.role),
      });
    }
  }

  const board = (cls: LadderClass) =>
    rows.filter((r) => r.cls === cls).slice(0, LEADERBOARD_LIMIT);

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
        ← 首頁
      </Link>

      <h1 className="mt-4 text-2xl font-black italic">
        天梯<span className="text-gradient">排位</span>
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        {season
          ? `${season.name}｜到道館進場，就能和現場的人 1v1 排位`
          : "目前沒有進行中的賽季"}
      </p>

      {activeMatchId && (
        <Link
          href={`/ladder/match/${activeMatchId}`}
          className="mt-4 block rounded-xl border border-cyanx/50 bg-cyanx/10 px-4 py-3 text-sm font-bold text-cyanx"
        >
          ⚔️ 你有一場對戰還沒結束——點此回到現場
        </Link>
      )}

      {myPlayers.length > 0 && season && (
        <section className="mt-6">
          <h2 className="h-x">我的天梯</h2>
          <div className="mt-3 space-y-2">
            {myPlayers.map((p) => {
              const r = myRating.get(p.id);
              const rating = r?.rating ?? 1000;
              const rank = rankOf(rating);
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border border-arena-line bg-arena-card p-3"
                >
                  <span className="text-3xl">{p.avatar}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-black">{p.nickname}</p>
                    <p className={`text-sm font-bold ${rank.text}`}>
                      {rank.icon} {rank.label}
                      <span className="ml-2 font-num text-xs text-slate-500">
                        {rating}
                      </span>
                    </p>
                  </div>
                  <p className="text-right text-xs text-slate-500">
                    {CLASS_LABEL[ladderClassOf(p.role)]}
                    <br />
                    {r ? `${r.wins}勝 ${r.losses}敗` : "尚未出賽"}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="h-x">道館</h2>
        <div className="mt-3 space-y-2">
          {(gyms ?? []).length === 0 && (
            <p className="rounded-2xl border border-dashed border-arena-line p-6 text-center text-sm text-slate-500">
              還沒有開放的道館
            </p>
          )}
          {(gyms ?? []).map((g) => (
            <Link
              key={g.id}
              href={`/ladder/gym/${g.id}`}
              className="flex items-center gap-3 rounded-xl border border-arena-line bg-arena-card p-3 transition hover:border-cyanx/60"
            >
              <span className="text-2xl">🏟️</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{g.name}</span>
                <span className="block text-xs text-slate-500">
                  進場範圍 {g.radius_m} 公尺
                  {g.certified && (
                    <span className="ml-2 text-gold">✦ 認證道館</span>
                  )}
                </span>
              </span>
              <span className="text-slate-600">→</span>
            </Link>
          ))}
        </div>
      </section>

      {(["normal", "open"] as const).map((cls) => (
        <section key={cls} className="mt-8">
          <h2 className="h-x">{CLASS_LABEL[cls]}排行榜</h2>
          <p className="mt-1 text-xs text-slate-500">
            當季前 {LEADERBOARD_LIMIT} 名
          </p>
          <div className="mt-3 space-y-1.5">
            {board(cls).length === 0 && (
              <p className="rounded-2xl border border-dashed border-arena-line p-6 text-center text-sm text-slate-500">
                這一組還沒有人出賽
              </p>
            )}
            {board(cls).map((r, i) => {
              const rank = rankOf(r.rating);
              return (
                <Link
                  key={r.playerId}
                  href={`/player/${r.playerId}`}
                  className="flex items-center gap-3 rounded-xl border border-arena-line bg-arena-card p-2.5 transition hover:border-cyanx/60"
                >
                  <span
                    className={`w-6 shrink-0 text-center font-num text-sm font-bold ${
                      i === 0
                        ? "text-gold"
                        : i === 1
                          ? "text-silver"
                          : i === 2
                            ? "text-bronze"
                            : "text-slate-600"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="text-2xl">{r.avatar}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{r.nickname}</span>
                    <span className={`block text-xs font-bold ${rank.text}`}>
                      {rank.icon} {rank.label}
                      <span className="ml-2 font-num text-slate-500">
                        {r.rating}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-slate-500">
                    {r.wins}勝
                    <br />
                    {r.losses}敗
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
