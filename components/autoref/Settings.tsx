"use client";

/**
 * 設定頁（規格 6.2）：所有門檻可調，附除錯模式。
 */
import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, mergeSettings, type AutorefSettings } from "@/lib/autoref/settings";
import { downloadBlob } from "@/lib/autoref/storage";
import { useAutorefData } from "./useAutoref";

type Path = string[];

function getAt(obj: unknown, path: Path): unknown {
  return path.reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

function setAt<T>(obj: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [k, ...rest] = path;
  const o = obj as unknown as Record<string, unknown>;
  return { ...o, [k]: setAt(o[k], rest, value) } as T;
}

interface Field {
  path: Path;
  label: string;
  step?: number;
  hint?: string;
}

const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: "判定時間（秒）",
    fields: [
      { path: ["rules", "idleClearSec"], label: "盤內清空多久回到待機", step: 0.1 },
      { path: ["rules", "liveConfirmSec"], label: "手離開後兩顆旋轉多久開局", step: 0.1 },
      { path: ["rules", "reverseConfirmSec"], label: "回到對戰區多久算復活", step: 0.05 },
      { path: ["rules", "zoneStopConfirmSec"], label: "進區後停止多久確認", step: 0.1 },
      { path: ["rules", "zoneVanishConfirmSec"], label: "進區後消失多久確認", step: 0.1 },
      { path: ["rules", "zoneStayConfirmSec"], label: "留在區內多久確認", step: 0.5 },
      { path: ["rules", "spinStopConfirmSec"], label: "轉停：訊號低於門檻多久確認", step: 0.05 },
      { path: ["rules", "outOfFrameSec"], label: "非口袋出鏡多久判無法判定", step: 0.1 },
    ],
  },
  {
    title: "分數",
    fields: [
      { path: ["rules", "points", "XTREME_FINISH"], label: "極限終結", step: 1 },
      { path: ["rules", "points", "OVER_FINISH"], label: "出界終結", step: 1 },
      { path: ["rules", "points", "BURST_FINISH"], label: "爆裂終結", step: 1 },
      { path: ["rules", "points", "SPIN_FINISH"], label: "轉停終結", step: 1 },
      { path: ["rules", "winScore"], label: "先得幾分獲勝", step: 1 },
    ],
  },
  {
    title: "前景與面積（比例以校正的陀螺面積為 1）",
    fields: [
      { path: ["vision", "fgThreshold"], label: "前景差值門檻（0–255）", step: 1 },
      { path: ["vision", "openKernel"], label: "開運算核（奇數）", step: 2 },
      { path: ["vision", "closeKernel"], label: "閉運算核（奇數）", step: 2 },
      { path: ["vision", "beyMinRatio"], label: "單顆陀螺面積下限", step: 0.05 },
      { path: ["vision", "beyMaxRatio"], label: "單顆陀螺面積上限", step: 0.05 },
      { path: ["vision", "mergedMaxRatio"], label: "黏合兩顆面積上限", step: 0.05 },
      { path: ["vision", "handBlobRatio"], label: "手或發射器：單一元件下限", step: 0.1 },
      { path: ["vision", "handInsideRatio"], label: "手在盤內：大型元件總面積下限", step: 0.1 },
      { path: ["vision", "maxAspect"], label: "陀螺外接矩形長寬比上限", step: 0.1 },
      { path: ["vision", "zoneInsideRatio"], label: "「完全進入」的重疊比例", step: 0.05 },
      { path: ["vision", "shakeRatio"], label: "整張畫面前景比例超過即提示重校正", step: 0.05 },
    ],
  },
  {
    title: "自轉訊號（運動補償）",
    fields: [
      { path: ["vision", "spin", "angles"], label: "極座標角度取樣數", step: 8 },
      { path: ["vision", "spin", "radii"], label: "極座標半徑取樣數", step: 1 },
      { path: ["vision", "spin", "radiusScale"], label: "取樣半徑比例", step: 0.05 },
      { path: ["vision", "spin", "spinOnDeg"], label: "每格轉幾度以上視為旋轉", step: 0.5 },
      { path: ["vision", "spin", "spinOffDeg"], label: "每格轉幾度以下視為停止", step: 0.5 },
      { path: ["vision", "spin", "minPeak"], label: "互相關峰值下限（量不到的門檻）", step: 0.05 },
      { path: ["vision", "spin", "diffHigh"], label: "簡單差值高於此值一律視為旋轉", step: 5 },
    ],
  },
  {
    title: "相機與效能",
    fields: [
      { path: ["camera", "width"], label: "相機寬度", step: 160 },
      { path: ["camera", "height"], label: "相機高度", step: 90 },
      { path: ["camera", "fps"], label: "要求的幀率", step: 30 },
      { path: ["processLongSide"], label: "處理解析度（長邊像素）", step: 40, hint: "需重新校正才生效" },
    ],
  },
];

