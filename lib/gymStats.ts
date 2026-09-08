import { SupabaseClient } from "@supabase/supabase-js";
import { DbPlayer } from "@/lib/supabase";
import {
  DbLadderRating,
  LEADERBOARD_LIMIT,
  LadderClass,
  ladderClassOf,
  rankOf,
} from "@/lib/ladder";
import { GYM_BADGES, GymTally, earnedGymBadges } from "@/lib/badges";

/**
 * 道館成績。
 *
 * 全部由 ladder_matches 現算——每一場本來就記了 gym_id，所以館內排行榜與道館
 * 徽章都不需要新的記錄邏輯，而且回溯生效：過去打過的比賽立刻算得出來。
 */

/** 館內排行榜的一列 */
export type GymBoardRow = {
  playerId: string;
  nickname: string;
  avatar: string;
  rating: number;
  rankLabel: string;
  rankIcon: string;
  rankText: string;
  cls: LadderClass;
  /** 在這間道館的成績（附加資訊，不是排序依據） */
  matches: number;
  wins: number;
};

export type GymProfile = {
  /** 當月在這間道館打過的不重複選手數 */
  monthlyActive: number;
  /** 本季在這間道館打過的人，依全平台積分排序 */
  board: GymBoardRow[];
};

type MatchRow = {
  player_a: string;
  player_b: string;
  winner: string | null;
  confirmed_at: string | null;
};

/** 台北時間的當月起點（資料存 UTC，但「當月」要照台灣的月份算） */
function taipeiMonthStart(): Date {
  const taipei = new Date(Date.now() + 8 * 3600_000);
  return new Date(
    Date.UTC(taipei.getUTCFullYear(), taipei.getUTCMonth(), 1) - 8 * 3600_000
  );
}

/**
 * 館內排行榜與當月活躍人數。
 *
 * 排序依**全平台積分**而不是館內勝場：這個榜是給店家挑代表選手用的，
 * 代表要挑最強的；館內場次／勝場只當附加資訊顯示。
 */
export async function getGymProfile(
  db: SupabaseClient,
  gymId: string,
  seasonId: string
): Promise<GymProfile> {
  const { data: matches } = await db
    .from("ladder_matches")
    .select("player_a,player_b,winner,confirmed_at")
    .eq("gym_id", gymId)
    .eq("season_id", seasonId)
    .eq("status", "confirmed")
    .returns<MatchRow[]>();

  const rows = matches ?? [];
  const tally = new Map<string, { matches: number; wins: number }>();
  const monthStart = taipeiMonthStart();
  const activeThisMonth = new Set<string>();

  for (const m of rows) {
    const thisMonth =
      !!m.confirmed_at && new Date(m.confirmed_at) >= monthStart;
    for (const id of [m.player_a, m.player_b]) {
      const t = tally.get(id) ?? { matches: 0, wins: 0 };
      t.matches += 1;
      if (m.winner === id) t.wins += 1;
      tally.set(id, t);
      if (thisMonth) activeThisMonth.add(id);
    }
  }

  const ids = [...tally.keys()];
  if (ids.length === 0) return { monthlyActive: 0, board: [] };

  const [{ data: players }, { data: ratings }] = await Promise.all([
    db
      .from("players")
      .select("id,nickname,avatar,role")
      .in("id", ids)
      .returns<Array<Pick<DbPlayer, "id" | "nickname" | "avatar" | "role">>>(),
    db
      .from("ladder_ratings")
      .select("player_id,rating")
      .eq("season_id", seasonId)
      .in("player_id", ids)
      .returns<Array<Pick<DbLadderRating, "player_id" | "rating">>>(),
  ]);

  const ratingOf = new Map((ratings ?? []).map((r) => [r.player_id, r.rating]));

  const board = (players ?? [])
    .map((p) => {
      const t = tally.get(p.id) ?? { matches: 0, wins: 0 };
      const rating = ratingOf.get(p.id) ?? 1000;
      const rank = rankOf(rating);
      return {
        playerId: p.id,
        nickname: p.nickname,
        avatar: p.avatar ?? "🌀",
        rating,
        rankLabel: rank.label,
        rankIcon: rank.icon,
        rankText: rank.text,
        cls: ladderClassOf(p.role as "parent" | "child"),
        matches: t.matches,
        wins: t.wins,
      };
    })
    .sort((a, b) => b.rating - a.rating);

  return { monthlyActive: activeThisMonth.size, board };
}

