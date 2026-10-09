"use client";

/**
 * 校正頁（規格 6.2）：拍空盤背景 → 自動框出對戰區（可手動修正）→ 標極限區與兩個出界區
 * → 放一顆靜止的陀螺量測面積 → 儲存。
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FrameGrabber,
  VisionClient,
  cameraFps,
  openCamera,
  processSize,
  stopCamera,
} from "@/lib/autoref/client";
import { storage } from "@/lib/autoref/storage";
import {
  fallbackArena,
  presetZones,
  toStored,
  type ZonePolygons,
} from "@/lib/autoref/vision/calibration";
import type { Point, Rect } from "@/lib/autoref/vision/image";
import { drawZones, ZONE_COLOR } from "./overlay";
import { useAutorefData } from "./useAutoref";

type Step = 1 | 2 | 3 | 4;

/** 裁切範圍：紅框外接矩形向外擴 40%（要包含兩側口袋） */
function cropAround(hull: Point[], full: Rect, expand = 0.4): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of hull) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const x0 = Math.max(0, Math.floor(minX - w * expand));
  const y0 = Math.max(0, Math.floor(minY - h * expand));
  const x1 = Math.min(full.w, Math.ceil(maxX + w * expand));
  const y1 = Math.min(full.h, Math.ceil(maxY + h * expand));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

type PolyKey = "in" | "xtreme" | "over0" | "over1";

