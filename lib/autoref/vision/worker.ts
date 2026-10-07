/**
 * 影像處理 Web Worker：主執行緒把每格 RGBA 丟進來，這裡跑 VisionProcessor 回傳 FrameObs。
 * 不阻塞介面。所有運算在本機完成，不上傳任何影像。
 */
import type { BeyId, FrameObs, Zone } from "../types.ts";
import { fromStored, type StoredCalibration } from "./calibration.ts";
import { DEFAULT_VISION_CONFIG, type VisionConfig } from "./config.ts";
import { VisionProcessor, measureBeyArea, type ClassifiedBlob } from "./pipeline.ts";
import type { SpinMeasure } from "./spin.ts";
import { detectArenaHull } from "./zones.ts";
import type { Point } from "./image.ts";

/** 傳回主執行緒的除錯資料（可結構化複製） */
export interface TrackInfo {
  cx: number;
  cy: number;
  radius: number;
  zone: Zone;
  spinning: boolean | null;
  visible: boolean;
  merged: boolean;
  spin: SpinMeasure | null;
  zoneRatio: { in: number; xtreme: number; over: number };
}

export interface FrameResult {
  type: "frame";
  seq: number;
  obs: FrameObs;
  debug: {
    fgRatio: number;
    shaken: boolean;
    blobs: ClassifiedBlob[];
    handArea: number;
    tracks: Record<BeyId, TrackInfo | null>;
    ms: number;
  };
  /** 除錯模式時附上前景遮罩（width×height，0/1） */
  mask?: ArrayBuffer;
}

export type WorkerRequest =
  | { type: "init"; calibration: StoredCalibration; config: VisionConfig }
  | { type: "config"; config: VisionConfig }
  | { type: "calibration"; calibration: StoredCalibration }
  | { type: "resetTracks" }
  | { type: "frame"; seq: number; buf: ArrayBuffer; t: number; wantMask: boolean }
  | { type: "detectArena"; seq: number; buf: ArrayBuffer; width: number; height: number }
  | {
      type: "measureBey";
      seq: number;
      buf: ArrayBuffer;
      bg: ArrayBuffer;
      width: number;
      height: number;
      config: VisionConfig;
    };

export type WorkerResponse =
  | FrameResult
  | { type: "ready" }
  | { type: "detectArena"; seq: number; hull: Point[] | null }
  | { type: "measureBey"; seq: number; result: { area: number; cx: number; cy: number } | null }
  | { type: "error"; seq?: number; message: string };

let processor: VisionProcessor | null = null;

function post(msg: WorkerResponse, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case "init": {
        processor = new VisionProcessor(fromStored(msg.calibration), msg.config ?? DEFAULT_VISION_CONFIG);
        post({ type: "ready" });
        break;
      }
      case "config":
        processor?.setConfig(msg.config);
        break;
      case "calibration":
        processor?.setCalibration(fromStored(msg.calibration));
        break;
      case "resetTracks":
        processor?.resetTracks();
        break;
      case "frame": {
        if (!processor) {
          post({ type: "error", seq: msg.seq, message: "worker 尚未初始化" });
          break;
        }
        const rgba = new Uint8ClampedArray(msg.buf);
        const r = processor.process(rgba, msg.t);
        const tracks: Record<BeyId, TrackInfo | null> = { A: null, B: null };
        for (const id of ["A", "B"] as BeyId[]) {
          const tr = r.debug.tracks[id];
          tracks[id] = tr
            ? {
                cx: tr.cx,
                cy: tr.cy,
                radius: tr.radius,
                zone: tr.zone,
                spinning: tr.spinning,
                visible: tr.visible,
                merged: tr.merged,
                spin: tr.spin,
                zoneRatio: tr.zoneRatio,
              }
            : null;
        }
        const out: FrameResult = {
          type: "frame",
          seq: msg.seq,
          obs: r.obs,
          debug: {
            fgRatio: r.debug.fgRatio,
            shaken: r.debug.shaken,
            blobs: r.debug.blobs,
            handArea: r.debug.handArea,
            tracks,
            ms: r.debug.ms,
          },
        };
        const transfer: Transferable[] = [];
        if (msg.wantMask) {
          const m = processor.foreground.slice().buffer;
          out.mask = m;
          transfer.push(m);
        }
        post(out, transfer);
        break;
      }
      case "detectArena": {
        const rgba = new Uint8ClampedArray(msg.buf);
        post({ type: "detectArena", seq: msg.seq, hull: detectArenaHull(rgba, msg.width, msg.height) });
        break;
      }
      case "measureBey": {
        const rgba = new Uint8ClampedArray(msg.buf);
        const bg = new Uint8ClampedArray(msg.bg);
        post({
          type: "measureBey",
          seq: msg.seq,
          result: measureBeyArea(rgba, bg, msg.width, msg.height, msg.config),
        });
        break;
      }
    }
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
