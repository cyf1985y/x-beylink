import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "陀螺集結 X-BeyLink",
  description: "戰鬥陀螺 BEYBLADE X 比賽報名平台 — 揪團開打、累積獎盃",
};

export const viewport: Viewport = {
  themeColor: "#0b1026",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant-TW">
      <body className="text-slate-100 antialiased">{children}</body>
    </html>
  );
}
