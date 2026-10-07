"use client";

/**
 * 瀏覽器端：相機、取格、Worker 包裝。
 *
 * - getUserMedia 後鏡頭，要求 1280×720、60 fps；取不到就退回，畫面顯示實際幀率
 * - requestVideoFrameCallback 取得每格精確時間戳；不支援時退回 requestAnimationFrame
 * - 每格裁切盤面、縮到處理解析度，RGBA buffer 以 transfer 方式丟給 Worker
 */
import type { StoredCalibration } from "./vision/calibration.ts";
import type { VisionConfig } from "./vision/config.ts";
import type { Point, Rect } from "./vision/image.ts";
import type { FrameResult, WorkerRequest, WorkerResponse } from "./vision/worker.ts";

export interface CameraOptions {
  width: number;
  height: number;
  fps: number;
}

export async function openCamera(video: HTMLVideoElement, opt: CameraOptions): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: opt.width },
      height: { ideal: opt.height },
      frameRate: { ideal: opt.fps },
    },
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** 相機實際給的幀率（取不到時 null） */
export function cameraFps(stream: MediaStream | null): number | null {
  const track = stream?.getVideoTracks()[0];
  const fr = track?.getSettings().frameRate;
  return typeof fr === "number" ? fr : null;
}

type FrameCb = (now: number, mediaTime: number) => void;

/**
 * 每格回呼。回傳停止函式。
 * mediaTime 是影片時間（秒）；rAF 退路用 performance.now()/1000。
 */
export function onEachFrame(video: HTMLVideoElement, cb: FrameCb): () => void {
  let stopped = false;
  const v = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  };
  if (typeof v.requestVideoFrameCallback === "function") {
    const loop = (now: number, meta: { mediaTime: number }) => {
      if (stopped) return;
      cb(now, meta.mediaTime);
      v.requestVideoFrameCallback!(loop);
    };
    v.requestVideoFrameCallback(loop);
  } else {
    let lastTime = -1;
    const loop = () => {
      if (stopped) return;
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        cb(performance.now(), video.currentTime);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  return () => {
    stopped = true;
  };
}

/** 依裁切範圍與長邊限制算出處理解析度 */
export function processSize(crop: Rect, longSide: number): { width: number; height: number } {
  const scale = Math.min(1, longSide / Math.max(crop.w, crop.h));
  return {
    width: Math.max(16, Math.round(crop.w * scale)),
    height: Math.max(16, Math.round(crop.h * scale)),
  };
}

/** 把影片的 crop 區域畫到 canvas（處理解析度）並取出 RGBA */
export class FrameGrabber {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  constructor(
    public crop: Rect,
    public width: number,
    public height: number
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas 2d 不可用");
    this.ctx = ctx;
  }

  grab(video: CanvasImageSource): ImageData {
    this.ctx.drawImage(
      video,
      this.crop.x,
      this.crop.y,
      this.crop.w,
      this.crop.h,
      0,
      0,
      this.width,
      this.height
    );
    return this.ctx.getImageData(0, 0, this.width, this.height);
  }
}

/** Worker 包裝：一次只處理一格，忙碌時丟棄新格並計數 */
export class VisionClient {
  private worker: Worker;
  private seq = 0;
  private busy = false;
  private pending = new Map<number, (r: WorkerResponse) => void>();
  dropped = 0;
  onFrame: ((r: FrameResult) => void) | null = null;
  onError: ((msg: string) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL("./vision/worker.ts", import.meta.url));
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === "frame") {
        this.busy = false;
        this.onFrame?.(msg);
        return;
      }
      if (msg.type === "error") {
        this.busy = false;
        this.onError?.(msg.message);
        if (msg.seq !== undefined) this.pending.get(msg.seq)?.(msg);
        return;
      }
      if ("seq" in msg) {
        const cb = this.pending.get(msg.seq);
        this.pending.delete(msg.seq);
        cb?.(msg);
        return;
      }
      if (msg.type === "ready") this.pending.get(-1)?.(msg);
    };
  }

  private send(msg: WorkerRequest, transfer?: Transferable[]) {
    this.worker.postMessage(msg, transfer ?? []);
  }

  init(calibration: StoredCalibration, config: VisionConfig): Promise<void> {
    return new Promise((resolve) => {
      this.pending.set(-1, () => {
        this.pending.delete(-1);
        resolve();
      });
      this.send({ type: "init", calibration, config });
    });
  }

  setConfig(config: VisionConfig) {
    this.send({ type: "config", config });
  }

  setCalibration(calibration: StoredCalibration) {
    this.send({ type: "calibration", calibration });
  }

  resetTracks() {
    this.send({ type: "resetTracks" });
  }

  /** 丟一格；Worker 忙碌時回傳 false 並計入丟棄 */
  pushFrame(img: ImageData, t: number, wantMask: boolean): boolean {
    if (this.busy) {
      this.dropped += 1;
      return false;
    }
    this.busy = true;
    const buf = img.data.buffer as ArrayBuffer;
    this.send({ type: "frame", seq: ++this.seq, buf, t, wantMask }, [buf]);
    return true;
  }

  detectArena(img: ImageData): Promise<Point[] | null> {
    return new Promise((resolve) => {
      const seq = ++this.seq;
      this.pending.set(seq, (r) => resolve(r.type === "detectArena" ? r.hull : null));
      const buf = img.data.buffer as ArrayBuffer;
      this.send({ type: "detectArena", seq, buf, width: img.width, height: img.height }, [buf]);
    });
  }

  measureBey(
    img: ImageData,
    bg: Uint8ClampedArray,
    config: VisionConfig
  ): Promise<{ area: number; cx: number; cy: number } | null> {
    return new Promise((resolve) => {
      const seq = ++this.seq;
      this.pending.set(seq, (r) => resolve(r.type === "measureBey" ? r.result : null));
      const buf = img.data.buffer as ArrayBuffer;
      const bgBuf = bg.buffer.slice(0) as ArrayBuffer;
      this.send(
        { type: "measureBey", seq, buf, bg: bgBuf, width: img.width, height: img.height, config },
        [buf, bgBuf]
      );
    });
  }

  terminate() {
    this.worker.terminate();
  }
}

/** 每局錄影（MediaRecorder），不支援時所有方法為 no-op */
export class BattleRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  readonly supported: boolean;
  private mime = "";

  constructor(private stream: MediaStream) {
    this.supported = typeof MediaRecorder !== "undefined";
    if (this.supported) {
      for (const m of ["video/mp4", "video/webm;codecs=vp9", "video/webm"]) {
        if (MediaRecorder.isTypeSupported(m)) {
          this.mime = m;
          break;
        }
      }
    }
  }

  get recording(): boolean {
    return this.rec?.state === "recording";
  }

  start() {
    if (!this.supported || this.recording) return;
    try {
      this.chunks = [];
      this.rec = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
      this.rec.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      this.rec.start(500);
    } catch {
      this.rec = null;
    }
  }

  stop(): Promise<Blob | null> {
    const rec = this.rec;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || this.mime || "video/webm" });
        this.chunks = [];
        this.rec = null;
        resolve(blob.size > 0 ? blob : null);
      };
      rec.stop();
    });
  }
}
