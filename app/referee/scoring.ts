"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { requireScorer } from "@/lib/scorer";
import {
  WIN_POINTS,
  loadMatches,
  applyWinner,
  undoWinner,
  DbMatch,
} from "@/lib/bracket";
import {
  RESHOOT_SIDE,
  finishPoints,
  isFinishType,
  isReshootReason,
  scoreFromRounds,
  toRoundEntries,
  type FinishType,
  type PointRow,
  type ReshootReason,
  type RoundEntry,
} from "@/lib/finish";

export type ScoreResult = {
  ok: boolean;
  error?: string;
  score1?: number;
  score2?: number;
  winnerId?: string | null;
  winnerName?: string | null;
  winnerSide?: 1 | 2 | null;
  /** 逐回合紀錄（時間軸用），操作後一併回傳免去再查一次 */
  rounds?: RoundEntry[];
};

const ROW_COLS = "id,side,points,finish_type,reshoot_reason,created_at";

/** 讀取該場的逐回合紀錄（依 created_at 排序＝實際按鍵順序） */
async function loadRounds(matchId: string): Promise<RoundEntry[]> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("match_points")
    .select(ROW_COLS)
    .eq("match_id", matchId)
    .order("created_at", { ascending: true })
    .returns<PointRow[]>();
  return toRoundEntries(data ?? []);
}

async function syncMatch(
  match: DbMatch,
  matches: DbMatch[],
  s1: number,
  s2: number
): Promise<ScoreResult> {
  const db = supabaseAdmin();
  await db.from("matches").update({ score1: s1, score2: s2 }).eq("id", match.id);

  const p1 = match.player1_id;
  const p2 = match.player2_id;
  let winnerId: string | null = null;
  let winnerSide: 1 | 2 | null = null;

  // 先取 4 分者獲勝（WIN_POINTS 為業務規則，不可調整）
  if (s1 >= WIN_POINTS && p1) {
    winnerId = p1;
    winnerSide = 1;
  } else if (s2 >= WIN_POINTS && p2) {
    winnerId = p2;
    winnerSide = 2;
  }

  if (winnerId && match.winner_id !== winnerId) {
    const err = await applyWinner(db, matches, match, winnerId);
    if (err) return { ok: false, error: err };
  } else if (!winnerId && match.winner_id) {
    const err = await undoWinner(db, matches, match);
    if (err) return { ok: false, error: err };
  }

  let winnerName: string | null = null;
  if (winnerId) {
    const { data } = await db
      .from("players")
      .select("nickname")
      .eq("id", winnerId)
      .maybeSingle<{ nickname: string }>();
    winnerName = data?.nickname ?? null;
  }

  return { ok: true, score1: s1, score2: s2, winnerId, winnerName, winnerSide };
}

type NewRow = {
  side: 1 | 2;
  points: number;
  finish_type: FinishType | null;
  reshoot_reason: ReshootReason | null;
};

/**
 * 寫入一列 match_points 並重算比分。
 *
 * 得分／扣分／重射都走這裡，因此「復原上一筆」可以精準還原任何一種操作，
 * 換裝置也不會丟（比分永遠由紀錄重算，不是累加在畫面上）。
 */
async function record(
  eventId: string,
  matchId: string,
  row: NewRow
): Promise<ScoreResult> {
  const auth = await requireScorer(eventId);
  if (auth.error || !auth.event) return { ok: false, error: auth.error };
  if (auth.event.status === "done") {
    return { ok: false, error: "賽事已結算，成績已鎖定" };
  }

  const db = supabaseAdmin();
  const matches = await loadMatches(db, eventId);
  const match = matches.find((m) => m.id === matchId);
  if (!match) return { ok: false, error: "找不到這場對戰" };
  // 已分勝負後只剩「犯規扣分」與「復原」可修正誤判
  if (match.winner_id && row.points >= 0) {
    return { ok: false, error: "本場已分出勝負（可按復原修正）" };
  }
  // 重射不歸屬任何一側；得分／扣分才需要該側真的有選手
  if (!row.reshoot_reason) {
    const playerId = row.side === 1 ? match.player1_id : match.player2_id;
    if (!playerId) return { ok: false, error: "這一側還沒有選手" };
  }

  const session = await getSession();
  const { error: insertError } = await db.from("match_points").insert({
    match_id: matchId,
    side: row.side,
    points: row.points,
    finish_type: row.finish_type,
    reshoot_reason: row.reshoot_reason,
    created_by: session?.uid ?? null,
  });
  if (insertError) return { ok: false, error: "寫入計分紀錄失敗，請再試一次" };

  return finish(eventId, matchId, match, matches);
}

