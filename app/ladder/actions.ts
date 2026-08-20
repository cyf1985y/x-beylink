"use server";

import { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import {
  DbGymPublic,
  DbLadderMatch,
  DbLadderRating,
  ladderErrorMessage,
  ladderRpc,
  activeSeason,
  rankOf,
  runLadderMaintenance,
} from "@/lib/ladder";
import {
  FINISH_POINTS,
  isDecided,
  isFinishType,
  isReshootReason,
  type FinishType,
  type ReshootReason,
} from "@/lib/bracket";
import {
  loadLadderRounds,
  scoreOf,
  type DbMatchPoint,
} from "@/lib/rounds";

export type LadderResult = {
  ok: boolean;
  error?: string;
  /**
   * RPC 的原始錯誤碼（例如 match_in_progress）。
   * 呼叫端要「依錯誤種類分流」時比對這個，不要去比對中文字串——
   * 文案隨時會改，比對中文的判斷會安靜地失效。
   */
  code?: string;
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
 * 管理員免定位進場。
 *
 * ladder_enter_gym 只要帶 p_token 就走 QR 驗證、完全跳過 radius_m 比對——
 * 這裡是借用那條既有路徑，所以不必改 RPC、也不必改 schema。
 * qr_token 全程只在伺服器端取用，絕不回傳給瀏覽器
 * （gyms_public view 本來就不含這個欄位，這裡是特地讀基礎表）。
 *
 * 回傳 null 代表這座道館沒有 token，呼叫端請退回一般的定位驗證。
 */
async function enterGymAsAdmin(
  db: SupabaseClient,
  gym: DbGymPublic,
  playerId: string
): Promise<LadderResult | null> {
  const { data } = await db
    .from("gyms")
    .select("qr_token")
    .eq("id", gym.id)
    .maybeSingle<{ qr_token: string }>();
  if (!data?.qr_token) return null;

  const res = await ladderRpc(db, "ladder_enter_gym", {
    p_gym_id: gym.id,
    p_player_id: playerId,
    p_token: data.qr_token,
  });
  if (!res.ok) {
    return {
      ok: false,
      error: ladderErrorMessage(res.error_code, { radiusM: gym.radius_m }),
    };
  }

  // 這是繞過現場驗證的行為，留一筆可追查的紀錄（不含任何座標）
  console.warn(`管理員免定位進場：gym=${gym.id} player=${playerId}`);

  revalidatePath(`/ladder/gym/${gym.id}`);
  return {
    ok: true,
    message: `已以管理員身分進入${gym.name}（未驗證位置）`,
  };
}

/**
 * 進入道館。
 *
 * lat／lng 由瀏覽器一次性取得後直接當參數傳進 RPC，
 * 全程不寫 log、不存表、不放進 URL——這是天梯 M1 的硬性要求。
 *
 * 管理員可以免定位進場（lat／lng 傳 null）：走 RPC 既有的 QR token 路徑，
 * 不需要改資料庫或 RPC。權限一律在伺服器端判定，前端傳什麼都不影響。
 */
export async function enterGym(
  gymId: string,
  playerId: string,
  lat: number | null,
  lng: number | null
): Promise<LadderResult> {
  const mine = await requireMyPlayer(playerId);
  if (mine.error) return { ok: false, error: mine.error };

  const db = supabaseAdmin();
  const { data: gym } = await db
    .from("gyms_public")
    .select("*")
    .eq("id", gymId)
    .maybeSingle<DbGymPublic>();
  if (!gym) return { ok: false, error: "找不到這座道館" };

  if (await isAdmin(await getSession())) {
    const bypass = await enterGymAsAdmin(db, gym, playerId);
    if (bypass) return bypass;
    // 取不到 token 就當作沒有這條路，繼續走一般的定位驗證
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: "無法取得你的位置，請允許定位後再試一次" };
  }

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
    return {
      ok: false,
      error: ladderErrorMessage(res.error_code),
      code: res.error_code ?? undefined,
    };
  }

  revalidatePath(`/ladder/gym/${gymId}`);
  return { ok: true, matchId: res.new_match_id ?? undefined };
}

/* --------------------------------- 逐回合計分 ------------------------------- */

export type LadderRoundsResult = {
  ok: boolean;
  error?: string;
  scoreA?: number;
  scoreB?: number;
  rounds?: DbMatchPoint[];
};

/**
 * 天梯計分權限：這場的選手本人，且對戰還在進行中。
 * 天梯沒有裁判，所以由選手自己記——記完再由敗方確認。
 */
async function requireLadderScorer(
  matchId: string,
  playerId: string
): Promise<{ match?: DbLadderMatch; error?: string }> {
  const mine = await requireMyPlayer(playerId);
  if (mine.error) return { error: mine.error };

  const db = supabaseAdmin();
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
    return { error: "這場已經回報，無法再計分" };
  }
  return { match };
}

