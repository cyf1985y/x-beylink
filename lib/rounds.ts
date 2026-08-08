import { SupabaseClient } from "@supabase/supabase-js";

/**
 * 逐回合紀錄（match_points）。賽事場與天梯場共用同一張表：
 * 賽事場帶 match_id、天梯場帶 ladder_match_id，兩者恰好一個非 null。
 *
 * 三種列：
 * - 得分列：side 1／2、points 1–3、finish_type 必填
 * - 犯規列：side 1／2、points −1、finish_type 為 null
 * - 重射列：side 0、points 0、reshoot_reason 必填
 */
export type DbMatchPoint = {
  id: string;
  side: number;
  points: number;
  finish_type: string | null;
  reshoot_reason: string | null;
  created_at: string;
};

export const ROUND_COLUMNS =
  "id,side,points,finish_type,reshoot_reason,created_at";

/** 由逐回合紀錄重算比分（負分為犯規扣分，最低 0） */
export function scoreOf(rows: Array<Pick<DbMatchPoint, "side" | "points">>): {
  s1: number;
  s2: number;
} {
  let s1 = 0;
  let s2 = 0;
  for (const r of rows) {
    if (r.side === 1) s1 += r.points;
    else if (r.side === 2) s2 += r.points;
    // side 0 是重射，不影響比分
  }
  return { s1: Math.max(0, s1), s2: Math.max(0, s2) };
}

async function loadRounds(
  db: SupabaseClient,
  column: "match_id" | "ladder_match_id",
  id: string
): Promise<DbMatchPoint[]> {
  const { data } = await db
    .from("match_points")
    .select(ROUND_COLUMNS)
    .eq(column, id)
    .order("created_at", { ascending: true })
    .returns<DbMatchPoint[]>();
  return data ?? [];
}

/** 賽事場的逐回合紀錄（依時間排序） */
export function loadEventRounds(db: SupabaseClient, matchId: string) {
  return loadRounds(db, "match_id", matchId);
}

/** 天梯場的逐回合紀錄（依時間排序） */
export function loadLadderRounds(db: SupabaseClient, ladderMatchId: string) {
  return loadRounds(db, "ladder_match_id", ladderMatchId);
}

/** 選手卡生涯數據：這位選手打出過幾次 Xtreme、幾次 Burst */
export type FinishStats = { xtreme: number; burst: number };

const COUNTED_FINISHES = ["xtreme", "burst"];

/** 把 match_points 依「該選手在那一場是哪一側」加總 */
async function countFinishes(
  db: SupabaseClient,
  column: "match_id" | "ladder_match_id",
  sideOf: Map<string, 1 | 2>,
  stats: FinishStats
) {
  const ids = [...sideOf.keys()];
  if (ids.length === 0) return;
  const { data } = await db
    .from("match_points")
    .select(`${column},side,finish_type`)
    .in(column, ids)
    .in("finish_type", COUNTED_FINISHES)
    .returns<
      Array<{ side: number; finish_type: string } & Record<string, string>>
    >();
  for (const row of data ?? []) {
    if (sideOf.get(row[column]) !== row.side) continue;
    if (row.finish_type === "xtreme") stats.xtreme += 1;
    else if (row.finish_type === "burst") stats.burst += 1;
  }
}

/**
 * 生涯結束方式統計。只算已結算的賽事（events.status = done）
 * 與已成立的天梯場（ladder_matches.status = confirmed），
 * 進行中的比分還可能被復原修正，不列入。
 */
export async function careerFinishStats(
  db: SupabaseClient,
  playerId: string
): Promise<FinishStats> {
  const stats: FinishStats = { xtreme: 0, burst: 0 };
  const orMine = `player1_id.eq.${playerId},player2_id.eq.${playerId}`;

  const [{ data: eventMatches }, { data: ladderMatches }] = await Promise.all([
    db
      .from("matches")
      .select("id,event_id,player1_id")
      .or(orMine)
      .returns<
        Array<{ id: string; event_id: string; player1_id: string | null }>
      >(),
    db
      .from("ladder_matches")
      .select("id,player_a")
      .eq("status", "confirmed")
      .or(`player_a.eq.${playerId},player_b.eq.${playerId}`)
      .returns<Array<{ id: string; player_a: string }>>(),
  ]);

  // 賽事場：只留已結算賽事的對戰
  const eventIds = Array.from(
    new Set((eventMatches ?? []).map((m) => m.event_id))
  );
  const { data: doneEvents } = eventIds.length
    ? await db
        .from("events")
        .select("id")
        .eq("status", "done")
        .in("id", eventIds)
        .returns<Array<{ id: string }>>()
    : { data: [] as Array<{ id: string }> };
  const doneIds = new Set((doneEvents ?? []).map((e) => e.id));

  const eventSide = new Map<string, 1 | 2>();
  for (const m of eventMatches ?? []) {
    if (!doneIds.has(m.event_id)) continue;
    eventSide.set(m.id, m.player1_id === playerId ? 1 : 2);
  }

  const ladderSide = new Map<string, 1 | 2>(
    (ladderMatches ?? []).map((m) => [
      m.id,
      m.player_a === playerId ? 1 : 2,
    ])
  );

  await Promise.all([
    countFinishes(db, "match_id", eventSide, stats),
    countFinishes(db, "ladder_match_id", ladderSide, stats),
  ]);
  return stats;
}
