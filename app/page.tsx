import Link from "next/link";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <header className="text-center">
        <div className="text-5xl">🌀</div>
        <h1 className="mt-3 text-3xl font-black tracking-wide">
          陀螺<span className="text-cyanx">集結</span>
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          戰鬥陀螺 BEYBLADE X 比賽報名平台｜宜蘭試點
        </p>
      </header>

      <section className="mt-10 rounded-2xl border border-arena-line bg-arena-card p-6 text-center shadow-glow">
        {session ? (
          <>
            <p className="text-sm text-slate-300">
              歡迎回來，<span className="font-bold text-cyanx">{session.name}</span>
            </p>
            <Link
              href="/me"
              className="mt-4 inline-block rounded-xl bg-cyanx px-6 py-3 font-bold text-arena transition hover:brightness-110"
            >
              管理我的選手檔案
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-300">
              用 LINE 登入，建立選手檔案，準備開打！
            </p>
            <Link
              href="/login"
              className="mt-4 inline-block rounded-xl bg-[#06C755] px-6 py-3 font-bold text-white transition hover:brightness-110"
            >
              LINE 登入
            </Link>
          </>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-dashed border-arena-line p-6 text-center">
        <p className="text-sm text-slate-500">
          🏟️ 賽事列表即將登場（M2）——先把選手檔案建好吧！
        </p>
      </section>
    </main>
  );
}
