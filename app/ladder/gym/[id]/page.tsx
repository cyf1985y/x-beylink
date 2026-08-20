import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import { DbGymPublic, activeSeason, runLadderMaintenance } from "@/lib/ladder";
import { isAdmin } from "@/lib/admin";
import { GymArena } from "@/components/GymArena";

export const dynamic = "force-dynamic";

export default async function GymPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect(`/login?next=/ladder/gym/${params.id}`);

  const db = supabaseAdmin();
  await runLadderMaintenance(db);

  const { data: gym } = await db
    .from("gyms_public")
    .select("*")
    .eq("id", params.id)
    .maybeSingle<DbGymPublic>();
  if (!gym || !gym.active) notFound();

  const [season, { data: players }, admin] = await Promise.all([
    activeSeason(db),
    db
      .from("players")
      .select("*")
      .eq("user_id", session.uid)
      .order("created_at", { ascending: true })
      .returns<DbPlayer[]>(),
    isAdmin(session),
  ]);

  const myPlayers = (players ?? []).map((p) => ({
    id: p.id,
    nickname: p.nickname,
    avatar: p.avatar,
  }));

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link
        href="/ladder"
        className="text-sm text-slate-400 hover:text-slate-200"
      >
        ← 天梯
      </Link>

      <h1 className="mt-4 flex items-center gap-2 text-2xl font-black italic">
        🏟️ {gym.name}
        {gym.certified && (
          <span className="rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 text-[10px] font-bold not-italic text-gold">
            認證道館
          </span>
        )}
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        {season ? season.name : "目前沒有進行中的賽季"}
      </p>

      <div className="mt-6">
        {!season ? (
          <p className="rounded-2xl border border-dashed border-arena-line p-6 text-center text-sm text-slate-500">
            目前沒有進行中的天梯賽季，暫時無法進場。
          </p>
        ) : myPlayers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-arena-line p-6 text-center text-sm text-slate-500">
            還沒有選手檔案——
            <Link href="/me" className="text-cyanx hover:underline">
              先去建立一位選手
            </Link>
            才能進場。
          </div>
        ) : (
          <GymArena
            gym={{ id: gym.id, name: gym.name, radiusM: gym.radius_m }}
            myPlayers={myPlayers}
            isAdmin={admin}
          />
        )}
      </div>
    </main>
  );
}
