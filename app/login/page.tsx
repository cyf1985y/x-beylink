import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LogoMark } from "@/components/Brand";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const session = await getSession();
  if (session) redirect("/me");

  const isDev = process.env.NODE_ENV !== "production";

  return (
    <main className="mx-auto flex max-w-md flex-col justify-center px-4 py-16">
      <div className="card-x p-8 text-center">
        <div className="mx-auto w-fit animate-floaty">
          <LogoMark size={72} />
        </div>
        <h1 className="mt-4 text-2xl font-black italic">
          登入<span className="text-gradient">陀螺集結</span>
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          使用 LINE 帳號登入，一個帳號可建立多位選手（例如家長幫小孩建檔）。
        </p>

        {searchParams.error && (
          <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {searchParams.error}
          </p>
        )}

        <a
          href="/api/auth/line"
          className="mt-6 block rounded-xl bg-[#06C755] px-6 py-3.5 font-black tracking-wider text-white transition hover:brightness-110 active:scale-95"
        >
          使用 LINE 登入
        </a>

        {isDev && (
          <a
            href="/api/auth/dev?as=tester1"
            className="mt-3 block rounded-xl border border-arena-line px-6 py-3 text-sm text-slate-400 transition hover:border-cyanx hover:text-cyanx"
          >
            開發模式假登入（僅本地開發可用）
          </a>
        )}

        <Link
          href="/"
          className="mt-6 block text-sm text-slate-500 hover:text-slate-300"
        >
          ← 回首頁
        </Link>
      </div>
    </main>
  );
}
