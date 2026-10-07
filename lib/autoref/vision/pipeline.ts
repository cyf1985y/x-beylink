/**
 * 影像管線（規格 4.1）：每格 RGBA → FrameObs。
 *
 * 前景分割 → 連通元件分類 → 區域判定（遮罩與區域的重疊比例）→ 追蹤 → 自轉訊號。
 * 可在 Web Worker 與 Node 執行（測試用合成影像）。
 */
import type { BeyId, BeyObs, FrameObs, Zone } from "../types.ts";
import {
  buildZoneMap,
  ZONE_IN,
  ZONE_OVER,
  ZONE_XTREME,
  type Calibration,
} from "./calibration.ts";
import { DEFAULT_VISION_CONFIG, type VisionConfig } from "./config.ts";
import {
  close,
  connectedComponents,
  foregroundMask,
  open,
  toGray,
  type Blob,
} from "./image.ts";
import { decideSpinning, maskedDiff, measureSpin, type SpinMeasure } from "./spin.ts";

export type BlobClass = "bey" | "merged" | "hand" | "discard";

export interface ClassifiedBlob extends Blob {
  cls: BlobClass;
}

export interface BeyTrack {
  id: BeyId;
  cx: number;
  cy: number;
  radius: number;
  zone: Zone;
  spinning: boolean | null;
  visible: boolean;
  /** 連續看不到的格數 */
  missing: number;
  /** 色彩直方圖（黏合分開後重新配對用） */
  hist: Float32Array | null;
  /** 本格是否處於黏合狀態 */
  merged: boolean;
  /** 本格的自轉量測 */
  spin: SpinMeasure | null;
  /** 本格落在各區的像素比例 */
  zoneRatio: { in: number; xtreme: number; over: number };
}

export interface FrameDebug {
  /** 整張畫面的前景像素比例 */
  fgRatio: number;
  /** 疑似鏡頭晃動或光線改變 */
  shaken: boolean;
  blobs: ClassifiedBlob[];
  handArea: number;
  tracks: Record<BeyId, BeyTrack | null>;
  /** 處理時間（毫秒） */
  ms: number;
}

export interface ProcessResult {
  obs: FrameObs;
  debug: FrameDebug;
}

const HIST_BINS = 20; // 16 個色相 + 4 個低飽和灰階

function histogramOf(
  rgba: Uint8ClampedArray,
  labels: Int32Array,
  label: number,
  bbox: Blob["bbox"],
  w: number
): Float32Array {
  const hist = new Float32Array(HIST_BINS);
  let n = 0;
  for (let y = bbox.y; y < bbox.y + bbox.h; y++) {
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      const i = y * w + x;
      if (labels[i] !== label) continue;
      const j = i * 4;
      const r = rgba[j];
      const g = rgba[j + 1];
      const b = rgba[j + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      const s = max === 0 ? 0 : d / max;
      if (s < 0.2) {
        hist[16 + Math.min(3, max >> 6)] += 1;
      } else {
        let hue = 0;
        if (max === r) hue = (60 * ((g - b) / d) + 360) % 360;
        else if (max === g) hue = 60 * ((b - r) / d) + 120;
        else hue = 60 * ((r - g) / d) + 240;
        hist[Math.min(15, Math.floor((hue / 360) * 16))] += 1;
      }
      n++;
    }
  }
  if (n > 0) for (let k = 0; k < HIST_BINS; k++) hist[k] /= n;
  return hist;
}

