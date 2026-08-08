"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import {
  DbGymPublic,
  DbLadderMatch,
  DbLadderRating,
  ladderErrorMessage,
  ladderRpc,
  activeSeason,
  rankOf,
} from "@/lib/ladder";

export type LadderResult = {
  ok: boolean;
  error?: string;
  message?: string;
  /** ladder_challenge 成功時回傳新對戰 id */
  matchId?: string;
};

/**
 * 取用選手前的擁有權檢查（本專案採自訂登入，擁有權一律在程式碼層驗）。
 */
async function requireMyPlayer(
  playerId: string
): Promise<{ player?: DbPlayer; error?: string }> {
  const session = await getSession();
  if (!session) return { error: "請先登入" };
  const db = supabaseAdmin();
  const { data } = await db
    .from("players")
    .select("*")
    .eq("id", playerId)
    .eq("user_id", session.uid)
    .maybeSingle<DbPlayer>();
  if (!data) return { error: "這不是你的選手" };
  return { player: data };
}

async function myPlayers(): Promise<DbPlayer[]> {
  const session = await getSession();
  if (!session) return [];
  const db = supabaseAdmin();
  const { data } = await db
    .from("players")
    .select("*")
    .eq("user_id", session.uid)
    .order("created_at", { ascending: true })
    .returns<DbPlayer[]>();
  return data ?? [];
}

/* --------------------------------- 進道館 --------------------------------- */

/**
 * 進入道館。
 *
 * lat／lng 由瀏覽器一次性取得後直接當參數傳進 RPC，
 * 全程不寫 log、不存表、不放進 URL——這是天梯 M1 的硬性要求。
 */
export async function enterGym(
  gymId: string,
  playerId: string,
  lat: number,
  lng: number
): Promise<LadderResult> {
  const mine = await requireMyPlayer(playerId);
  if (mine.error) return { ok: false, error: mine.error };

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: "無法取得你的位置，請允許定位後再試一次" };
  }

  const db = supabaseAdmin();
  const { data: gym } = await db
    .from("gyms_public")
    .select("*")
    .eq("id", gymId)
    .maybeSingle<DbGymPublic>();
  if (!gym) return { ok: false, error: "找不到這座道館" };

  const res = await ladderRpc(db, "ladder_enter_gym", {
    p_gym_id: gymId,
    p_player_id: playerId,
    p_lat: lat,
    p_lng: lng,
  });
  if (!res.ok) {
    return {
      ok: false,
      error: ladderErrorMessage(res.error_code, { radiusM: gym.radius_m }),
    };
  }

  revalidatePath(`/ladder/gym/${gymId}`);
  return { ok: true, message: `已進入${gym.name}，可以開始接受挑戰了` };
}

/* ---------------------------------- 挑戰 ---------------------------------- */

export async function challenge(
  gymId: string,
  challengerId: string,
  opponentId: string
): Promise<LadderResult> {
  const mine = await requireMyPlayer(challengerId);
  if (mine.error) return { ok: false, error: mine.error };

  const db = supabaseAdmin();
  const res = await ladderRpc(db, "ladder_challenge", {
    p_gym_id: gymId,
    p_challenger: challengerId,
    p_opponent: opponentId,
  });
  if (!res.ok) {
    return { ok: false, error: ladderErrorMessage(res.error_code) };
  }

  revalidatePath(`/ladder/gym/${gymId}`);
  return { ok: true, matchId: res.new_match_id ?? undefined };
}

/* -------------------------------- 回報／確認 ------------------------------- */

export async function reportResult(
  matchId: string,
  playerId: string,
  scoreA: number,
  scoreB: number
): Promise<LadderResult> {
  const mine = await requireMyPlayer(playerId);
  if (mine.error) return { ok: false, error: mine.error };

  if (
    !Number.isInteger(scoreA) ||
    !Number.isInteger(scoreB) ||
    scoreA < 0 ||
    scoreB < 0 ||
    scoreA === scoreB
  ) {
    return { ok: false, error: "比分不正確：不可相同、也不可為負" };
  }

  const db = supabaseAdmin();
  const res = await ladderRpc(db, "ladder_report_result", {
    p_match_id: matchId,
    p_reporter: playerId,
    p_score_a: scoreA,
    p_score_b: scoreB,
  });
  if (!res.ok) {
    return { ok: false, error: ladderErrorMessage(res.error_code) };
  }

  revalidatePath(`/ladder/match/${matchId}`);
  return { ok: true, message: "已回報，等待對手確認" };
}

/**
 * 敗方確認結果 → 積分由 ladder_confirm_result 計算（應用層絕不自行算 Elo）。
 */
export async function confirmResult(
  matchId: string,
  playerId: string
): Promise<LadderResult> {
  const mine = await requireMyPlayer(playerId);
  if (mine.error) return { ok: false, error: mine.error };

  const db = supabaseAdmin();
  const res = await ladderRpc(db, "ladder_confirm_result", {
    p_match_id: matchId,
    p_confirmer: playerId,
  });
  if (!res.ok) {
    return { ok: false, error: ladderErrorMessage(res.error_code) };
  }

  revalidatePath(`/ladder/match/${matchId}`);
  revalidatePath("/ladder");
  return { ok: true, message: "結果已成立，積分已更新" };
}

export async function disputeResult(
  matchId: string,
  playerId: string
): Promise<LadderResult> {
  const mine = await requireMyPlayer(playerId);
  if (mine.error) return { ok: false, error: mine.error };

  const db = supabaseAdmin();
  const res = await ladderRpc(db, "ladder_dispute", {
    p_match_id: matchId,
    p_player: playerId,
  });
  if (!res.ok) {
    return { ok: false, error: ladderErrorMessage(res.error_code) };
  }

  revalidatePath(`/ladder/match/${matchId}`);
  return { ok: true, message: "已標記為有爭議，請找現場主辦方協助" };
}

