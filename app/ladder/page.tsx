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
import { LadderTabs, isLadderTab } from "@/components/LadderTabs";
import { LeaderboardSwitch } from "@/components/LeaderboardSwitch";

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
  /** 是不是我自己的選手（排行榜要高亮） */
  isMine: boolean;
};

/** 我在某一組的名次；rank 為 null 代表還沒上榜 */
type Standing = {
  playerId: string;
  nickname: string;
  avatar: string;
  cls: LadderClass;
  rank: number | null;
};

export default async function LadderPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
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
  const myIds = new Set(myPlayers.map((p) => p.id));
  const activeMatchId = await findActiveMatchId(myPlayers.map((p) => p.id));

  const rows: Row[] = [];
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
      if (myIds.has(r.player_id)) myRating.set(r.player_id, r);
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
        isMine: myIds.has(p.id),
      });
    }
  }

  /** 該組完整名次（名次以掃描範圍為準，顯示才切前 20） */
  const ranked = (cls: LadderClass) => rows.filter((r) => r.cls === cls);

  const standings: Standing[] = myPlayers.map((p) => {
    const cls = ladderClassOf(p.role);
    const idx = ranked(cls).findIndex((r) => r.playerId === p.id);
    return {
      playerId: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      cls,
      rank: idx >= 0 ? idx + 1 : null,
    };
  });

  const tab = isLadderTab(searchParams.tab) ? searchParams.tab : "battle";

  /* --------------------------------- 對戰頁籤 -------------------------------- */

  const battlePanel = (
    <>
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
        <p className="mt-1 text-xs text-slate-500">
          到現場進場，就能和同一座道館裡的人 1v1
        </p>
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
    </>
  );

  /* -------------------------------- 排行榜頁籤 ------------------------------- */

  /** 「你目前：第 N 名」——名次在掃描範圍外或還沒出賽都算未上榜 */
  const MyStanding = ({ cls }: { cls: LadderClass }) => {
    const mine = standings.filter((s) => s.cls === cls);
    if (mine.length === 0) return null;
    return (
      <div className="mt-3 space-y-1.5">
        {mine.map((s) => (
          <p
            key={s.playerId}
            className="flex items-center gap-2 rounded-xl border border-cyanx/40 bg-cyanx/10 px-3 py-2 text-sm"
          >
            <span className="text-lg">{s.avatar}</span>
            <span className="min-w-0 flex-1 truncate font-bold text-slate-200">
              {s.nickname}
            </span>
            <span className="shrink-0 font-bold text-cyanx">
              你目前：
              {s.rank === null ? (
                "未上榜"
              ) : (
                <>
                  第 <span className="font-num">{s.rank}</span> 名
                  {s.rank > LEADERBOARD_LIMIT && (
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      （未進前 {LEADERBOARD_LIMIT}）
                    </span>
                  )}
                </>
              )}
            </span>
          </p>
        ))}
      </div>
    );
  };

  const BoardList = ({ cls }: { cls: LadderClass }) => {
    const list = ranked(cls).slice(0, LEADERBOARD_LIMIT);
    return (
      <div className="mt-3 space-y-1.5">
        {list.length === 0 && (
          <p className="rounded-2xl border border-dashed border-arena-line p-6 text-center text-sm text-slate-500">
            這一組還沒有人出賽
          </p>
        )}
        {list.map((r, i) => {
          const rank = rankOf(r.rating);
          return (
            <Link
              key={r.playerId}
              href={`/player/${r.playerId}`}
              className={`flex items-center gap-3 rounded-xl border p-2.5 transition ${
                r.isMine
                  ? "border-cyanx/70 bg-cyanx/10 shadow-glow"
                  : "border-arena-line bg-arena-card hover:border-cyanx/60"
              }`}
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
                <span className="block truncate font-bold">
                  {r.nickname}
                  {r.isMine && (
                    <span className="ml-1.5 rounded border border-cyanx/50 px-1 py-0.5 text-[10px] font-bold text-cyanx">
                      你
                    </span>
                  )}
                </span>
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
    );
  };

  const boardPanel = (
    <section className="mt-6">
      <h2 className="h-x">排行榜</h2>
      <p className="mt-1 text-xs text-slate-500">
        {season ? `${season.name}｜` : ""}每組當季前 {LEADERBOARD_LIMIT} 名
      </p>
      <LeaderboardSwitch
        groups={(["normal", "open"] as const).map((cls) => ({
          cls,
          label: CLASS_LABEL[cls],
          content: (
            <>
              <MyStanding cls={cls} />
              <BoardList cls={cls} />
            </>
          ),
        }))}
      />
    </section>
  );

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

      {/* 進行中的對戰不分頁籤都要看得到——打到一半跑去看排名回不去是事故 */}
      {activeMatchId && (
        <Link
          href={`/ladder/match/${activeMatchId}`}
          className="mt-4 block rounded-xl border border-cyanx/50 bg-cyanx/10 px-4 py-3 text-sm font-bold text-cyanx"
        >
          ⚔️ 你有一場對戰還沒結束——點此回到現場
        </Link>
      )}

      <LadderTabs initialTab={tab} battle={battlePanel} board={boardPanel} />
    </main>
  );
}
