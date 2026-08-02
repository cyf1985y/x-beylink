import Link from "next/link";

/** 品牌 LOGO：旋轉中的戰鬥陀螺（X 軸心＋能量環＋速度線） */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-label="X-BeyLink logo"
    >
      <defs>
        <linearGradient id="xb-g" x1="8" y1="8" x2="56" y2="56">
          <stop offset="0" stopColor="#38e0ff" />
          <stop offset="0.5" stopColor="#5b8dff" />
          <stop offset="1" stopColor="#7c5cff" />
        </linearGradient>
      </defs>
      {/* 能量環 */}
      <circle
        cx="32"
        cy="32"
        r="26"
        stroke="url(#xb-g)"
        strokeWidth="3"
        strokeDasharray="118 46"
        strokeLinecap="round"
        className="origin-center animate-spin-slow"
      />
      {/* 速度線 */}
      <path
        d="M6 32a26 26 0 0 1 8-18.7"
        stroke="#38e0ff"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.5"
      />
      {/* 陀螺本體（六角） */}
      <path
        d="M32 12l14.7 8.5v17L32 46l-14.7-8.5v-17L32 12z"
        fill="#0b1026"
        stroke="url(#xb-g)"
        strokeWidth="2.5"
      />
      {/* X 軸心 */}
      <path
        d="M25 24l14 16M39 24L25 40"
        stroke="url(#xb-g)"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      {/* 尖端 */}
      <path d="M32 46l0 8" stroke="url(#xb-g)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ big = false }: { big?: boolean }) {
  return (
    <span
      className={`font-black italic tracking-wide ${big ? "text-4xl" : "text-lg"}`}
    >
      陀螺<span className="text-gradient">集結</span>
      <span
        className={`ml-1.5 align-middle font-num not-italic tracking-widest text-slate-500 ${
          big ? "text-sm" : "text-[10px]"
        }`}
      >
        X-BEYLINK
      </span>
    </span>
  );
}

export function SiteHeader({
  loggedIn,
  isOrganizer,
}: {
  loggedIn: boolean;
  isOrganizer: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-arena-line/60 bg-arena-deep/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark size={30} />
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-1.5 text-sm">
          {loggedIn ? (
            <>
              {isOrganizer && (
                <Link
                  href="/host"
                  className="rounded-lg px-3 py-1.5 text-slate-400 transition hover:bg-arena-card hover:text-violetx"
                >
                  主辦
                </Link>
              )}
              <Link
                href="/me"
                className="rounded-lg border border-cyanx/40 px-3 py-1.5 font-bold text-cyanx transition hover:bg-cyanx/10"
              >
                我的選手
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-[#06C755] px-3.5 py-1.5 font-bold text-white transition hover:brightness-110"
            >
              LINE 登入
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-arena-line/40 py-8 text-center text-xs text-slate-600">
      <div className="flex items-center justify-center gap-2 opacity-60">
        <LogoMark size={18} />
        <span className="font-bold text-slate-500">陀螺集結 X-BeyLink</span>
      </div>
      <p className="mt-2">
        戰鬥陀螺 BEYBLADE X 比賽報名平台｜宜蘭試點｜
        <Link href="/terms" className="underline hover:text-slate-400">
          服務條款
        </Link>
      </p>
    </footer>
  );
}
