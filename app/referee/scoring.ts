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

export type ScoreResult = {
  ok: boolean;
  error?: string;
  score1?: number;
  score2?: number;
  winnerId?: string | null;
  winnerName?: string | null;
  winnerSide?: 1 | 2 | null;
};

/** 由計分紀錄重算比分（負分視為犯規扣分，最低 0） */
async function recompute(matchId: string): Promise<{ s1: number; s2: number }> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("match_points")
    .select("side,points")
    .eq("match_id", matchId)
    .returns<Array<{ side: number; points: number }>>();
  let s1 = 0;
  let s2 = 0;
  for (const r of data ?? []) {
    if (r.side === 1) s1 += r.points;
    else s2 += r.points;
  }
  return { s1: Math.max(0, s1), s2: Math.max(0, s2) };
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

/**
 * 記一次得分：Spin +1、Over/Burst +2、Xtreme +3；犯規扣分傳 -1。
 * 每筆都寫入 match_points 紀錄，因此可精準「復原上一筆」，且換裝置也不會丟。
 */
export async function addPoint(
  eventId: string,
  matchId: string,
  side: 1 | 2,
  points: number
): Promise<ScoreResult> {
  if (![1, 2, 3, -1].includes(points)) {
    return { ok: false, error: "得分不正確" };
  }
  const auth = await requireScorer(eventId);
  if (auth.error || !auth.event) return { ok: false, error: auth.error };
  if (auth.event.status === "done") {
    return { ok: false, error: "賽事已結算，成績已鎖定" };
  }

  const db = supabaseAdmin();
  const matches = await loadMatches(db, eventId);
  const match = matches.find((m) => m.id === matchId);
  if (!match) return { ok: false, error: "找不到這場對戰" };
  if (match.winner_id && points > 0) {
    return { ok: false, error: "本場已分出勝負（可按復原修正）" };
  }
  const playerId = side === 1 ? match.player1_id : match.player2_id;
  if (!playerId) return { ok: false, error: "這一側還沒有選手" };

  const session = await getSession();
  await db.from("match_points").insert({
    match_id: matchId,
    side,
    points,
    created_by: session?.uid ?? null,
  });

  const { s1, s2 } = await recompute(matchId);
  const result = await syncMatch(match, matches, s1, s2);

  revalidatePath(`/referee/event/${eventId}`);
  revalidatePath(`/host/event/${eventId}/bracket`);
  revalidatePath(`/event/${eventId}/bracket`);
  return result;
}

/** 復原上一筆計分（精準還原該筆分數，含誤判的獲勝晉級） */
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
  const { s1, s2 } = await recompute(matchId);
  const result = await syncMatch(match, matches, s1, s2);

  revalidatePath(`/referee/event/${eventId}`);
  revalidatePath(`/host/event/${eventId}/bracket`);
  revalidatePath(`/event/${eventId}/bracket`);
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