/* --------------------------------- 輪詢讀取 -------------------------------- */

export type RosterEntry = {
  playerId: string;
  nickname: string;
  avatar: string;
  rating: number;
  rankLabel: string;
  rankIcon: string;
  rankText: string;
  isMine: boolean;
  expiresAt: string;
};

export type GymState = {
  roster: RosterEntry[];
  /** 我目前在場的選手 id → 進場到期時間 */
  myPresence: Array<{ playerId: string; expiresAt: string }>;
  /** 進行中／待確認的對戰，供重整後回到現場 */
  activeMatchId: string | null;
};

/** 道館即時狀態（10 秒輪詢） */
export async function getGymState(gymId: string): Promise<GymState> {
  const db = supabaseAdmin();
  const mine = await myPlayers();
  const myIds = new Set(mine.map((p) => p.id));

  const { data: presence } = await db
    .from("ladder_gym_presence")
    .select("player_id,expires_at")
    .eq("gym_id", gymId)
    .gt("expires_at", new Date().toISOString())
    .returns<Array<{ player_id: string; expires_at: string }>>();

  const ids = (presence ?? []).map((p) => p.player_id);
  if (ids.length === 0) {
    return { roster: [], myPresence: [], activeMatchId: null };
  }

  const season = await activeSeason(db);
  const [{ data: players }, { data: ratings }] = await Promise.all([
    db
      .from("players")
      .select("id,nickname,avatar")
      .in("id", ids)
      .returns<Array<Pick<DbPlayer, "id" | "nickname" | "avatar">>>(),
    season
      ? db
          .from("ladder_ratings")
          .select("player_id,rating")
          .eq("season_id", season.id)
          .in("player_id", ids)
          .returns<Array<Pick<DbLadderRating, "player_id" | "rating">>>()
      : Promise.resolve({
          data: [] as Array<Pick<DbLadderRating, "player_id" | "rating">>,
        }),
  ]);

  const ratingOf = new Map((ratings ?? []).map((r) => [r.player_id, r.rating]));
  const playerOf = new Map((players ?? []).map((p) => [p.id, p]));

  const roster: RosterEntry[] = (presence ?? [])
    .map((pr) => {
      const p = playerOf.get(pr.player_id);
      if (!p) return null;
      const rating = ratingOf.get(pr.player_id) ?? 1000;
      const rank = rankOf(rating);
      return {
        playerId: p.id,
        nickname: p.nickname,
        avatar: p.avatar,
        rating,
        rankLabel: rank.label,
        rankIcon: rank.icon,
        rankText: rank.text,
        isMine: myIds.has(p.id),
        expiresAt: pr.expires_at,
      };
    })
    .filter((x): x is RosterEntry => x !== null)
    .sort((a, b) => b.rating - a.rating);

  return {
    roster,
    myPresence: (presence ?? [])
      .filter((p) => myIds.has(p.player_id))
      .map((p) => ({ playerId: p.player_id, expiresAt: p.expires_at })),
    activeMatchId: await findActiveMatchId(mine.map((p) => p.id)),
  };
}

/** 我尚未結束的天梯對戰（重整後回到現場用） */
export async function findActiveMatchId(
  playerIds: string[]
): Promise<string | null> {
  if (playerIds.length === 0) return null;
  const db = supabaseAdmin();
  const live = ["playing", "pending_confirm"];
  const [{ data: asA }, { data: asB }] = await Promise.all([
    db
      .from("ladder_matches")
      .select("id,created_at")
      .in("status", live)
      .in("player_a", playerIds)
      .returns<Array<{ id: string; created_at: string }>>(),
    db
      .from("ladder_matches")
      .select("id,created_at")
      .in("status", live)
      .in("player_b", playerIds)
      .returns<Array<{ id: string; created_at: string }>>(),
  ]);
  const all = [...(asA ?? []), ...(asB ?? [])].sort((x, y) =>
    x.created_at < y.created_at ? 1 : -1
  );
  return all[0]?.id ?? null;
}

export type MatchState = {
  status: DbLadderMatch["status"];
  scoreA: number | null;
  scoreB: number | null;
  winner: string | null;
  deltaA: number | null;
  deltaB: number | null;
  reportedBy: string | null;
  /** 結算後雙方最新積分 */
  ratingA: number | null;
  ratingB: number | null;
};

/** 對戰即時狀態（對戰頁輪詢） */
export async function getMatchState(matchId: string): Promise<MatchState | null> {
  const db = supabaseAdmin();
  const { data: m } = await db
    .from("ladder_matches")
    .select("*")
    .eq("id", matchId)
    .maybeSingle<DbLadderMatch>();
  if (!m) return null;

  let ratingA: number | null = null;
  let ratingB: number | null = null;
  if (m.status === "confirmed") {
    const { data: rs } = await db
      .from("ladder_ratings")
      .select("player_id,rating")
      .eq("season_id", m.season_id)
      .in("player_id", [m.player_a, m.player_b])
      .returns<Array<Pick<DbLadderRating, "player_id" | "rating">>>();
    const map = new Map((rs ?? []).map((r) => [r.player_id, r.rating]));
    ratingA = map.get(m.player_a) ?? null;
    ratingB = map.get(m.player_b) ?? null;
  }

  return {
    status: m.status,
    scoreA: m.score_a,
    scoreB: m.score_b,
    winner: m.winner,
    deltaA: m.delta_a,
    deltaB: m.delta_b,
    reportedBy: m.reported_by,
    ratingA,
    ratingB,
  };
}
