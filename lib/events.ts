import type { DbPlayer } from "@/lib/supabase";

/** 賽事等級設定 — 成團門檻與名額上限寫死在後端，不可由主辦方自填（業務規則） */
export const TIERS = {
  bronze: {
    label: "銅級",
    minRequired: 8,
    capacity: 16,
    color: "bronze",
    freq: "每日賽",
  },
  silver: {
    label: "銀級",
    minRequired: 16,
    capacity: 32,
    color: "silver",
    freq: "每週賽",
  },
  gold: {
    label: "金級",
    minRequired: 32,
    capacity: 64,
    color: "gold",
    freq: "每月賽",
  },
} as const;

export type Tier = keyof typeof TIERS;

export function isTier(v: string): v is Tier {
  return v in TIERS;
}

export type DbEvent = {
  id: string;
  organizer_id: string;
  title: string;
  tier: Tier;
  starts_at: string;
  venue: string;
  region: string;
  address: string | null;
  division: string;
  capacity: number;
  min_required: number;
  confirm_deadline: string;
  /** 報名截止（開賽前 2 小時，之後自動產生對戰表） */
  registration_deadline: string | null;
  rules_note: string | null;
  status: "open" | "confirmed" | "void" | "cancelled" | "done";
};

export type DbRegistration = {
  id: string;
  event_id: string;
  player_id: string;
  status: "ok" | "waitlist" | "cancelled";
  qr_token: string;
  checked_in_at: string | null;
  created_at: string;
};

export const EVENT_STATUS_LABEL: Record<DbEvent["status"], string> = {
  open: "揪團中",
  confirmed: "確定開打",
  void: "流局",
  cancelled: "已取消",
  done: "已結束",
};

/** 取消報名的無責時限（小時）：賽前 72 小時內取消記 0.5 點 */
export const FREE_CANCEL_HOURS = 72;

/** 報名截止：開賽前幾小時（寫死，之後自動抽籤產生對戰表） */
export const REGISTRATION_CLOSE_HOURS = 2;

/** 報名截止時間（舊資料沒有欄位時，由開賽時間回推） */
export function registrationDeadlineOf(event: DbEvent): Date {
  if (event.registration_deadline) return new Date(event.registration_deadline);
  return new Date(
    new Date(event.starts_at).getTime() - REGISTRATION_CLOSE_HOURS * 3600_000
  );
}

export function isRegistrationClosed(event: DbEvent): boolean {
  return registrationDeadlineOf(event) <= new Date();
}

export function formatTaipei(iso: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function isPlayerBanned(player: Pick<DbPlayer, "banned_until">): boolean {
  return !!player.banned_until && new Date(player.banned_until) > new Date();
}

/**
 * 記信譽點數後的停權判定（業務規則）：
 * 累計 2 點停權 30 天、3 點停權 90 天。回傳新的 banned_until（無停權則 null）。
 */
export function bannedUntilFor(totalPoints: number): string | null {
  const now = Date.now();
  if (totalPoints >= 3) return new Date(now + 90 * 86400_000).toISOString();
  if (totalPoints >= 2) return new Date(now + 30 * 86400_000).toISOString();
  return null;
}