export function Calibrate() {
  const { settings, calibration: existing } = useAutorefData();
  const videoRef = useRef<HTMLVideoElement>(null);
  const editorRef = useRef<HTMLCanvasElement>(null);
  const liveOverlayRef = useRef<HTMLCanvasElement>(null);
  const fullCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<VisionClient | null>(null);
  const grabberRef = useRef<FrameGrabber | null>(null);

  const [step, setStep] = useState<Step>(1);
  const [camError, setCamError] = useState<string | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [full, setFull] = useState<Rect | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [background, setBackground] = useState<ImageData | null>(null);
  const [zones, setZones] = useState<ZonePolygons | null>(null);
  const [detectNote, setDetectNote] = useState<string | null>(null);
  const [beyArea, setBeyArea] = useState<number | null>(null);
  const [beyAt, setBeyAt] = useState<{ cx: number; cy: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dragRef = useRef<{ key: PolyKey; idx: number } | null>(null);

  const longSide = settings?.processLongSide ?? 480;

  // 開相機
  useEffect(() => {
    if (!settings) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    openCamera(video, settings.camera)
      .then((stream) => {
        if (cancelled) {
          stopCamera(stream);
          return;
        }
        streamRef.current = stream;
        setFps(cameraFps(stream));
        const f = { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
        setFull(f);
        setCrop(f);
      })
      .catch((e) => setCamError(e instanceof Error ? e.message : String(e)));
    clientRef.current = new VisionClient();
    return () => {
      cancelled = true;
      stopCamera(streamRef.current);
      streamRef.current = null;
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, [settings]);

  /** 把目前影片畫面存成全解析度 canvas */
  const snapshotFull = useCallback((): HTMLCanvasElement | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const c = fullCanvasRef.current ?? document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d")!.drawImage(video, 0, 0);
    fullCanvasRef.current = c;
    return c;
  }, []);

  /** 依裁切範圍從全解析度快照取處理解析度影像 */
  const grabFrom = useCallback(
    (src: CanvasImageSource, c: Rect): ImageData => {
      const s = processSize(c, longSide);
      const g = new FrameGrabber(c, s.width, s.height);
      return g.grab(src);
    },
    [longSide]
  );

  // 步驟 1：拍空盤背景
  const captureBackground = useCallback(async () => {
    const snap = snapshotFull();
    const client = clientRef.current;
    if (!snap || !full || !client) return;
    setDetectNote("偵測紅框中…");
    // 先在整張畫面找紅框，再決定裁切範圍
    const whole = grabFrom(snap, full);
    const hull = await client.detectArena(whole);
    let c: Rect;
    let hullProc: Point[];
    if (hull) {
      const sx = full.w / whole.width;
      const sy = full.h / whole.height;
      const hullFull = hull.map((p) => ({ x: p.x * sx, y: p.y * sy }));
      c = cropAround(hullFull, full);
      const s = processSize(c, longSide);
      const kx = s.width / c.w;
      const ky = s.height / c.h;
      hullProc = hullFull.map((p) => ({ x: (p.x - c.x) * kx, y: (p.y - c.y) * ky }));
      setDetectNote(`已自動框出對戰區（${hull.length} 個頂點），可拖曳頂點修正`);
    } else {
      c = full;
      const s = processSize(c, longSide);
      hullProc = fallbackArena(s.width, s.height);
      setDetectNote("找不到紅框，先放一個八邊形，請拖曳頂點對齊對戰區");
    }
    const s = processSize(c, longSide);
    setCrop(c);
    setSize(s);
    const bg = grabFrom(snap, c);
    setBackground(bg);
    setZones(presetZones(hullProc, s.width, s.height));
    setBeyArea(null);
    setBeyAt(null);
    setStep(2);
  }, [snapshotFull, full, grabFrom, longSide]);

  // 編輯畫布：背景圖 + 多邊形
  useEffect(() => {
    const canvas = editorRef.current;
    if (!canvas || !background || !zones) return;
    canvas.width = background.width;
    canvas.height = background.height;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(background, 0, 0);
    drawZones(ctx, zones, true);
    // 頂點
    const drawHandles = (poly: Point[], color: string) => {
      for (const p of poly) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "#04060e";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };
    if (step === 2) drawHandles(zones.in, ZONE_COLOR.in);
    if (step === 3) {
      drawHandles(zones.xtreme, ZONE_COLOR.xtreme);
      zones.over.forEach((p) => drawHandles(p, ZONE_COLOR.over));
    }
    if (beyAt && beyArea) {
      ctx.beginPath();
      ctx.arc(beyAt.cx, beyAt.cy, Math.sqrt(beyArea / Math.PI), 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [background, zones, step, beyAt, beyArea]);

  const polyOf = useCallback(
    (key: PolyKey): Point[] | null => {
      if (!zones) return null;
      if (key === "in") return zones.in;
      if (key === "xtreme") return zones.xtreme;
      return zones.over[key === "over0" ? 0 : 1];
    },
    [zones]
  );

  const toCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = e.currentTarget;
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!zones) return;
    const p = toCanvasCoords(e);
    const keys: PolyKey[] = step === 2 ? ["in"] : ["xtreme", "over0", "over1"];
    let best: { key: PolyKey; idx: number; d: number } | null = null;
    const scale = e.currentTarget.width / e.currentTarget.getBoundingClientRect().width;
    for (const key of keys) {
      const poly = polyOf(key)!;
      poly.forEach((v, idx) => {
        const d = Math.hypot(v.x - p.x, v.y - p.y);
        if (d < 22 * scale && (!best || d < best.d)) best = { key, idx, d };
      });
    }
    if (best) {
      dragRef.current = best;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || !zones) return;
    const p = toCanvasCoords(e);
    const canvas = e.currentTarget;
    const np = {
      x: Math.max(0, Math.min(canvas.width - 1, p.x)),
      y: Math.max(0, Math.min(canvas.height - 1, p.y)),
    };
    setZones((z) => {
      if (!z) return z;
      const copy: ZonePolygons = { in: z.in.slice(), xtreme: z.xtreme.slice(), over: z.over.map((o) => o.slice()) };
      const poly = d.key === "in" ? copy.in : d.key === "xtreme" ? copy.xtreme : copy.over[d.key === "over0" ? 0 : 1];
      poly[d.idx] = np;
      return copy;
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const resetPreset = () => {
    if (!zones || !size) return;
    setZones(presetZones(zones.in, size.width, size.height));
  };

  // 步驟 4：量測陀螺面積（即時畫面）
  useEffect(() => {
    if (step !== 4 || !crop || !size) return;
    grabberRef.current = new FrameGrabber(crop, size.width, size.height);
    const canvas = liveOverlayRef.current;
    if (canvas && zones) {
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, size.width, size.height);
      drawZones(ctx, zones);
    }
  }, [step, crop, size, zones]);

  const measure = async () => {
    const video = videoRef.current;
    const g = grabberRef.current;
    const client = clientRef.current;
    if (!video || !g || !client || !background || !settings) return;
    const img = g.grab(video);
    const r = await client.measureBey(img, background.data, settings.vision);
    if (!r) {
      setBeyArea(null);
      setDetectNote("沒有偵測到陀螺，請確認陀螺放在盤內且光線與拍背景時相同");
      return;
    }
    setBeyArea(Math.round(r.area));
    setBeyAt({ cx: r.cx, cy: r.cy });
    setDetectNote(`量到陀螺面積 ${Math.round(r.area)} 像素（直徑約 ${Math.round(2 * Math.sqrt(r.area / Math.PI))} 像素）`);
  };

  const save = async () => {
    if (!crop || !size || !background || !zones || !beyArea) return;
    setSaving(true);
    try {
      await storage.putCalibration(
        toStored({
          width: size.width,
          height: size.height,
          crop,
          background: background.data,
          zones,
          beyArea,
          createdAt: Date.now(),
        })
      );
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const showEditor = (step === 2 || step === 3) && background;
  const showLive = step === 1 || step === 4;

  return (
    <div className="space-y-4">
      <ol className="grid grid-cols-4 gap-1 text-center text-xs">
        {["拍空盤背景", "框出對戰區", "標極限／出界區", "量陀螺面積"].map((label, i) => {
          const n = (i + 1) as Step;
          return (
            <li
              key={label}
              className={`rounded-lg border px-1 py-2 ${
                step === n ? "border-cyanx bg-cyanx/10 text-cyanx" : step > n ? "border-arena-line text-slate-400" : "border-arena-line text-slate-600"
              }`}
            >
              {n}. {label}
            </li>
          );
        })}
      </ol>

      {camError && (
        <p className="rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">
          無法開啟相機：{camError}。請確認已允許相機權限，並使用 https 或 localhost。
        </p>
      )}

      <div className="card-x relative overflow-hidden">
        <video
          ref={videoRef}
          className={`block w-full ${showLive ? "" : "hidden"}`}
          autoPlay
          muted
          playsInline
        />
        {step === 4 && size && (
          <canvas
            ref={liveOverlayRef}
            className="pointer-events-none absolute"
            style={
              crop && full
                ? {
                    left: `${(crop.x / full.w) * 100}%`,
                    top: `${(crop.y / full.h) * 100}%`,
                    width: `${(crop.w / full.w) * 100}%`,
                    height: `${(crop.h / full.h) * 100}%`,
                  }
                : undefined
            }
          />
        )}
        {showEditor && (
          <canvas
            ref={editorRef}
            className="block w-full touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        )}
        {fps !== null && step === 1 && (
          <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-slate-200">
            相機 {Math.round(fps)} fps
          </span>
        )}
      </div>

      {detectNote && <p className="text-sm text-slate-300">{detectNote}</p>}

      {step === 1 && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">
            手機固定在盤面正上方、鏡頭垂直朝下，畫面要完整包含紅框、極限區與兩側口袋。盤內清空、光線穩定後按下拍攝。
          </p>
          {existing && (
            <p className="text-xs text-slate-500">
              目前已有 {new Date(existing.createdAt).toLocaleString("zh-TW")} 的校正資料，重新校正會覆蓋。
            </p>
          )}
          <button type="button" className="btn-x w-full" onClick={captureBackground} disabled={!full}>
            拍攝空盤背景
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">
            青色是對戰區（紅框內緣）。拖曳頂點修正到貼合紅框內側。
          </p>
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded-xl border border-arena-line px-4 py-3 font-bold" onClick={() => setStep(1)}>
              重拍背景
            </button>
            <button type="button" className="btn-x flex-1" onClick={() => setStep(3)}>
              下一步
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">
            金色是極限區（下方），紅色是兩個出界區（左右口袋）。拖曳頂點對齊實際的口袋，口袋要延伸到畫面邊緣，陀螺掉進去出鏡才算出界。
          </p>
          <div className="flex gap-2">
            <button type="button" className="rounded-xl border border-arena-line px-4 py-3 font-bold" onClick={() => setStep(2)}>
              上一步
            </button>
            <button type="button" className="rounded-xl border border-arena-line px-4 py-3 font-bold" onClick={resetPreset}>
              重設範本
            </button>
            <button type="button" className="btn-x flex-1" onClick={() => setStep(4)}>
              下一步
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">
            在對戰區內放一顆靜止的陀螺（不要有手在畫面內），按「量測」。所有面積門檻都以這個值為基準。
          </p>
          <div className="flex gap-2">
            <button type="button" className="rounded-xl border border-arena-line px-4 py-3 font-bold" onClick={() => setStep(3)}>
              上一步
            </button>
            <button type="button" className="rounded-xl border border-cyanx/60 px-4 py-3 font-bold text-cyanx" onClick={measure}>
              量測
            </button>
            <button type="button" className="btn-x flex-1" onClick={save} disabled={!beyArea || saving}>
              {saving ? "儲存中…" : "儲存校正"}
            </button>
          </div>
          {saved && (
            <p className="rounded-xl border border-cyanx/40 bg-cyanx/10 p-3 text-sm">
              校正已儲存。
              <Link href="/autoref/battle" className="ml-2 font-bold text-cyanx underline">
                前往對戰頁 →
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