function histSimilarity(a: Float32Array | null, b: Float32Array | null): number {
  if (!a || !b) return 0;
  let s = 0;
  for (let k = 0; k < HIST_BINS; k++) s += Math.min(a[k], b[k]);
  return s;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** 本格偵測到的陀螺候選 */
interface Candidate {
  blob: ClassifiedBlob;
  merged: boolean;
}

export class VisionProcessor {
  readonly width: number;
  readonly height: number;
  config: VisionConfig;
  private calib: Calibration;
  private zoneMap: Uint8Array;
  private readonly gray: Uint8Array;
  private prevGray: Uint8Array | null = null;
  private readonly grayBuf: Uint8Array;
  private readonly mask: Uint8Array;
  private readonly tmpA: Uint8Array;
  private readonly tmpB: Uint8Array;
  private readonly labels: Int32Array;
  private readonly polarScratch: { a: Float32Array; b: Float32Array };
  tracks: Record<BeyId, BeyTrack | null> = { A: null, B: null };
  private prevMerged = false;

  constructor(calib: Calibration, config: VisionConfig = DEFAULT_VISION_CONFIG) {
    this.calib = calib;
    this.config = config;
    this.width = calib.width;
    this.height = calib.height;
    const n = this.width * this.height;
    this.zoneMap = buildZoneMap(calib.zones, this.width, this.height);
    this.gray = new Uint8Array(n);
    this.grayBuf = new Uint8Array(n);
    this.mask = new Uint8Array(n);
    this.tmpA = new Uint8Array(n);
    this.tmpB = new Uint8Array(n);
    this.labels = new Int32Array(n);
    const s = config.spin.angles * config.spin.radii;
    this.polarScratch = { a: new Float32Array(s), b: new Float32Array(s) };
  }

  setConfig(config: VisionConfig) {
    this.config = config;
  }

  setCalibration(calib: Calibration) {
    if (calib.width !== this.width || calib.height !== this.height) {
      throw new Error("calibration size mismatch");
    }
    this.calib = calib;
    this.zoneMap = buildZoneMap(calib.zones, this.width, this.height);
  }

  /** 清掉追蹤身分（每局開始前） */
  resetTracks() {
    this.tracks = { A: null, B: null };
    this.prevMerged = false;
  }

  get beyArea(): number {
    return this.calib.beyArea;
  }

  /** 前景分割＋形態學，結果在 this.mask */
  private segment(rgba: Uint8ClampedArray): number {
    const { width: w, height: h } = this;
    const c = this.config;
    foregroundMask(rgba, this.calib.background, w, h, c.fgThreshold, this.mask);
    let fg = 0;
    for (let i = 0; i < this.mask.length; i++) fg += this.mask[i];
    open(this.mask, w, h, c.openKernel, this.tmpA, this.tmpB);
    close(this.tmpB, w, h, c.closeKernel, this.tmpA, this.mask);
    return fg / this.mask.length;
  }

  private classify(blobs: Blob[]): ClassifiedBlob[] {
    const c = this.config;
    const A = this.calib.beyArea;
    const out: ClassifiedBlob[] = [];
    for (const b of blobs) {
      let cls: BlobClass;
      const aspect = Math.max(b.bbox.w, b.bbox.h) / Math.max(1, Math.min(b.bbox.w, b.bbox.h));
      if (b.area >= c.handBlobRatio * A) cls = "hand";
      else if (b.area > c.beyMaxRatio * A && b.area <= c.mergedMaxRatio * A) {
        // 兩顆並排的長寬比約 2，長寬比門檻只套用在單顆尺寸的元件
        cls = aspect <= c.maxAspect * 1.3 ? "merged" : "discard";
      } else if (aspect > c.maxAspect) cls = "discard";
      else if (b.area >= c.beyMinRatio * A && b.area <= c.beyMaxRatio * A) cls = "bey";
      else cls = "discard";
      out.push({ ...b, cls });
    }
    return out;
  }

  private zoneRatios(b: Blob): { in: number; xtreme: number; over: number } {
    const w = this.width;
    let zin = 0;
    let zx = 0;
    let zo = 0;
    for (let y = b.bbox.y; y < b.bbox.y + b.bbox.h; y++) {
      for (let x = b.bbox.x; x < b.bbox.x + b.bbox.w; x++) {
        const i = y * w + x;
        if (this.labels[i] !== b.label) continue;
        const z = this.zoneMap[i];
        if (z === ZONE_IN) zin++;
        else if (z === ZONE_XTREME) zx++;
        else if (z === ZONE_OVER) zo++;
      }
    }
    return { in: zin / b.area, xtreme: zx / b.area, over: zo / b.area };
  }

  private zoneOf(r: { in: number; xtreme: number; over: number }, prev: Zone): Zone {
    const thr = this.config.zoneInsideRatio;
    if (r.over >= thr) return "OVER";
    if (r.xtreme >= thr) return "XTREME";
    if (r.in >= thr) return "IN";
    // 尚未「完全進入」任何一區：沿用上一格
    return prev;
  }

  /** 候選配對到 A／B */
  private assign(cands: Candidate[], rgba: Uint8ClampedArray): Record<BeyId, Candidate | null> {
    const tA = this.tracks.A;
    const tB = this.tracks.B;
    const result: Record<BeyId, Candidate | null> = { A: null, B: null };
    if (cands.length === 0) return result;

    if (!tA && !tB) {
      // 開局：依首次出現的位置，左 A 右 B
      const sorted = cands.slice().sort((p, q) => p.blob.cx - q.blob.cx);
      result.A = sorted[0];
      if (sorted.length > 1) result.B = sorted[sorted.length - 1];
      return result;
    }

    const d = (t: BeyTrack | null, c: Candidate) => (t ? dist(t.cx, t.cy, c.blob.cx, c.blob.cy) : Infinity);
    if (cands.length === 1) {
      const c = cands[0];
      if (c.merged) {
        result.A = c;
        result.B = c;
        return result;
      }
      const dA = d(tA, c);
      const dB = d(tB, c);
      if (dA <= dB) result.A = c;
      else result.B = c;
      return result;
    }

    // 兩個以上：先挑離前一格最近的兩個
    let pool = cands;
    if (pool.length > 2) {
      pool = cands
        .map((c) => ({ c, s: Math.min(d(tA, c), d(tB, c)) }))
        .sort((p, q) => p.s - q.s)
        .slice(0, 2)
        .map((p) => p.c);
    }
    const [c0, c1] = pool;
    const cost01 = d(tA, c0) + d(tB, c1);
    const cost10 = d(tA, c1) + d(tB, c0);
    const diameter = 2 * Math.sqrt(this.calib.beyArea / Math.PI);
    const ambiguous = this.prevMerged || Math.abs(cost01 - cost10) < diameter;
    if (ambiguous && tA?.hist && tB?.hist) {
      // 黏合再分開：用色彩直方圖重新配對
      const h0 = histogramOf(rgba, this.labels, c0.blob.label, c0.blob.bbox, this.width);
      const h1 = histogramOf(rgba, this.labels, c1.blob.label, c1.blob.bbox, this.width);
      const s01 = histSimilarity(tA.hist, h0) + histSimilarity(tB.hist, h1);
      const s10 = histSimilarity(tA.hist, h1) + histSimilarity(tB.hist, h0);
      if (s01 >= s10) {
        result.A = c0;
        result.B = c1;
      } else {
        result.A = c1;
        result.B = c0;
      }
      return result;
    }
    if (cost01 <= cost10) {
      result.A = c0;
      result.B = c1;
    } else {
      result.A = c1;
      result.B = c0;
    }
    return result;
  }

  process(rgba: Uint8ClampedArray, t: number): ProcessResult {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const { width: w, height: h } = this;
    const c = this.config;
    const A = this.calib.beyArea;

    toGray(rgba, w, h, this.gray);
    const fgRatio = this.segment(rgba);
    const shaken = fgRatio > c.shakeRatio;
    const raw = connectedComponents(this.mask, w, h, this.labels, Math.floor(c.beyMinRatio * A * 0.5));
    const blobs = this.classify(raw);

    let handArea = 0;
    for (const b of blobs) if (b.cls === "hand") handArea += b.area;
    const hand = handArea >= c.handInsideRatio * A;

    // 候選陀螺
    const cands: Candidate[] = [];
    const diameter = 2 * Math.sqrt(A / Math.PI);
    const tA = this.tracks.A;
    const tB = this.tracks.B;
    const bothClose =
      !!tA && !!tB && tA.visible && tB.visible && dist(tA.cx, tA.cy, tB.cx, tB.cy) < c.mergeDistanceScale * diameter;
    for (const b of blobs) {
      if (b.cls === "bey") cands.push({ blob: b, merged: false });
      else if (b.cls === "merged") {
        // 單顆因模糊而變大時會被誤算成兩顆：只有前一格兩顆很近才允許視為黏合
        if (bothClose || this.prevMerged) cands.push({ blob: b, merged: true });
        else cands.push({ blob: b, merged: false });
      }
    }
    // 黏合的候選代表兩顆，不能再與其他候選搶配對
    const mergedCand = cands.find((x) => x.merged);
    const assigned = mergedCand ? { A: mergedCand, B: mergedCand } : this.assign(cands, rgba);

    const beys: BeyObs[] = [];
    let anyMerged = false;
    for (const id of ["A", "B"] as BeyId[]) {
      const cand = assigned[id];
      const prev = this.tracks[id];
      if (!cand) {
        if (prev) {
          prev.visible = false;
          prev.missing += 1;
          prev.spin = null;
          prev.merged = false;
          beys.push({ id, visible: false, zone: prev.zone, spinning: null, x: prev.cx, y: prev.cy });
        }
        continue;
      }
      const b = cand.blob;
      const radius = cand.merged ? Math.sqrt(b.area / (2 * Math.PI)) : Math.sqrt(b.area / Math.PI);
      const ratios = this.zoneRatios(b);
      const zone = this.zoneOf(ratios, prev?.zone ?? "IN");
      let spin: SpinMeasure | null = null;
      let spinning: boolean | null = prev?.spinning ?? null;
      if (cand.merged) {
        anyMerged = true;
        spinning = null;
      } else if (prev && prev.visible && this.prevGray && !prev.merged) {
        const diff = maskedDiff(this.prevGray, this.gray, this.labels, b.label, b.bbox, w);
        spin = measureSpin(
          this.prevGray,
          this.gray,
          w,
          h,
          prev.cx,
          prev.cy,
          b.cx,
          b.cy,
          radius,
          diff,
          c.spin,
          this.polarScratch
        );
        spinning = decideSpinning(spin, prev.spinning, c.spin);
      }
      let hist = prev?.hist ?? null;
      if (!cand.merged) {
        const hNow = histogramOf(rgba, this.labels, b.label, b.bbox, w);
        if (hist) for (let k = 0; k < HIST_BINS; k++) hist[k] = hist[k] * 0.8 + hNow[k] * 0.2;
        else hist = hNow;
      }
      const track: BeyTrack = {
        id,
        cx: b.cx,
        cy: b.cy,
        radius,
        zone,
        spinning,
        visible: true,
        missing: 0,
        hist,
        merged: cand.merged,
        spin,
        zoneRatio: ratios,
      };
      this.tracks[id] = track;
      beys.push({ id, visible: true, zone, spinning, x: b.cx, y: b.cy });
    }
    this.prevMerged = anyMerged;

    // 交換灰階緩衝
    if (!this.prevGray) this.prevGray = this.grayBuf;
    this.prevGray.set(this.gray);

    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      obs: { t, hand, beys },
      debug: {
        fgRatio,
        shaken,
        blobs,
        handArea,
        tracks: { A: this.tracks.A, B: this.tracks.B },
        ms: t1 - t0,
      },
    };
  }

  /** 目前的前景遮罩（除錯顯示用，呼叫端自行複製） */
  get foreground(): Uint8Array {
    return this.mask;
  }
}

/**
 * 校正步驟「放一顆靜止的陀螺量測面積」：回傳最大的圓形前景元件面積，找不到為 null。
 */
export function measureBeyArea(
  rgba: Uint8ClampedArray,
  background: Uint8ClampedArray,
  w: number,
  h: number,
  config: VisionConfig = DEFAULT_VISION_CONFIG
): { area: number; cx: number; cy: number } | null {
  const mask = foregroundMask(rgba, background, w, h, config.fgThreshold);
  const tmp = new Uint8Array(w * h);
  const o = open(mask, w, h, config.openKernel, tmp);
  const cl = close(o, w, h, config.closeKernel, tmp);
  const labels = new Int32Array(w * h);
  const blobs = connectedComponents(cl, w, h, labels, 50);
  const round = blobs.filter((b) => {
    const aspect = Math.max(b.bbox.w, b.bbox.h) / Math.max(1, Math.min(b.bbox.w, b.bbox.h));
    return aspect <= config.maxAspect;
  });
  if (round.length === 0) return null;
  round.sort((a, b) => b.area - a.area);
  return { area: round[0].area, cx: round[0].cx, cy: round[0].cy };
}
