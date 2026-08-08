import { SupabaseClient } from "@supabase/supabase-js";

/**
 * 天梯（1v1 排位）共用型別與常數。
 *
 * 積分計算一律由資料庫的 ladder_confirm_result 負責，這裡不得出現任何 Elo 運算。
 * 玩家座標只作為 RPC 參數傳遞，不可寫入 log、不可存表、不可放進 URL。
 */

/** 進場效期（ladder_enter_gym 寫死 30 分鐘，此處僅供畫面提示） */
export const PRESENCE_MINUTES = 30;
/** 敗方未操作自動成立的時間（ladder_maintenance 負責，此處僅供畫面提示） */
export const AUTO_CONFIRM_MINUTES = 10;
/** 排行榜每組只取前 20 */
export const LEADERBOARD_LIMIT = 20;

export type DbGymPublic = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  certified: boolean;
  active: boolean;
  created_at: string;
};

export type LadderMatchStatus =
  | "playing"
  | "pending_confirm"
  | "confirmed"
  | "disputed"
  | "voided";

export type DbLadderMatch = {
  id: string;
  season_id: string;
  gym_id: string | null;
  player_a: string;
  player_b: string;
  score_a: number | null;
  score_b: number | null;
  winner: string | null;
  effective_factor: string | number | null;
  delta_a: number | null;
  delta_b: number | null;
  status: LadderMatchStatus;
  reported_by: string | null;
  reported_at: string | null;
  confirmed_at: string | null;
  created_at: string;
};

export type DbLadderRating = {
  season_id: string;
  player_id: string;
  rating: number;
  matches: number;
  wins: number;
  losses: number;
  peak_rating: number;
  updated_at: string;
};

export type DbLadderSeason = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: string;
  created_at: string;
};

/** 天梯起始分數（ladder_ratings.rating 的資料庫預設值） */
export const BASE_RATING = 1000;

/* ---------------------------------- 段位 ---------------------------------- */

export type Rank = {
  min: number;
  label: string;
  icon: string;
  /** 段位色（沿用賽場風配色） */
  text: string;
  border: string;
};

/** 由高到低，rankOf 取第一個符合的 */
export const RANKS: Rank[] = [
  {
    min: 1450,
    label: "王者",
    icon: "👑",
    text: "text-gold",
    border: "border-gold/50 bg-gold/10",
  },
  {
    min: 1300,
    label: "大師",
    icon: "🔥",
    text: "text-orange-300",
    border: "border-orange-400/50 bg-orange-400/10",
  },
  {
    min: 1150,
    label: "精英",
    icon: "🛡️",
    text: "text-violetx",
    border: "border-violetx/50 bg-violetx/10",
  },
  {
    min: 1050,
    label: "戰士",
    icon: "⚔️",
    text: "text-cyanx",
    border: "border-cyanx/50 bg-cyanx/10",
  },
  {
    min: 0,
    label: "見習戰士",
    icon: "🌱",
    text: "text-slate-300",
    border: "border-arena-line bg-arena",
  },
];

export function rankOf(rating: number): Rank {
  return RANKS.find((r) => rating >= r.min) ?? RANKS[RANKS.length - 1];
}

/* ---------------------------------- 分組 ---------------------------------- */

export type LadderClass = "normal" | "open";

export const CLASS_LABEL: Record<LadderClass, string> = {
  normal: "通常組",
  open: "公開組",
};

/** 通常組／公開組：以選手身分區分（小孩＝通常組、家長＝公開組） */
export function ladderClassOf(role: "parent" | "child"): LadderClass {
  return role === "child" ? "normal" : "open";
}

/* --------------------------------- RPC 呼叫 -------------------------------- */

export type RpcResult = {
  ok: boolean;
  error_code: string | null;
  new_match_id?: string | null;
};

/**
 * 呼叫 ladder_* RPC 並取回第一列。
 * 注意：args 可能含玩家座標，因此**任何情況都不得把 args 寫進 log**。
 */
export async function ladderRpc(
  db: SupabaseClient,
  fn: string,
  args: Record<string, unknown>
): Promise<RpcResult> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    // 只記函式名與資料庫訊息，絕不記參數
    console.error(`天梯 RPC ${fn} 失敗：`, error.message);
    return { ok: false, error_code: "rpc_failed" };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error_code: "rpc_failed" };
  return row as RpcResult;
}

const ERROR_TEXT: Record<string, string> = {
  no_active_season: "目前沒有進行中的天梯賽季",
  gym_not_found: "找不到這座道館，或道館已停用",
  bad_token: "道館 QR 已失效，請重新掃描",
  location_required: "需要你的位置才能進場，請允許定位後再試一次",
  self_challenge: "不能挑戰自己",
  challenger_not_present: "你的進場已逾時，請重新進場",
  opponent_not_present: "對手已離開道館或進場逾時",
  match_in_progress: "你或對手還有尚未完成的對戰，請先結束那一場",
  match_not_found: "找不到這場對戰",
  bad_status: "這場對戰的狀態已經改變，請重新整理",
  not_participant: "你不是這場對戰的選手",
  bad_score: "比分不正確：不可相同、也不可為負",
  not_loser: "只有敗方可以確認結果",
  rpc_failed: "系統忙碌中，請稍後再試",
};

/** error_code → 繁中訊息 */
export function ladderErrorMessage(
  code: string | null,
  ctx?: { radiusM?: number }
): string {
  if (code === "too_far") {
    const r = ctx?.radiusM ?? 150;
    return `你距離道館太遠了，請走進道館 ${r} 公尺範圍內再進場`;
  }
  if (!code) return "操作失敗，請稍後再試";
  return ERROR_TEXT[code] ?? "操作失敗，請稍後再試";
}

/* --------------------------------- 賽季／維護 -------------------------------- */

export async function activeSeason(
  db: SupabaseClient
): Promise<DbLadderSeason | null> {
  const { data } = await db
    .from("ladder_seasons")
    .select("*")
    .eq("status", "active")
    .limit(1)
    .maybeSingle<DbLadderSeason>();
  return data ?? null;
}

/**
 * 補跑維護（自動成立逾時未確認的對戰、作廢過期對戰）。
 * 沿用本專案 settle／autoBracket 的慣例：頁面載入時補跑，cron 另外每日掃底。
 * 失敗不影響頁面顯示。
 */
export async function runLadderMaintenance(db: SupabaseClient): Promise<void> {
  const { error } = await db.rpc("ladder_maintenance");
  if (error) console.error("天梯維護補跑失敗：", error.message);
}
