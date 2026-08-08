import { SupabaseClient } from "@supabase/supabase-js";

/**
 * 選手卡「生涯數據」：各種結束方式的累計次數。
 *
 * 只算成績已定案的場：賽事場需 events.status = 'done'、天梯場需
 * ladder_matches.status = 'confirmed'——進行中或有爭議的場不計入。
 *
 * 刻意不用 PostgREST 的巢狀 embed（match_points 同時外連 matches 與
 * ladder_matches，兩層 join 的過濾寫法容易踩雷），改成先取出「這位選手的哪些場、
 * 站在哪一側」再撈回合，全部都是單表查詢，行為可預期。
 */

export type FinishCounts = {
  xtreme: number;
  burst: number;
};

const COUNTED = ["xtreme", "burst"] as const;

/** matchId → 這位選手在該場的 side（1 或 2） */
type SideMap = Map<string, 1 | 2>;

function tally(
  rows: Array<{ match_id?: string | null; ladder_match_id?: string | null; side: number; finish_type: string | null }>,
  key: "match_id" | "ladder_match_id",
  sides: SideMap,
  into: FinishCounts
) {
  for (const r of rows) {
    const id = r[key];
    if (!id || sides.get(id) !== r.side) continue;
    if (r.finish_type === "xtreme") into.xtreme += 1;
    else if (r.finish_type === "burst") into.burst += 1;
  }
}

export async function finishCounts(
  db: SupabaseClient,
  playerId: string
): Promise<FinishCounts> {
  const counts: FinishCounts = { xtreme: 0, burst: 0 };

  const [{ data: myMatches }, { data: myLadder }] = await Promise.all([
    db
      .from("matches")
      .select("id,event_id,player1_id,player2_id")
      .or(`player1_id.eq.${playerId},player2_id.eq.${playerId}`)
      .returns<
        Array<{
          id: string;
          event_id: string;
          player1_id: string | null;
          player2_id: string | null;
        }>
      >(),
    db
      .from("ladder_matches")
      .select("id,player_a,player_b")
      .eq("status", "confirmed")
      .or(`player_a.eq.${playerId},player_b.eq.${playerId}`)
      .returns<Array<{ id: string; player_a: string; player_b: string }>>(),
  ]);

  // 賽事場：只留已結算賽事的場
  const eventSides: SideMap = new Map();
  const eventIds = Array.from(
    new Set((myMatches ?? []).map((m) => m.event_id))
  );
  if (eventIds.length > 0) {
    const { data: doneEvents } = await db
      .from("events")
      .select("id")
      .eq("status", "done")
      .in("id", eventIds)
      .returns<Array<{ id: string }>>();
    const done = new Set((doneEvents ?? []).map((e) => e.id));
    for (const m of myMatches ?? []) {
      if (!done.has(m.event_id)) continue;
      if (m.player1_id === playerId) eventSides.set(m.id, 1);
      else if (m.player2_id === playerId) eventSides.set(m.id, 2);
    }
  }

  const ladderSides: SideMap = new Map();
  for (const m of myLadder ?? []) {
    if (m.player_a === playerId) ladderSides.set(m.id, 1);
    else if (m.player_b === playerId) ladderSides.set(m.id, 2);
  }

  const [eventRows, ladderRows] = await Promise.all([
    eventSides.size
      ? db
          .from("match_points")
          .select("match_id,side,finish_type")
          .in("match_id", Array.from(eventSides.keys()))
          .in("finish_type", COUNTED as unknown as string[])
          .returns<
            Array<{ match_id: string; side: number; finish_type: string }>
          >()
      : Promise.resolve({ data: [] }),
    ladderSides.size
      ? db
          .from("match_points")
          .select("ladder_match_id,side,finish_type")
          .in("ladder_match_id", Array.from(ladderSides.keys()))
          .in("finish_type", COUNTED as unknown as string[])
          .returns<
            Array<{
              ladder_match_id: string;
              side: number;
              finish_type: string;
            }>
          >()
      : Promise.resolve({ data: [] }),
  ]);

  tally(eventRows.data ?? [], "match_id", eventSides, counts);
  tally(ladderRows.data ?? [], "ladder_match_id", ladderSides, counts);
  return counts;
}
