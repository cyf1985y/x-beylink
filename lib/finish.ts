/**
 * 計分板 v2：BEYBLADE X 官方「結束方式」與「重射事由」。
 *
 * 這支檔案不得引入任何伺服器端相依（client component 會直接 import）。
 * 分數一律由 finish_type 推導（見 FINISH_OPTIONS），伺服器端不信任前端傳來的分數。
 */

/* -------------------------------- 結束方式 -------------------------------- */

export type FinishType = "spin" | "over" | "burst" | "xtreme";

export type FinishOption = {
  type: FinishType;
  points: number;
  emoji: string;
  label: string;
  zh: string;
};

/** 四種結束方式（計分板排成 2×2，順序即畫面順序） */
export const FINISH_OPTIONS: readonly FinishOption[] = [
  { type: "spin", points: 1, emoji: "🌀", label: "Spin", zh: "對手先停止旋轉" },
  { type: "over", points: 2, emoji: "💨", label: "Over", zh: "對手被打出場外" },
  { type: "burst", points: 2, emoji: "💥", label: "Burst", zh: "對手爆裂解體" },
  { type: "xtreme", points: 3, emoji: "⚡", label: "Xtreme", zh: "Xtreme 線得分" },
] as const;

export function isFinishType(v: unknown): v is FinishType {
  return FINISH_OPTIONS.some((f) => f.type === v);
}

export function finishOption(v: string | null): FinishOption | null {
  return FINISH_OPTIONS.find((f) => f.type === v) ?? null;
}

/** 結束方式對應分數：spin 1／over 2／burst 2／xtreme 3 */
export function finishPoints(t: FinishType): number {
  return finishOption(t)?.points ?? 0;
}

/* --------------------------------- 重射 --------------------------------- */

export type ReshootReason =
  | "false_start"
  | "launch_miss"
  | "midair_collision"
  | "simultaneous"
  | "self_ko"
  | "other";

export type ReshootOption = {
  reason: ReshootReason;
  label: string;
  /** 快選鈕下方的小字說明（沒有就不顯示） */
  note?: string;
};

/** 官方規則中「不計分、重新發射」的六種情況 */
export const RESHOOT_OPTIONS: readonly ReshootOption[] = [
  { reason: "false_start", label: "搶跑", note: "口令前發射" },
  { reason: "launch_miss", label: "發射失誤", note: "沒射進戰鬥盤" },
  { reason: "midair_collision", label: "空中相撞", note: "落盤前碰撞" },
  { reason: "simultaneous", label: "同時結束", note: "同時停止／出場" },
  { reason: "self_ko", label: "自摔", note: "3 秒內無接觸" },
  { reason: "other", label: "其他" },
] as const;

export function isReshootReason(v: unknown): v is ReshootReason {
  return RESHOOT_OPTIONS.some((r) => r.reason === v);
}

export function reshootLabel(v: string | null): string {
  return RESHOOT_OPTIONS.find((r) => r.reason === v)?.label ?? "重射";
}

/**
 * 重射列寫入的 side。
 *
 * 交接單規格為 side = 0，但資料庫既有的 match_points_side_check 仍限制
 * side ∈ {1, 2}（新欄位那次升級沒有一併放寬），寫 0 會被 CHECK 擋下。
 * 在 schema 放寬前先寫 1：重射列 points = 0，對任何比分計算都沒有影響，
 * 且全站一律以 reshoot_reason IS NOT NULL 判斷是否為重射列、不看 side，
 * 因此之後把這個常數改回 0 即可，不需要動其他程式。
 */
export const RESHOOT_SIDE = 1;

/* ------------------------------ 回合紀錄 ------------------------------ */

/** match_points 的原始列（賽事場與天梯場共用同一張表） */
export type PointRow = {
  id: string;
  side: number;
  points: number;
  finish_type: string | null;
  reshoot_reason: string | null;
  created_at: string;
};

/** 時間軸用的單一回合 */
export type RoundEntry = {
  id: string;
  side: 1 | 2;
  points: number;
  finishType: FinishType | null;
  reshootReason: ReshootReason | null;
  createdAt: string;
};

/** match_points 原始列 → 時間軸項目（舊資料 finish_type 為 null 也能正常呈現） */
export function toRoundEntries(rows: PointRow[]): RoundEntry[] {
  return rows.map((r) => ({
    id: r.id,
    side: r.side === 2 ? 2 : 1,
    points: r.points,
    finishType: isFinishType(r.finish_type) ? r.finish_type : null,
    reshootReason: isReshootReason(r.reshoot_reason) ? r.reshoot_reason : null,
    createdAt: r.created_at,
  }));
}

/** 由回合紀錄重算比分（負分為犯規扣分，各側最低 0；重射列 points = 0 不影響） */
export function scoreFromRounds(rounds: RoundEntry[]): {
  s1: number;
  s2: number;
} {
  let s1 = 0;
  let s2 = 0;
  for (const r of rounds) {
    if (r.reshootReason) continue;
    if (r.side === 1) s1 += r.points;
    else s2 += r.points;
  }
  return { s1: Math.max(0, s1), s2: Math.max(0, s2) };
}