/** 讀回目前的回合列與比分（side 1 = A 方、side 2 = B 方） */
async function ladderRoundsResult(matchId: string): Promise<LadderRoundsResult> {
  const db = supabaseAdmin();
  const rounds = await loadLadderRounds(db, matchId);
  const { s1, s2 } = scoreOf(rounds);
  return { ok: true, scoreA: s1, scoreB: s2, rounds };
}

/** 逐回合紀錄（對戰頁輪詢與初始載入共用，旁觀者也讀得到） */
export async function getLadderRounds(
  matchId: string
): Promise<LadderRoundsResult> {
  return ladderRoundsResult(matchId);
}

/** 記一次得分：Spin +1、Over +2、Burst +2、Xtreme +3 */
export async function addLadderFinish(
  matchId: string,
  playerId: string,
  side: 1 | 2,
  finish: FinishType
): Promise<LadderRoundsResult> {
  if (!isFinishType(finish)) return { ok: false, error: "結束方式不正確" };
  if (side !== 1 && side !== 2) return { ok: false, error: "計分方不正確" };

  const auth = await requireLadderScorer(matchId, playerId);
  if (auth.error) return { ok: false, error: auth.error };

  const db = supabaseAdmin();

  // 已分出勝負就不再收分。前端也鎖了，但雙方各自的裝置都能計分，
  // 對手那支手機在輪詢的空窗內畫面還沒鎖，所以這裡要擋第二道。
  // 只擋加分：「−1」與「復原上一筆」照舊，那是誤判復原的路徑。
  const before = await loadLadderRounds(db, matchId);
  const { s1, s2 } = scoreOf(before);
  if (isDecided(s1, s2)) {
    return {
      ok: false,
      error: ladderErrorMessage("match_already_decided"),
      scoreA: s1,
      scoreB: s2,
      rounds: before,
    };
  }

  const session = await getSession();
  await db.from("match_points").insert({
    ladder_match_id: matchId,
    side,
    points: FINISH_POINTS[finish],
    finish_type: finish,
    created_by: session?.uid ?? null,
  });
  return ladderRoundsResult(matchId);
}

/** 犯規扣分 −1 */
export async function addLadderPenalty(
  matchId: string,
  playerId: string,
  side: 1 | 2
): Promise<LadderRoundsResult> {
  if (side !== 1 && side !== 2) return { ok: false, error: "計分方不正確" };

  const auth = await requireLadderScorer(matchId, playerId);
  if (auth.error) return { ok: false, error: auth.error };

  const session = await getSession();
  await supabaseAdmin().from("match_points").insert({
    ladder_match_id: matchId,
    side,
    points: -1,
    created_by: session?.uid ?? null,
  });
  return ladderRoundsResult(matchId);
}

/** 重射：這一回合不計分重來，比分不動但紀錄上看得出發生過 */
export async function addLadderReshoot(
  matchId: string,
  playerId: string,
  reason: ReshootReason
): Promise<LadderRoundsResult> {
  if (!isReshootReason(reason)) return { ok: false, error: "重射原因不正確" };

  const auth = await requireLadderScorer(matchId, playerId);
  if (auth.error) return { ok: false, error: auth.error };

  const session = await getSession();
  await supabaseAdmin().from("match_points").insert({
    ladder_match_id: matchId,
    side: 0,
    points: 0,
    reshoot_reason: reason,
    created_by: session?.uid ?? null,
  });
  return ladderRoundsResult(matchId);
}

/** 復原上一筆（得分、犯規或重射都算一筆） */
export async function undoLadderRound(
  matchId: string,
  playerId: string
): Promise<LadderRoundsResult> {
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
  if (!last) return { ok: false, error: "沒有可復原的計分紀錄" };

  await db.from("match_points").delete().eq("id", last.id);
  return ladderRoundsResult(matchId);
}

/** 歸零重來：清掉這場的所有回合紀錄 */
export async function clearLadderRounds(
  matchId: string,
  playerId: string
): Promise<LadderRoundsResult> {
  const auth = await requireLadderScorer(matchId, playerId);
  if (auth.error) return { ok: false, error: auth.error };

  await supabaseAdmin()
    .from("match_points")
    .delete()
    .eq("ladder_match_id", matchId);
  return ladderRoundsResult(matchId);
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
  /** 進行中／待確認的對戰：被挑戰時自動進場，重整後也靠它回到現場 */
  activeMatch: ActiveMatch | null;
};

/**
 * 道館即時狀態（2 秒輪詢）。
 *
 * withMaintenance：逾時自動成立要在這裡補跑，否則只靠 /ladder 頁載入與每日 cron
 * 會讓守台的人卡著。但自動成立的門檻是 1 分鐘，沒必要每 2 秒掃一次——
 * 由呼叫端每隔約 30 秒帶一次 true 就夠了。
 */
