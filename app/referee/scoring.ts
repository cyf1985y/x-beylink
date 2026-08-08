"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { requireScorer } from "@/lib/scorer";
import {
  WIN_POINTS,
  FINISH_POINTS,
  isFinishType,
  isReshootReason,
  loadMatches,
  applyWinner,
  undoWinner,
  DbMatch,
  type FinishType,
  type ReshootReason,
} from "@/lib/bracket";
import {
  loadEventRounds,
  scoreOf,
  type DbMatchPoint,
} from "@/lib/rounds";

export type ScoreResult = {
  ok: boolean;
  error?: string;
  score1?: number;
  score2?: number;
  winnerId?: string | null;
  winnerName?: string | null;
  winnerSide?: 1 | 2 | null;
  /** 逐回合紀錄（時間軸用），依 created_at 排序 */
  rounds?: DbMatchPoint[];
};

/**
 * 由逐回合紀錄重算比分、寫回 matches，並處理晉級／撤銷晉級。
 * 回傳最新比分與回合列（時間軸直接用這份，不必再多跑一趟）。
 */
async function syncMatch(
  match: DbMatch,
  matches: DbMatch[]
): Promise<ScoreResult> {
  const db = supabaseAdmin();
  const rounds = await loadEventRounds(db, match.id);
  const { s1, s2 } = scoreOf(rounds);
  await db.from("matches").update({ score1: s1, score2: s2 }).eq("id", match.id);

  const p1 = match.player1_id;
  const p2 = match.player2_id;
  let winnerId: string | null = null;
  let winnerSide: 1 | 2 | null = null;

  if (s1 >= WIN_POINTS && p1) {
    winnerId = p1;
    winnerSide = 1;
  } else if (s2 >= WIN_POINTS && p2) {
    winnerId = p2;
    winnerSide = 2;
  }

  if (winnerId && match.winner_id !== winnerId) {
    const err = await applyWinner(db, matches, match, winnerId);
    if (err) return { ok: false, error: err, rounds };
  } else if (!winnerId && match.winner_id) {
    const err = await undoWinner(db, matches, match);
    if (err) return { ok: false, error: err, rounds };
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

  return {
    ok: true,
    score1: s1,
    score2: s2,
    winnerId,
    winnerName,
    winnerSide,
    rounds,
  };
}

/** 共用前置檢查：記分權限、賽事未鎖定、找得到這場對戰 */
async function prepare(
  eventId: string,
  matchId: string
): Promise<
  | { ok: false; error: string }
  | { ok: true; match: DbMatch; matches: DbMatch[] }
> {
  const auth = await requireScorer(eventId);
  if (auth.error || !auth.event) {
    return { ok: false, error: auth.error ?? "沒有記分權限" };
  }
  if (auth.event.status === "done") {
    return { ok: false, error: "賽事已結算，成績已鎖定" };
  }
  const db = supabaseAdmin();
  const matches = await loadMatches(db, eventId);
  const match = matches.find((m) => m.id === matchId);
  if (!match) return { ok: false, error: "找不到這場對戰" };
  return { ok: true, match, matches };
}

function revalidateEvent(eventId: string) {
  revalidatePath(`/referee/event/${eventId}`);
  revalidatePath(`/host/event/${eventId}/bracket`);
  revalidatePath(`/event/${eventId}/bracket`);
}

/**
 * 記一次得分：Spin +1、Over +2、Burst +2、Xtreme +3。
 * 每筆都寫入 match_points（含結束方式），因此可精準「復原上一筆」，
 * 換裝置也不會丟，事後還能算出 Xtreme 率、Burst 次數。
 */
export async function addFinish(
  eventId: string,
  matchId: string,
  side: 1 | 2,
  finish: FinishType
): Promise<ScoreResult> {
  if (!isFinishType(finish)) return { ok: false, error: "結束方式不正確" };
  if (side !== 1 && side !== 2) return { ok: false, error: "計分方不正確" };

  const p = await prepare(eventId, matchId);
  if (!p.ok) return { ok: false, error: p.error };
  const { match, matches } = p;

  if (match.winner_id) {
    return { ok: false, error: "本場已分出勝負（可按復原修正）" };
  }
  const playerId = side === 1 ? match.player1_id : match.player2_id;
  if (!playerId) return { ok: false, error: "這一側還沒有選手" };

  const db = supabaseAdmin();
  const session = await getSession();
  await db.from("match_points").insert({
    match_id: matchId,
    side,
    points: FINISH_POINTS[finish],
    finish_type: finish,
    created_by: session?.uid ?? null,
  });

  const result = await syncMatch(match, matches);
  revalidateEvent(eventId);
  return result;
}

/** 犯規扣分 −1（不是一種結束方式，finish_type 留 null） */
export async function addPenalty(
  eventId: string,
  matchId: string,
  side: 1 | 2
): Promise<ScoreResult> {
  if (side !== 1 && side !== 2) return { ok: false, error: "計分方不正確" };

  const p = await prepare(eventId, matchId);
  if (!p.ok) return { ok: false, error: p.error };
  const { match, matches } = p;

  const playerId = side === 1 ? match.player1_id : match.player2_id;
  if (!playerId) return { ok: false, error: "這一側還沒有選手" };

  const db = supabaseAdmin();
  const session = await getSession();
  await db.from("match_points").insert({
    match_id: matchId,
    side,
    points: -1,
    created_by: session?.uid ?? null,
  });

  const result = await syncMatch(match, matches);
  revalidateEvent(eventId);
  return result;
}

/**
 * 重射：發射失誤、同時停止、三秒內無接觸自摔⋯⋯官方規則要求不計分重來。
 * 寫入 points=0／side=0／reshoot_reason，比分不動，但紀錄上看得出發生過。
 */
export async function addReshoot(
  eventId: string,
  matchId: string,
  reason: ReshootReason
): Promise<ScoreResult> {
  if (!isReshootReason(reason)) return { ok: false, error: "重射原因不正確" };

  const p = await prepare(eventId, matchId);
  if (!p.ok) return { ok: false, error: p.error };
  const { match, matches } = p;

  if (match.winner_id) {
    return { ok: false, error: "本場已分出勝負（可按復原修正）" };
  }

  const db = supabaseAdmin();
  const session = await getSession();
  await db.from("match_points").insert({
    match_id: matchId,
    side: 0,
    points: 0,
    reshoot_reason: reason,
    created_by: session?.uid ?? null,
  });

  const result = await syncMatch(match, matches);
  revalidateEvent(eventId);
  return result;
}

/**
 * 復原上一筆紀錄（得分、犯規或重射都算一筆），含誤判的獲勝晉級。
 * 實際刪掉那一列，所以回合時間軸也會跟著少一筆。
 */
export async function undoLastPoint(
  eventId: string,
  matchId: string
): Promise<ScoreResult> {
  const p = await prepare(eventId, matchId);
  if (!p.ok) return { ok: false, error: p.error };
  const { match, matches } = p;

  const db = supabaseAdmin();
  const { data: last } = await db
    .from("match_points")
    .select("id")
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!last) return { ok: false, error: "沒有可復原的計分紀錄" };

  await db.from("match_points").delete().eq("id", last.id);
  const result = await syncMatch(match, matches);
  revalidateEvent(eventId);
  return result;
}

/** 讀取單場即時比分（計分板輪詢用） */
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
