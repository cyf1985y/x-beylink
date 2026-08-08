"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { DbLadderMatch } from "@/lib/ladder";
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

/**
 * 天梯的逐回合計分。
 *
 * 天梯的回合與賽事場共用 match_points，差別只在指向 ladder_match_id
 * （DB 的 CHECK 保證 match_id 與 ladder_match_id 恰好一個非 null）。
 * 積分一律由 ladder_confirm_result 計算，這裡只寫回合、不碰任何 Elo。
 */

export type LadderScoreResult = {
  ok: boolean;
  error?: string;
  scoreA?: number;
  scoreB?: number;
  rounds?: RoundEntry[];
};

const ROW_COLS = "id,side,points,finish_type,reshoot_reason,created_at";

/** side 1 = player_a（藍方）、side 2 = player_b（紅方） */
async function loadRounds(matchId: string): Promise<RoundEntry[]> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("match_points")
    .select(ROW_COLS)
    .eq("ladder_match_id", matchId)
    .order("created_at", { ascending: true })
    .returns<PointRow[]>();
  return toRoundEntries(data ?? []);
}

/** 只有這場的兩位選手本人能計分，且限對戰進行中 */
async function requireLadderScorer(
  matchId: string,
  playerId: string
): Promise<{ error?: string; match?: DbLadderMatch }> {
  const session = await getSession();
  if (!session) return { error: "請先登入" };

  const db = supabaseAdmin();
  const { data: mine } = await db
    .from("players")
    .select("id")
    .eq("id", playerId)
    .eq("user_id", session.uid)
    .maybeSingle<{ id: string }>();
  if (!mine) return { error: "這不是你的選手" };

  const { data: match } = await db
    .from("ladder_matches")
    .select("*")
    .eq("id", matchId)
    .maybeSingle<DbLadderMatch>();
  if (!match) return { error: "找不到這場對戰" };
  if (match.player_a !== playerId && match.player_b !== playerId) {
    return { error: "你不是這場的選手" };
  }
  if (match.status !== "playing") {
    return { error: "這場對戰已經回報，無法再計分" };
  }
  return { match };
}

type NewRow = {
  side: 1 | 2;
  points: number;
  finish_type: FinishType | null;
  reshoot_reason: ReshootReason | null;
};

async function record(
  matchId: string,
  playerId: string,
  row: NewRow
): Promise<LadderScoreResult> {
  const auth = await requireLadderScorer(matchId, playerId);
  if (auth.error) return { ok: false, error: auth.error };

  const db = supabaseAdmin();
  const session = await getSession();
  const { error: insertError } = await db.from("match_points").insert({
    ladder_match_id: matchId,
    side: row.side,
    points: row.points,
    finish_type: row.finish_type,
    reshoot_reason: row.reshoot_reason,
    created_by: session?.uid ?? null,
  });
  if (insertError) return { ok: false, error: "寫入回合紀錄失敗，請再試一次" };

  return snapshot(matchId);
}

async function snapshot(matchId: string): Promise<LadderScoreResult> {
  const rounds = await loadRounds(matchId);
  const { s1, s2 } = scoreFromRounds(rounds);
  revalidatePath(`/ladder/match/${matchId}`);
  return { ok: true, scoreA: s1, scoreB: s2, rounds };
}

/** 記一次得分：分數由結束方式推導，不信任前端 */
export async function addLadderFinish(
  matchId: string,
  playerId: string,
  side: 1 | 2,
  finishType: FinishType
): Promise<LadderScoreResult> {
  if (!isFinishType(finishType)) return { ok: false, error: "結束方式不正確" };
  if (side !== 1 && side !== 2) return { ok: false, error: "得分方不正確" };
  return record(matchId, playerId, {
    side,
    points: finishPoints(finishType),
    finish_type: finishType,
    reshoot_reason: null,
  });
}

/** 犯規扣分 −1 */
export async function addLadderFoul(
  matchId: string,
  playerId: string,
  side: 1 | 2
): Promise<LadderScoreResult> {
  if (side !== 1 && side !== 2) return { ok: false, error: "扣分方不正確" };
  return record(matchId, playerId, {
    side,
    points: -1,
    finish_type: null,
    reshoot_reason: null,
  });
}

/** 重射：points = 0，比分不動 */
export async function addLadderReshoot(
  matchId: string,
  playerId: string,
  reason: ReshootReason
): Promise<LadderScoreResult> {
  if (!isReshootReason(reason)) return { ok: false, error: "重射事由不正確" };
  return record(matchId, playerId, {
    side: RESHOOT_SIDE,
    points: 0,
    finish_type: null,
    reshoot_reason: reason,
  });
}

/** 復原上一筆回合紀錄 */
export async function undoLadderRound(
  matchId: string,
  playerId: string
): Promise<LadderScoreResult> {
  const auth = await requireLadderScorer(matchId, playerId);
  if (auth.error) return { ok: false, error: auth.error };

  const db = supabaseAdmin();
  const { data: last } = await db
    .from("match_points")
    .select("id")
    .eq("ladder_match_id", matchId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!last) return { ok: false, error: "沒有可復原的回合紀錄" };

  await db.from("match_points").delete().eq("id", last.id);
  return snapshot(matchId);
}

/** 歸零重來：清掉這場的所有回合紀錄 */
export async function resetLadderRounds(
  matchId: string,
  playerId: string
): Promise<LadderScoreResult> {
  const auth = await requireLadderScorer(matchId, playerId);
  if (auth.error) return { ok: false, error: auth.error };

  const db = supabaseAdmin();
  await db.from("match_points").delete().eq("ladder_match_id", matchId);
  return snapshot(matchId);
}

/** 對戰頁初次渲染用 */
export async function getLadderRounds(matchId: string): Promise<RoundEntry[]> {
  return loadRounds(matchId);
}
