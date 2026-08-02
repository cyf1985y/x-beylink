import { SupabaseClient } from "@supabase/supabase-js";

/** 單淘汰對戰表：產生、晉級、名次推導 */

export type DbMatch = {
  id: string;
  event_id: string;
  round: number; // 1 起算，最後一輪 = 決賽
  slot: number; // 該輪第幾場（0 起算）
  kind: "normal" | "third"; // third = 季軍戰
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  created_at: string;
};

/** 決賽輪數：bracketSize = 2^rounds */
export function totalRounds(bracketSize: number): number {
  return Math.log2(bracketSize);
}

export function roundName(round: number, finalRound: number): string {
  if (round === finalRound) return "決賽";
  if (round === finalRound - 1) return "準決賽";
  if (round === finalRound - 2) return "八強";
  if (round === finalRound - 3) return "十六強";
  return `第 ${round} 輪`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 產生整張對戰表（含輪空自動晉級與季軍戰）。
 * players：已報到選手 id，隨機配位。回傳待 insert 的 rows。
 */
export function buildBracket(
  eventId: string,
  playerIds: string[]
): Array<Omit<DbMatch, "id" | "created_at">> {
  const n = playerIds.length;
  if (n < 2) throw new Error("至少要 2 位已報到選手");
  const size = 2 ** Math.ceil(Math.log2(n));
  const finalRound = totalRounds(size);
  const shuffled = shuffle(playerIds);

  // 種子位安排：把輪空平均散開（標準做法是 seed 對位，MVP 用交錯塞 null）
  const slots: Array<string | null> = [];
  const byes = size - n;
  // 前 byes*2 個位置每兩格塞一人一空，其餘照排 → 輪空分散在不同場次
  let p = 0;
  for (let i = 0; i < byes * 2; i += 2) {
    slots[i] = shuffled[p++] ?? null;
    slots[i + 1] = null;
  }
  for (let i = byes * 2; i < size; i++) {
    slots[i] = shuffled[p++] ?? null;
  }

  const rows: Array<Omit<DbMatch, "id" | "created_at">> = [];

  // 第一輪
  const round1: Array<{ p1: string | null; p2: string | null; winner: string | null }> = [];
  for (let s = 0; s < size / 2; s++) {
    const p1 = slots[s * 2];
    const p2 = slots[s * 2 + 1];
    // 輪空：只有一人 → 直接晉級
    const winner = p1 && !p2 ? p1 : !p1 && p2 ? p2 : null;
    round1.push({ p1, p2, winner });
    rows.push({
      event_id: eventId,
      round: 1,
      slot: s,
      kind: "normal",
      player1_id: p1,
      player2_id: p2,
      winner_id: winner,
    });
  }

  // 後續輪（先建空場，並把第一輪輪空的晉級者填進去）
  let prev = round1;
  for (let r = 2; r <= finalRound; r++) {
    const cur: typeof round1 = [];
    for (let s = 0; s < size / 2 ** r; s++) {
      const p1 = prev[s * 2]?.winner ?? null;
      const p2 = prev[s * 2 + 1]?.winner ?? null;
      cur.push({ p1, p2, winner: null });
      rows.push({
        event_id: eventId,
        round: r,
        slot: s,
        kind: "normal",
        player1_id: p1,
        player2_id: p2,
        winner_id: null,
      });
    }
    prev = cur;
  }

  // 季軍戰（4 人以上才有意義）
  if (size >= 4) {
    rows.push({
      event_id: eventId,
      round: finalRound,
      slot: 0,
      kind: "third",
      player1_id: null,
      player2_id: null,
      winner_id: null,
    });
  }

  return rows;
}

export async function loadMatches(
  db: SupabaseClient,
  eventId: string
): Promise<DbMatch[]> {
  const { data } = await db
    .from("matches")
    .select("*")
    .eq("event_id", eventId)
    .order("round", { ascending: true })
    .order("kind", { ascending: true })
    .order("slot", { ascending: true })
    .returns<DbMatch[]>();
  return data ?? [];
}

export function finalRoundOf(matches: DbMatch[]): number {
  return Math.max(...matches.map((m) => m.round));
}

/**
 * 設定勝者並推進晉級（含準決賽敗者進季軍戰）。
 * 回傳錯誤訊息或 null。
 */
export async function applyWinner(
  db: SupabaseClient,
  matches: DbMatch[],
  match: DbMatch,
  winnerId: string
): Promise<string | null> {
  if (winnerId !== match.player1_id && winnerId !== match.player2_id) {
    return "勝者必須是本場的其中一位選手";
  }
  const finalRound = finalRoundOf(matches);
  const next =
    match.kind === "normal" && match.round < finalRound
      ? matches.find(
          (m) =>
            m.kind === "normal" &&
            m.round === match.round + 1 &&
            m.slot === Math.floor(match.slot / 2)
        )
      : null;
  if (next?.winner_id) {
    return "下一場已有結果，請先撤銷下一場的勝負";
  }

  await db.from("matches").update({ winner_id: winnerId }).eq("id", match.id);

  const loserId =
    winnerId === match.player1_id ? match.player2_id : match.player1_id;

  // 勝者進下一場
  if (next) {
    const field = match.slot % 2 === 0 ? "player1_id" : "player2_id";
    await db.from("matches").update({ [field]: winnerId }).eq("id", next.id);
  }

  // 準決賽敗者進季軍戰
  if (match.kind === "normal" && match.round === finalRound - 1) {
    const third = matches.find((m) => m.kind === "third");
    if (third) {
      const field = match.slot === 0 ? "player1_id" : "player2_id";
      await db.from("matches").update({ [field]: loserId }).eq("id", third.id);
      // 對手輪空（另一準決賽是輪空晉級、沒有敗者）→ 單人自動獲勝
      const otherSet = match.slot === 0 ? third.player2_id : third.player1_id;
      const otherSemi = matches.find(
        (m) =>
          m.kind === "normal" &&
          m.round === finalRound - 1 &&
          m.slot === (match.slot === 0 ? 1 : 0)
      );
      const otherSemiDecidedNoLoser =
        otherSemi &&
        otherSemi.winner_id &&
        (!otherSemi.player1_id || !otherSemi.player2_id);
      if (loserId && !otherSet && otherSemiDecidedNoLoser) {
        await db
          .from("matches")
          .update({ winner_id: loserId })
          .eq("id", third.id);
      }
    }
  }
  return null;
}

/** 撤銷一場的勝負（下一場尚未有結果才可） */
export async function undoWinner(
  db: SupabaseClient,
  matches: DbMatch[],
  match: DbMatch
): Promise<string | null> {
  if (!match.winner_id) return "本場還沒有結果";
  const finalRound = finalRoundOf(matches);
  if (match.kind === "normal" && match.round < finalRound) {
    const next = matches.find(
      (m) =>
        m.kind === "normal" &&
        m.round === match.round + 1 &&
        m.slot === Math.floor(match.slot / 2)
    );
    if (next?.winner_id) return "下一場已有結果，請先撤銷下一場";
    if (next) {
      const field = match.slot % 2 === 0 ? "player1_id" : "player2_id";
      await db.from("matches").update({ [field]: null }).eq("id", next.id);
    }
    if (match.round === finalRound - 1) {
      const third = matches.find((m) => m.kind === "third");
      if (third) {
        if (third.winner_id) return "季軍戰已有結果，請先撤銷季軍戰";
        const field = match.slot === 0 ? "player1_id" : "player2_id";
        await db.from("matches").update({ [field]: null }).eq("id", third.id);
      }
    }
  }
  await db.from("matches").update({ winner_id: null }).eq("id", match.id);
  return null;
}

/** 對戰表全部打完後推導名次：player_id -> rank(1/2/3/4/8) */
export function deriveRanks(matches: DbMatch[]): Map<string, number> | null {
  const finalRound = finalRoundOf(matches);
  const final = matches.find(
    (m) => m.kind === "normal" && m.round === finalRound
  );
  const third = matches.find((m) => m.kind === "third");
  if (!final?.winner_id) return null;
  if (third && (third.player1_id || third.player2_id) && !third.winner_id) {
    return null;
  }

  const ranks = new Map<string, number>();
  ranks.set(final.winner_id, 1);
  const finalLoser =
    final.winner_id === final.player1_id ? final.player2_id : final.player1_id;
  if (finalLoser) ranks.set(finalLoser, 2);

  if (third?.winner_id) {
    ranks.set(third.winner_id, 3);
    const thirdLoser =
      third.winner_id === third.player1_id
        ? third.player2_id
        : third.player1_id;
    if (thirdLoser) ranks.set(thirdLoser, 4);
  }

  // 八強：倒數第三輪（若存在）的敗者
  const qfRound = finalRound - 2;
  if (qfRound >= 1) {
    for (const m of matches.filter(
      (x) => x.kind === "normal" && x.round === qfRound && x.winner_id
    )) {
      const loser =
        m.winner_id === m.player1_id ? m.player2_id : m.player1_id;
      if (loser && !ranks.has(loser)) ranks.set(loser, 8);
    }
  }
  return ranks;
}

/** 對戰表是否已全部打完（可結算） */
export function bracketComplete(matches: DbMatch[]): boolean {
  return deriveRanks(matches) !== null;
}
