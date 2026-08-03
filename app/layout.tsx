import type { Metadata, Viewport } from "next";
import { getSession } from "@/lib/session";
import { SiteHeader, SiteFooter } from "@/components/Brand";
import "./globals.css";

export const metadata: Metadata = {
  title: "陀螺集結 X-BeyLink｜戰鬥陀螺比賽報名平台",
  description:
    "戰鬥陀螺 BEYBLADE X 比賽報名平台 — 揪團開打、QR 報到、對戰表、數位獎盃",
};

export const viewport: Viewport = {
  themeColor: "#0b1026",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 導覽列只讀 cookie session，不查資料庫（效能：每頁省一次 DB 往返）
  const session = await getSession();

  return (
    <html lang="zh-Hant-TW">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&family=Rajdhani:wght@600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans text-slate-100 antialiased">
        <SiteHeader loggedIn={!!session} />
        <div className="min-h-[70vh]">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
