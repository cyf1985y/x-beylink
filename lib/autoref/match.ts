/**
 * 一場比賽的比分（規格 2.1、3.3）：先得 winScore 分者獲勝。
 * 每局判定可被操作者覆寫或取消，覆寫紀錄保留。
 */
import type { BattleCall, PlayerId } from "./types.ts";

export interface BattleRecord {
  /** 程式的原始判定 */
  auto: BattleCall;
  /** 操作者改判後的結果（null = 未改判） */
  override: BattleCall | null;
  /** 操作者按「重賽不計分」 */
  voided: boolean;
  /** 本局影片在儲存層的 key（有錄影時） */
  videoKey?: string;
  /** 操作者確認的時間（Date.now()） */
  confirmedAt?: number;
}

export interface MatchState {
  id: string;
  createdAt: number;
  winScore: number;
  names: Record<PlayerId, string>;
  battles: BattleRecord[];
}

export function newMatch(winScore: number, names?: Partial<Record<PlayerId, string>>): MatchState {
  return {
    id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    winScore,
    names: { P1: names?.P1 ?? "選手 1", P2: names?.P2 ?? "選手 2" },
    battles: [],
  };
}

/** 一局最終生效的判定 */
export function effectiveCall(r: BattleRecord): BattleCall | null {
  if (r.voided) return null;
  return r.override ?? r.auto;
}

export function scoreOf(m: MatchState): Record<PlayerId, number> {
  const s: Record<PlayerId, number> = { P1: 0, P2: 0 };
  for (const r of m.battles) {
    const c = effectiveCall(r);
    if (c?.winner) s[c.winner] += c.points;
  }
  return s;
}

export function matchWinner(m: MatchState): PlayerId | null {
  const s = scoreOf(m);
  if (s.P1 >= m.winScore && s.P1 > s.P2) return "P1";
  if (s.P2 >= m.winScore && s.P2 > s.P1) return "P2";
  return null;
}

export function addBattle(m: MatchState, auto: BattleCall, videoKey?: string): MatchState {
  return { ...m, battles: [...m.battles, { auto, override: null, voided: false, videoKey }] };
}

export function overrideBattle(m: MatchState, index: number, call: BattleCall): MatchState {
  const battles = m.battles.map((r, i) =>
    i === index ? { ...r, override: call, voided: false, confirmedAt: Date.now() } : r
  );
  return { ...m, battles };
}

export function voidBattle(m: MatchState, index: number): MatchState {
  const battles = m.battles.map((r, i) =>
    i === index ? { ...r, voided: true, confirmedAt: Date.now() } : r
  );
  return { ...m, battles };
}

export function confirmBattle(m: MatchState, index: number): MatchState {
  const battles = m.battles.map((r, i) => (i === index ? { ...r, confirmedAt: Date.now() } : r));
  return { ...m, battles };
}

/** 下一局的局號（含已取消的局，局號不重複） */
export function nextBattleNo(m: MatchState): number {
  return m.battles.length + 1;
}
