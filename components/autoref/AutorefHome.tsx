"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { storage } from "@/lib/autoref/storage";
import { useAutorefData } from "./useAutoref";

/** 自動裁判總覽：校正狀態、儲存用量、四個頁面入口 */
export function AutorefHome() {
  const { calibration, settings } = useAutorefData();
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [matchCount, setMatchCount] = useState<number | null>(null);

  useEffect(() => {
    storage.estimate().then(setUsage);
    storage.listMatches().then((m) => setMatchCount(m.length));
  }, []);

  const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;

  return (
    <div className="space-y-4">
      <section className="card-x space-y-2 p-5">
        <h1 className="text-2xl font-black">自動裁判（雛形）</h1>
        <p className="text-sm text-slate-300">
          手機架在戰鬥盤正上方約 40–60 公分、鏡頭垂直朝下。相機畫面全部在手機本機運算，不上傳影像、不呼叫任何雲端服務。
          判定出界終結、極限終結、轉停終結，以及手在判定前進入；爆裂終結用手動按鈕。
        </p>
        <p className="text-xs text-slate-500">
          加到主畫面後可離線使用。每個判定都可以在判定卡上確認、改判或重賽不計分，程式的原始判定會保留。
        </p>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <Link href="/autoref/calibrate" className="card-x p-4">
          <div className="text-lg font-bold">🎯 校正</div>
          <div className="mt-1 text-xs text-slate-400">
            {calibration === undefined
              ? "讀取中…"
              : calibration
                ? `已校正 ${new Date(calibration.createdAt).toLocaleString("zh-TW")}，處理 ${calibration.width}×${calibration.height}`
                : "尚未校正，先做這一步"}
          </div>
        </Link>
        <Link href="/autoref/battle" className={`card-x p-4 ${calibration ? "" : "opacity-60"}`}>
          <div className="text-lg font-bold">⚔️ 對戰</div>
          <div className="mt-1 text-xs text-slate-400">即時判定、比分、判定卡、錄影</div>
        </Link>
        <Link href="/autoref/replay" className="card-x p-4">
          <div className="text-lg font-bold">🎬 回放</div>
          <div className="mt-1 text-xs text-slate-400">{matchCount === null ? "…" : `${matchCount} 場比賽`}，逐格檢視與匯出</div>
        </Link>
        <Link href="/autoref/settings" className="card-x p-4">
          <div className="text-lg font-bold">⚙️ 設定</div>
          <div className="mt-1 text-xs text-slate-400">
            所有門檻、分數表{settings?.debug ? "・除錯模式開啟" : ""}
          </div>
        </Link>
      </section>

      <section className="card-x space-y-1 p-4 text-xs text-slate-400">
        <p>儲存空間：{usage ? `${mb(usage.usage)} / ${mb(usage.quota)}` : "—"}（影片存在手機本機 IndexedDB，可在回放頁刪除）</p>
        <p>拍攝條件：光線均勻、避免盤蓋反光與人影掃過；光線改變後要重拍背景；手機與支架不可晃動。</p>
        <p>iPhone Safari 有時只給 30 fps，且無法鎖定曝光與對焦，這是網頁版的已知限制。</p>
      </section>
    </div>
  );
}
