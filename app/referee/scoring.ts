"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireScorer } from "@/lib/scorer";
import {
  WIN_POINTS,
  loadMatches,
  applyWinner,
  undoWinner,
} from "@/lib/bracket";

export type ScoreResult = {
  ok: boolean;
  error?: string;
  score1?: number;
  score2?: number;
  winnerId?: string | null;
};

/**
 * 記一次得分（BEYBLADE X）：Spin +1、Over/Burst +2、Xtreme +3。
 * 累積達 4 分自動判定獲勝並晉級。
 */
export async function addPoint(
  eventId: string,
  matchId: string,
  side: 1 | 2,
  points: number
): Promise<ScoreResult> {
  if (![1, 2, 3].includes(points)) {
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
  if (match.winner_id) return { ok: false, error: "本場已分出勝負" };
  const playerId = side === 1 ? match.player1_id : match.player2_id;
  if (!playerId) return { ok: false, error: "這一側還沒有選手" };

  const score1 = side === 1 ? match.score1 + points : match.score1;
  const score2 = side === 2 ? match.score2 + points : match.score2;
  await db.from("matches").update({ score1, score2 }).eq("id", matchId);

  // 達 4 分自動獲勝並晉級
  let winnerId: string | null = null;
  const mine = side === 1 ? score1 : score2;
  if (mine >= WIN_POINTS) {
    const err = await applyWinner(db, matches, match, playerId);
    if (err) return { ok: false, error: err };
    winnerId = playerId;
  }

  revalidatePath(`/referee/event/${eventId}`);
  revalidatePath(`/host/event/${eventId}/bracket`);
  revalidatePath(`/event/${eventId}/bracket`);
  return { ok: true, score1, score2, winnerId };
}

/** 犯規／誤按復原：該側 −1 分（最低 0）；若因此低於 4 分則撤銷勝負與晉級 */
export async function subPoint(
  eventId: string,
  matchId: string,
  side: 1 | 2
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

  const current = side === 1 ? match.score1 : match.score2;
  const next = Math.max(0, current - 1);
  const playerId = side === 1 ? match.player1_id : match.player2_id;

  // 已判定獲勝但扣分後不足 4 分 → 先撤銷晉級
  if (match.winner_id && match.winner_id === playerId && next < WIN_POINTS) {
    const err = await undoWinner(db, matches, match);
    if (err) return { ok: false, error: err };
  }

  const score1 = side === 1 ? next : match.score1;
  const score2 = side === 2 ? next : match.score2;
  await db.from("matches").update({ score1, score2 }).eq("id", matchId);

  revalidatePath(`/referee/event/${eventId}`);
  revalidatePath(`/host/event/${eventId}/bracket`);
  revalidatePath(`/event/${eventId}/bracket`);
  return { ok: true, score1, score2, winnerId: null };
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
