import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import { DbGymPublic, activeSeason, runLadderMaintenance } from "@/lib/ladder";
import { isAdmin } from "@/lib/admin";
import { getGymProfile, syncGymBadges } from "@/lib/gymStats";
import { GymArena } from "@/components/GymArena";
import { GymLeaderboard } from "@/components/GymLeaderboard";

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

  // 館內排行榜與當月活躍人數。全部由既有的比賽資料現算，所以回溯生效。
  const profile = season ? await getGymProfile(db, gym.id, season.id) : null;

  // 順手把這位玩家應得的道館徽章補上（冪等，重複發放由唯一鍵擋掉）
  await Promise.all(myPlayers.map((p) => syncGymBadges(db, p.id)));

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link
        href="/ladder"
        className="text-sm text-slate-400 hover:text-slate-200"
      >
        ← 天梯
      </Link>

      {gym.logo_url && (
        // logo_url 是店家自填的外部網址，網域不固定，用不了 next/image 的白名單
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={gym.logo_url}
          alt=""
          className="mt-4 h-32 w-full rounded-2xl border border-arena-line object-cover"
        />
      )}

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
        {profile && profile.monthlyActive > 0 && (
          <> ・本月 {profile.monthlyActive} 位玩家來過</>
        )}
      </p>

      {gym.address && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(gym.address)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-cyanx hover:underline"
        >
          📍 {gym.address}
        </a>
      )}

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

      {profile && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-black italic">🏆 館內排行榜</h2>
          <GymLeaderboard board={profile.board} />
        </section>
      )}
    </main>
  );
}
