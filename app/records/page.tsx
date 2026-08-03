import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * 生涯戰績＝選手卡。
 * 只有一位選手直接跳轉選手卡；兩位時先選人；沒有選手導去建檔。
 */
export default async function RecordsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const db = supabaseAdmin();
  const { data: players } = await db
    .from("players")
    .select("id,nickname,avatar,role")
    .eq("user_id", session.uid)
    .order("created_at", { ascending: true })
    .returns<Array<Pick<DbPlayer, "id" | "nickname" | "avatar" | "role">>>();

  if (!players || players.length === 0) redirect("/me");
  if (players.length === 1) redirect(`/player/${players[0].id}`);

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
        ← 首頁
      </Link>
      <h1 className="h-x mt-4 text-2xl">看誰的戰績？</h1>
      <div className="mt-5 space-y-3">
        {players.map((p) => (
          <Link
            key={p.id}
            href={`/player/${p.id}`}
            className="card-x flex items-center gap-4 p-5 transition hover:-translate-y-0.5 hover:border-cyanx/60 hover:shadow-glow"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-arena-line bg-arena text-3xl">
              {p.avatar}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-black">{p.nickname}</p>
              <p className="text-xs text-slate-500">
                {p.role === "parent" ? "家長" : "小孩"}
              </p>
            </div>
            <span className="text-sm text-cyanx">選手卡 →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