export async function getGymState(
  gymId: string,
  withMaintenance = true
): Promise<GymState> {
  const db = supabaseAdmin();

  if (withMaintenance) await runLadderMaintenance(db);

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
    // 進場逾時但對戰還在跑的情況也要查得到，不能提早回傳 null
    return {
      roster: [],
      myPresence: [],
      activeMatch: await findActiveMatch(mine.map((p) => p.id)),
    };
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
    activeMatch: await findActiveMatch(mine.map((p) => p.id)),
  };
}

export type NextMatch = {
  matchId: string;
  opponentNickname: string;
  opponentAvatar: string;
};

/**
 * 我的下一場對戰（排除目前這場）。
 *
 * 守台的人贏完之後，挑戰者一發起挑戰就會建立新的一場——這支讓對戰頁
 * 在結果成立後還能發現它，不必先回道館再點一次。
 */
export async function getNextMatch(
  playerId: string,
  excludeMatchId: string
): Promise<NextMatch | null> {
  const mine = await requireMyPlayer(playerId);
  if (mine.error) return null;

  const db = supabaseAdmin();
  const { data: m } = await db
    .from("ladder_matches")
    .select("id,player_a,player_b")
    .in("status", ["playing", "pending_confirm"])
    .or(`player_a.eq.${playerId},player_b.eq.${playerId}`)
    .neq("id", excludeMatchId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; player_a: string; player_b: string }>();
  if (!m) return null;

  const opponentId = m.player_a === playerId ? m.player_b : m.player_a;
  const { data: p } = await db
    .from("players")
    .select("nickname,avatar")
    .eq("id", opponentId)
    .maybeSingle<{ nickname: string; avatar: string }>();

  return {
    matchId: m.id,
    opponentNickname: p?.nickname ?? "對手",
    opponentAvatar: p?.avatar ?? "🌀",
  };
}

export type ActiveMatch = {
  matchId: string;
  status: "playing" | "pending_confirm";
  /** 我在這場的選手 id */
  myPlayerId: string;
  opponentNickname: string;
  opponentAvatar: string;
  /** true＝這場是對方向我發起的，我還沒看過任何畫面 */
  challengedMe: boolean;
};

type LiveMatchRow = {
  id: string;
  status: "playing" | "pending_confirm";
  player_a: string;
  player_b: string;
  created_at: string;
};

/**
 * 「我現在該做什麼」：我尚未結束的天梯對戰，連對手資訊一起帶回。
 *
 * ladder_challenge 沒有「對方接受」這一步，比賽一建立就是 playing——
 * 被挑戰的人不會收到任何詢問，所以要靠這支查詢把他推進計分板。
 * 道館頁輪詢與重整後回到現場都走這裡。
 */
export async function findActiveMatch(
  playerIds: string[]
): Promise<ActiveMatch | null> {
  if (playerIds.length === 0) return null;
  const db = supabaseAdmin();
  const live = ["playing", "pending_confirm"];
  const cols = "id,status,player_a,player_b,created_at";
  const [{ data: asA }, { data: asB }] = await Promise.all([
    db
      .from("ladder_matches")
      .select(cols)
      .in("status", live)
      .in("player_a", playerIds)
      .returns<LiveMatchRow[]>(),
    db
      .from("ladder_matches")
      .select(cols)
      .in("status", live)
      .in("player_b", playerIds)
      .returns<LiveMatchRow[]>(),
  ]);
  const match = [...(asA ?? []), ...(asB ?? [])].sort((x, y) =>
    x.created_at < y.created_at ? 1 : -1
  )[0];
  if (!match) return null;

  // ladder_challenge 一律把發起方寫進 player_a，所以我是 player_b 就是被挑戰的一方
  const iAmA = playerIds.includes(match.player_a);
  const opponentId = iAmA ? match.player_b : match.player_a;
  const { data: opponent } = await db
    .from("players")
    .select("nickname,avatar")
    .eq("id", opponentId)
    .maybeSingle<{ nickname: string; avatar: string }>();

  return {
    matchId: match.id,
    status: match.status,
    myPlayerId: iAmA ? match.player_a : match.player_b,
    opponentNickname: opponent?.nickname ?? "對手",
    opponentAvatar: opponent?.avatar ?? "🌀",
    challengedMe: !iAmA,
  };
}

/** 我尚未結束的天梯對戰 id（/ladder 頁的「回到對戰」入口用） */
export async function findActiveMatchId(
  playerIds: string[]
): Promise<string | null> {
  return (await findActiveMatch(playerIds))?.matchId ?? null;
}

export type MatchState = {
  status: DbLadderMatch["status"];
  scoreA: number | null;
  scoreB: number | null;
  winner: string | null;
  deltaA: number | null;
  deltaB: number | null;
  reportedBy: string | null;
  /** 回報時間：勝方等待畫面的「還剩幾秒自動成立」倒數用 */
  reportedAt: string | null;
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
    reportedAt: m.reported_at,
    ratingA,
    ratingB,
  };
}