/** 排行榜依組別切開，每組取前 LEADERBOARD_LIMIT 名 */
export function boardByClass(
  board: GymBoardRow[],
  cls: LadderClass
): GymBoardRow[] {
  return board.filter((r) => r.cls === cls).slice(0, LEADERBOARD_LIMIT);
}

/** 已取得的道館徽章（選手卡顯示用） */
export type EarnedBadge = {
  kind: string;
  label: string;
  icon: string;
  desc: string;
  gymId: string | null;
  gymName: string | null;
  earnedAt: string;
};

/**
 * 依這位選手目前的戰績補發應得的道館徽章。
 *
 * 冪等（重複發放由唯一鍵擋掉），所以在道館頁與選手卡載入時呼叫即可，
 * 不需要 cron，也不會因為某次沒跑到就漏發。
 */
export async function syncGymBadges(
  db: SupabaseClient,
  playerId: string
): Promise<void> {
  const { data: matches } = await db
    .from("ladder_matches")
    .select("gym_id,player_a,player_b,winner")
    .eq("status", "confirmed")
    .or(`player_a.eq.${playerId},player_b.eq.${playerId}`)
    .returns<Array<{ gym_id: string | null; winner: string | null }>>();

  const tally = new Map<string, GymTally>();
  for (const m of matches ?? []) {
    if (!m.gym_id) continue; // 沒有道館的比賽不算道館徽章
    const t =
      tally.get(m.gym_id) ??
      { gymId: m.gym_id, gymName: "", matches: 0, wins: 0 };
    t.matches += 1;
    if (m.winner === playerId) t.wins += 1;
    tally.set(m.gym_id, t);
  }

  const rows = [...tally.values()].flatMap((t) =>
    earnedGymBadges(t).map((b) => ({
      player_id: playerId,
      kind: b.kind,
      gym_id: t.gymId,
    }))
  );
  if (rows.length === 0) return;

  // 已經有的就跳過——earned_at 要保留「第一次達成」的時間，不能被覆蓋
  const { error } = await db
    .from("player_badges")
    .upsert(rows, { onConflict: "player_id,kind,gym_id", ignoreDuplicates: true });
  if (error) console.error("道館徽章補發失敗：", error.message);
}

/** 這位選手已收藏的徽章（含道館名稱） */
export async function getPlayerBadges(
  db: SupabaseClient,
  playerId: string
): Promise<EarnedBadge[]> {
  const { data } = await db
    .from("player_badges")
    .select("kind,gym_id,earned_at")
    .eq("player_id", playerId)
    .order("earned_at", { ascending: true })
    .returns<Array<{ kind: string; gym_id: string | null; earned_at: string }>>();

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const gymIds = [...new Set(rows.map((r) => r.gym_id).filter(Boolean))];
  const { data: gyms } = gymIds.length
    ? await db
        .from("gyms_public")
        .select("id,name")
        .in("id", gymIds as string[])
        .returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }> };
  const nameOf = new Map((gyms ?? []).map((g) => [g.id, g.name]));

  return rows.flatMap((r) => {
    const def = GYM_BADGES.find((b) => b.kind === r.kind);
    if (!def) return []; // 條件被移除的舊徽章：不顯示，但紀錄留著
    return [
      {
        kind: r.kind,
        label: def.label,
        icon: def.icon,
        desc: def.desc,
        gymId: r.gym_id,
        gymName: r.gym_id ? (nameOf.get(r.gym_id) ?? null) : null,
        earnedAt: r.earned_at,
      },
    ];
  });
}