export function Settings() {
  const { settings, saveSettings } = useAutorefData();
  const [draft, setDraft] = useState<AutorefSettings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (settings && !draft) setDraft(settings);
  }, [settings, draft]);

  if (!draft) return <p className="text-slate-400">載入中…</p>;

  const num = (path: Path) => {
    const v = getAt(draft, path);
    return typeof v === "number" ? v : 0;
  };

  const save = async () => {
    await saveSettings(draft);
    setMsg("已儲存。對戰頁下次開啟時生效。");
  };

  const exportJson = () => {
    downloadBlob(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }), "autoref-settings.json");
  };

  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      setDraft(mergeSettings(parsed));
      setMsg("已讀入，按儲存才會生效。");
    } catch {
      setMsg("檔案格式不正確。");
    }
  };

  return (
    <div className="space-y-5">
      <section className="card-x space-y-3 p-4">
        <h2 className="h-x">一般</h2>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>除錯模式（顯示前景遮罩與自轉訊號數值）</span>
          <input type="checkbox" checked={draft.debug} onChange={(e) => setDraft(setAt(draft, ["debug"], e.target.checked))} className="h-5 w-5" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>判定時語音播報</span>
          <input type="checkbox" checked={draft.speech} onChange={(e) => setDraft(setAt(draft, ["speech"], e.target.checked))} className="h-5 w-5" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>自動錄下每局影片</span>
          <input type="checkbox" checked={draft.record} onChange={(e) => setDraft(setAt(draft, ["record"], e.target.checked))} className="h-5 w-5" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>平手門檻（秒；空白＝一個畫格間隔）</span>
          <input
            type="number"
            step={0.01}
            min={0}
            value={draft.rules.drawToleranceSec ?? ""}
            onChange={(e) =>
              setDraft(setAt(draft, ["rules", "drawToleranceSec"], e.target.value === "" ? null : Number(e.target.value)))
            }
            className="w-28 rounded-lg border border-arena-line bg-arena-deep px-2 py-1 text-right"
          />
        </label>
      </section>

      {GROUPS.map((g) => (
        <section key={g.title} className="card-x space-y-2 p-4">
          <h2 className="h-x">{g.title}</h2>
          {g.fields.map((f) => (
            <label key={f.path.join(".")} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {f.label}
                {f.hint && <span className="ml-1 text-xs text-slate-500">（{f.hint}）</span>}
              </span>
              <input
                type="number"
                step={f.step ?? 1}
                value={num(f.path)}
                onChange={(e) => setDraft(setAt(draft, f.path, Number(e.target.value)))}
                className="w-28 rounded-lg border border-arena-line bg-arena-deep px-2 py-1 text-right"
              />
            </label>
          ))}
        </section>
      ))}

      {msg && <p className="text-sm text-cyanx">{msg}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-x flex-1" onClick={save}>
          儲存設定
        </button>
        <button
          type="button"
          className="rounded-xl border border-arena-line px-4 py-3 font-bold"
          onClick={() => {
            setDraft(DEFAULT_SETTINGS);
            setMsg("已還原預設值，按儲存才會生效。");
          }}
        >
          還原預設
        </button>
        <button type="button" className="rounded-xl border border-arena-line px-4 py-3 font-bold" onClick={exportJson}>
          匯出
        </button>
        <label className="cursor-pointer rounded-xl border border-arena-line px-4 py-3 font-bold">
          匯入
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}
