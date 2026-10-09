import type { Metadata } from "next";
import { AutorefNav } from "@/components/autoref/AutorefNav";
import { PwaRegister } from "@/components/autoref/PwaRegister";

export const metadata: Metadata = {
  title: "自動裁判｜陀螺集結 X-BeyLink",
  description: "BEYBLADE X 對戰自動判定：手機架在戰鬥盤上方，本機即時判定終結方式與得分",
  manifest: "/autoref/manifest.webmanifest",
};

/** 自動裁判（PWA）：所有運算在手機本機完成，不上傳影像 */
export default function AutorefLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-4">
      <PwaRegister />
      <AutorefNav />
      {children}
    </main>
  );
}
