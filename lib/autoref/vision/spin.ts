/**
 * 自轉訊號（規格 4.3 運動補償版）。
 *
 * 1. 以陀螺質心為中心，從前後兩格各裁出同尺寸對齊小圖，消除平移。
 * 2. 轉成極座標：旋轉變成角度軸上的平移。
 * 3. 對角度軸做循環互相關，峰值位置即每格旋轉角度；除以畫格間隔得角速度。
 * 4. 角速度的符號是旋轉方向，反轉時符號翻轉。
 *
 * 高速時每格轉超過半圈會混疊，量不出正確轉速；但只需判斷「是否趨近於零」，低速段是準的。
 * 另外保留規格的簡單版訊號（遮罩內前後格灰階平均絕對差）當除錯顯示與高速段的輔助。
 */
import { sampleBilinear } from "./image.ts";

export interface SpinConfig {
  /** 極座標角度取樣數（圓周分幾格） */
  angles: number;
  /** 極座標半徑取樣數（取幾圈） */
  radii: number;
  /** 取樣半徑 = 陀螺半徑 × 此比例（略小於 1 避開邊緣的背景） */
  radiusScale: number;
  /** 每格旋轉角度（度）高於此值視為旋轉 */
  spinOnDeg: number;
  /** 每格旋轉角度（度）低於此值視為停止 */
  spinOffDeg: number;
  /** 互相關峰值的正規化分數低於此值視為量不到 */
  minPeak: number;
  /** 簡單差值訊號高於此值一律視為旋轉（高速模糊，極座標法混疊） */
  diffHigh: number;
}

export const DEFAULT_SPIN_CONFIG: SpinConfig = {
  angles: 72,
  radii: 10,
  radiusScale: 0.85,
  spinOnDeg: 6,
  spinOffDeg: 3,
  minPeak: 0.35,
  diffHigh: 60,
};

export interface SpinMeasure {
  /** 每格旋轉角度（度，帶符號）；量不到時為 null */
  deltaDeg: number | null;
  /** 互相關峰值的正規化分數（-1..1） */
  peak: number;
  /** 簡單差值訊號（遮罩內平均絕對差） */
  diff: number;
}

/** 極座標展開：回傳 radii × angles 的浮點陣列，每圈已減去平均值 */
export function polarPatch(
  gray: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  cfg: SpinConfig,
  out?: Float32Array
): Float32Array {
  const { angles: N, radii: M } = cfg;
  const p = out ?? new Float32Array(N * M);
  for (let j = 0; j < M; j++) {
    const r = ((j + 1) / (M + 0.5)) * radius;
    let mean = 0;
    const base = j * N;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const v = sampleBilinear(gray, w, h, cx + r * Math.cos(a), cy + r * Math.sin(a));
      p[base + k] = v;
      mean += v;
    }
    mean /= N;
    for (let k = 0; k < N; k++) p[base + k] -= mean;
  }
  return p;
}

/**
 * 兩張極座標小圖沿角度軸的循環互相關，回傳最佳位移（格）與正規化峰值。
 * 位移以 (-N/2, N/2] 表示，帶符號；用拋物線內插到次格精度。
 */
export function polarCorrelate(a: Float32Array, b: Float32Array, cfg: SpinConfig): { shift: number; peak: number } {
  const { angles: N, radii: M } = cfg;
  const corr = new Float64Array(N);
  let ea = 0;
  let eb = 0;
  for (let i = 0; i < N * M; i++) {
    ea += a[i] * a[i];
    eb += b[i] * b[i];
  }
  const norm = Math.sqrt(ea * eb);
  if (norm < 1e-6) return { shift: 0, peak: 0 };
  for (let s = 0; s < N; s++) {
    let acc = 0;
    for (let j = 0; j < M; j++) {
      const base = j * N;
      for (let k = 0; k < N; k++) {
        acc += a[base + k] * b[base + ((k + s) % N)];
      }
    }
    corr[s] = acc / norm;
  }
  let best = 0;
  for (let s = 1; s < N; s++) if (corr[s] > corr[best]) best = s;
  // 拋物線內插
  const c0 = corr[(best - 1 + N) % N];
  const c1 = corr[best];
  const c2 = corr[(best + 1) % N];
  const denom = c0 - 2 * c1 + c2;
  const frac = Math.abs(denom) < 1e-9 ? 0 : (0.5 * (c0 - c2)) / denom;
  let shift = best + frac;
  if (shift > N / 2) shift -= N;
  return { shift, peak: c1 };
}

/** 遮罩內前後格的平均絕對差（規格的簡單版訊號） */
export function maskedDiff(
  prev: Uint8Array,
  cur: Uint8Array,
  labels: Int32Array,
  label: number,
  bbox: { x: number; y: number; w: number; h: number },
  w: number
): number {
  let sum = 0;
  let n = 0;
  for (let y = bbox.y; y < bbox.y + bbox.h; y++) {
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      const i = y * w + x;
      if (labels[i] !== label) continue;
      sum += Math.abs(cur[i] - prev[i]);
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * 量測一顆陀螺在前後兩格之間的旋轉角度。
 * prevCx/prevCy 與 cx/cy 分別是前後格的質心（各自對齊，消除平移）。
 */
export function measureSpin(
  prevGray: Uint8Array,
  curGray: Uint8Array,
  w: number,
  h: number,
  prevCx: number,
  prevCy: number,
  cx: number,
  cy: number,
  radius: number,
  diff: number,
  cfg: SpinConfig,
  scratch?: { a: Float32Array; b: Float32Array }
): SpinMeasure {
  const r = radius * cfg.radiusScale;
  if (r < 3) return { deltaDeg: null, peak: 0, diff };
  const a = polarPatch(prevGray, w, h, prevCx, prevCy, r, cfg, scratch?.a);
  const b = polarPatch(curGray, w, h, cx, cy, r, cfg, scratch?.b);
  const { shift, peak } = polarCorrelate(a, b, cfg);
  if (peak < cfg.minPeak) return { deltaDeg: null, peak, diff };
  return { deltaDeg: (shift * 360) / cfg.angles, peak, diff };
}

/**
 * 遲滯判斷：由量測值與前一格的狀態決定「是否旋轉」。
 * 回傳 null 代表本格判斷不了（維持原狀由呼叫端決定）。
 */
export function decideSpinning(m: SpinMeasure, prev: boolean | null, cfg: SpinConfig): boolean | null {
  if (m.diff >= cfg.diffHigh) return true; // 高速模糊：一定在轉
  if (m.deltaDeg === null) return prev; // 量不到：維持
  const mag = Math.abs(m.deltaDeg);
  if (mag >= cfg.spinOnDeg) return true;
  if (mag <= cfg.spinOffDeg) return false;
  return prev;
}
