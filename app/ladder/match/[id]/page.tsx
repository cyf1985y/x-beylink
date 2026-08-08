import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import { DbLadderMatch, runLadderMaintenance } from "@/lib/ladder";
import { loadLadderRounds } from "@/lib/rounds";
import { getMatchState } from "@/app/ladder/actions";
import { LadderMatchPanel } from "@/components/LadderMatchPanel";

export const dynamic = "force-dynamic";

export default async function LadderMatchPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect(`/login?next=/ladder/match/${params.id}`);

  const db = supabaseAdmin();
  // 逾時未確認在這裡補跑成立，確保重整後看到的是最新狀態
  await runLadderMaintenance(db);

  const { data: match } = await db
    .from("ladder_matches")
    .select("*")
    .eq("id", params.id)
    .maybeSingle<DbLadderMatch>();
  if (!match) notFound();

  const [{ data: players }, { data: mine }, state, rounds] = await Promise.all([
    db
      .from("players")
      .select("id,nickname,avatar")
      .in("id", [match.player_a, match.player_b])
      .returns<Array<Pick<DbPlayer, "id" | "nickname" | "avatar">>>(),
    db
      .from("players")
      .select("id")
      .eq("user_id", session.uid)
      .returns<Array<{ id: string }>>(),
    getMatchState(params.id),
    loadLadderRounds(db, params.id),
  ]);
  if (!state) notFound();

  const map = new Map((players ?? []).map((p) => [p.id, p]));
  const fallback = (id: string) => ({ id, nickname: "選手", avatar: "🌀" });
  const playerA = map.get(match.player_a) ?? fallback(match.player_a);
  const playerB = map.get(match.player_b) ?? fallback(match.player_b);

  const myIds = new Set((mine ?? []).map((p) => p.id));
  const myPlayerId =
    [match.player_a, match.player_b].find((id) => myIds.has(id)) ?? null;

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link
        href={match.gym_id ? `/ladder/gym/${match.gym_id}` : "/ladder"}
        className="text-sm text-slate-400 hover:text-slate-200"
      >
        ← {match.gym_id ? "回道館" : "回天梯"}
      </Link>

      <h1 className="mt-4 text-2xl font-black italic">
        天梯<span className="text-gradient">對戰</span>
      </h1>

      <div className="mt-6">
        <LadderMatchPanel
          matchId={match.id}
          playerA={playerA}
          playerB={playerB}
          myPlayerId={myPlayerId}
          initial={state}
          initialRounds={rounds}
        />
      </div>
    </main>
  );
}
