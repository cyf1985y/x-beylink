import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbPlayer } from "@/lib/supabase";
import { PlayerCard } from "@/components/PlayerCard";
import { NewPlayerForm } from "@/components/PlayerForm";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const db = supabaseAdmin();
  const { data: players } = await db
    .from("players")
    .select("*")
    .eq("user_id", session.uid)
    .order("created_at", { ascending: true })
    .returns<DbPlayer[]>();

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
          ← 首頁
        </Link>
        <form action="/api/auth/logout" method="post">
          <button className="text-sm text-slate-400 hover:text-red-300">
            登出
          </button>
        </form>
      </header>

      <h1 className="mt-4 text-2xl font-black">
        我的選手檔案
        <span className="ml-2 text-sm font-normal text-slate-400">
          {session.name}
        </span>
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        一個帳號可建立多位選手（例如幫家裡的小選手各建一個檔案）。
      </p>

      <section className="mt-6 space-y-4">
        {(players ?? []).length === 0 && (
          <div className="rounded-2xl border border-dashed border-arena-line p-6 text-center text-sm text-slate-500">
            還沒有選手檔案——用下方表單建立第一位選手！
          </div>
        )}
        {(players ?? []).map((p) => (
          <PlayerCard key={p.id} player={p} />
        ))}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-cyanx">＋ 新增選手</h2>
        <div className="mt-3 rounded-2xl border border-arena-line bg-arena-card p-5">
          <NewPlayerForm />
        </div>
      </section>
    </main>
  );
}