/** 重算 → 同步對戰表 → 回傳最新比分與時間軸 */
async function finish(
  eventId: string,
  matchId: string,
  match: DbMatch,
  matches: DbMatch[]
): Promise<ScoreResult> {
  const rounds = await loadRounds(matchId);
  const { s1, s2 } = scoreFromRounds(rounds);
  const result = await syncMatch(match, matches, s1, s2);

  revalidatePath(`/referee/event/${eventId}`);
  revalidatePath(`/referee/event/${eventId}/match/${matchId}`);
  revalidatePath(`/host/event/${eventId}/bracket`);
  revalidatePath(`/event/${eventId}/bracket`);
  return { ...result, rounds };
}

/** 記一次得分：分數一律由結束方式推導（spin 1／over 2／burst 2／xtreme 3） */
export async function addFinish(
  eventId: string,
  matchId: string,
  side: 1 | 2,
  finishType: FinishType
): Promise<ScoreResult> {
  if (!isFinishType(finishType)) {
    return { ok: false, error: "結束方式不正確" };
  }
  if (side !== 1 && side !== 2) return { ok: false, error: "得分方不正確" };
  return record(eventId, matchId, {
    side,
    points: finishPoints(finishType),
    finish_type: finishType,
    reshoot_reason: null,
  });
}

/** 犯規扣分 −1（不是結束方式，finish_type 留 null） */
export async function addFoul(
  eventId: string,
  matchId: string,
  side: 1 | 2
): Promise<ScoreResult> {
  if (side !== 1 && side !== 2) return { ok: false, error: "扣分方不正確" };
  return record(eventId, matchId, {
    side,
    points: -1,
    finish_type: null,
    reshoot_reason: null,
  });
}

/** 重射：寫入一列 points = 0 的紀錄，比分不動 */
export async function addReshoot(
  eventId: string,
  matchId: string,
  reason: ReshootReason
): Promise<ScoreResult> {
  if (!isReshootReason(reason)) return { ok: false, error: "重射事由不正確" };
  return record(eventId, matchId, {
    side: RESHOOT_SIDE,
    points: 0,
    finish_type: null,
    reshoot_reason: reason,
  });
}

/** 復原上一筆紀錄（得分、扣分或重射皆可，含誤判的獲勝晉級） */
export async function undoLastPoint(
  eventId: string,
  matchId: string
): Promise<ScoreResult> {
  const auth = await requireScorer(eventId);
  if (auth.error || !auth.event) return { ok: false, error: auth.error };
  if (auth.event.status === "done") {
    return { ok: false, error: "賽事已結算，成績已鎖定" };
  }

  const db = supabaseAdmin();
  const matches = await loadMatches(db, eventId);
  const match = matches.find((m) => m.id === matchId);
  if (!match) return { ok: false, error: "找不到這場對戰" };

  const { data: last } = await db
    .from("match_points")
    .select("id")
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!last) return { ok: false, error: "沒有可復原的計分紀錄" };

  await db.from("match_points").delete().eq("id", last.id);
  return finish(eventId, matchId, match, matches);
}

/**
 * 讀取單場即時比分（計分板輪詢用）。
 * 計分板模式不畫時間軸，這裡刻意不撈回合紀錄——每幾秒輪詢一次，能省則省。
 */
export async function getMatchScore(matchId: string): Promise<{
  score1: number;
  score2: number;
  winnerId: string | null;
} | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("matches")
    .select("score1,score2,winner_id")
    .eq("id", matchId)
    .maybeSingle<{ score1: number; score2: number; winner_id: string | null }>();
  if (!data) return null;
  return {
    score1: data.score1,
    score2: data.score2,
    winnerId: data.winner_id,
  };
}

/** 對戰頁初次渲染用的回合紀錄 */
export async function getMatchRounds(matchId: string): Promise<RoundEntry[]> {
  return loadRounds(matchId);
}
