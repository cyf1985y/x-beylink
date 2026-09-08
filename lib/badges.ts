/**
 * 天梯徽章。
 *
 * 混合制：條件用現有的比賽資料**即時算**，所以不會漏發、也回溯生效（過去的比賽
 * 立刻算得出來）；達成的當下再往 player_badges 落一筆 earned_at，這樣就算之後
 * 賽季重置或條件調整，已經拿到的徽章也不會消失。
 *
 * 刻意不共用 trophies：那是綁 event_id 的實體賽獎盃，規定只能由該賽事主辦方
 * 經 RPC 發放。天梯徽章是系統自動判定的，語意不同。
 */

/** 道館徽章：同一種徽章每間道館各算一次，鼓勵跨店遊玩 */
export type GymBadge = {
  kind: string;
  label: string;
  icon: string;
  /** 達成門檻 */
  need: number;
  /** 看的是總場次還是勝場 */
  metric: "matches" | "wins";
  /** 顯示用的條件說明 */
  desc: string;
};

export const GYM_BADGES: readonly GymBadge[] = [
  {
    kind: "gym_regular",
    label: "常客",
    icon: "🏟️",
    need: 5,
    metric: "matches",
    desc: "在這間道館完成 5 場對戰",
  },
  {
    kind: "gym_winner",
    label: "館內好手",
    icon: "🏅",
    need: 3,
    metric: "wins",
    desc: "在這間道館取得 3 勝",
  },
] as const;

/** 某位選手在某一間道館的成績（徽章判定的輸入） */
export type GymTally = {
  gymId: string;
  gymName: string;
  matches: number;
  wins: number;
};

/** 這份成績達成了哪些道館徽章 */
export function earnedGymBadges(tally: GymTally): GymBadge[] {
  return GYM_BADGES.filter(
    (b) => tally[b.metric] >= b.need
  );
}

/** 距離下一個徽章還差多少（道館頁的進度提示用；全部拿到就回 null） */
export function nextGymBadge(
  tally: GymTally
): { badge: GymBadge; remaining: number } | null {
  for (const b of GYM_BADGES) {
    const have = tally[b.metric];
    if (have < b.need) return { badge: b, remaining: b.need - have };
  }
  return null;
}
