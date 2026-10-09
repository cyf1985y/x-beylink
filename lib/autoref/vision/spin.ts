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
  /**
   * 平移速度（每秒幾個陀螺半徑）達此值一律視為旋轉：仍在盤面上快速移動的陀螺不可能已停轉。
   * 無花紋／低對比的陀螺（白色陀螺在白盤上）極座標比對常讀到 0°，這是主要防線；
   * 停轉後的滾動通常低於此速度。
   */
  movingRadiusPerSec: number;
  /** 平移速度的量測窗（秒） */
  speedWindowSec: number;
  /**
   * 「靜止」的像素變化上限（灰階，扣掉畫面雜訊底後）：遮罩內前後格平均絕對差超過此值，
   * 陀螺外觀仍在變化，不可判為停止（最多判為未知）。30 fps 高速旋轉＋對稱花紋會混疊成
   * 角度≈0，但像素仍每格在變；真正停下的陀螺變化量等於雜訊底。
   */
  stillDiffMax: number;
  /** 整張畫面前後格平均絕對差低於此值視為重複格（沒有新資訊） */
  frameDupMax: number;
  /** 簡單差值訊號高於此值一律視為旋轉（高速模糊，極座標法混疊） */
  diffHigh: number;
  /**
   * 長延遲比對：與 longLagFrames 格之前的影像再比一次。
   * 高速時每格的角度會混疊成接近 0°（紋理對稱＋每格轉接近整數個週期），但轉速持續衰減，
   * 混疊不可能在多格之間維持，所以隔 L 格的角度差會放大 L 倍；真正停止的陀螺隔 L 格仍≈0°。
   */
  longLagFrames: number;
  /**
   * 長延遲以秒為準（優先於 longLagFrames）：混疊的漂移來自轉速衰減，是時間的函數，
   * 所以 60 fps 要隔的格數是 30 fps 的兩倍。依每格間隔換算，上限 historyFrames − 1。
   */
  longLagSec: number;
  /** 長延遲角度差低於此值（度）才接受「停止」 */
  longStopDeg: number;
  /** 保留幾格灰階歷史（≥ 換算後的長延遲格數 + 1） */
  historyFrames: number;
}

export const DEFAULT_SPIN_CONFIG: SpinConfig = {
  angles: 72,
  radii: 10,
  radiusScale: 0.85,
  spinOnDeg: 6,
  spinOffDeg: 3,
  minPeak: 0.35,
  movingRadiusPerSec: 2.5,
  speedWindowSec: 0.2,
  stillDiffMax: 0.6,
  frameDupMax: 0.05,
  diffHigh: 60,
  longLagFrames: 8,
  longLagSec: 0.27,
  longStopDeg: 4,
  historyFrames: 20,
};

export interface SpinMeasure {
  /** 每格旋轉角度（度，帶符號）；量不到時為 null */
  deltaDeg: number | null;
  /** 互相關峰值的正規化分數（-1..1） */
  peak: number;
  /** 簡單差值訊號（遮罩內平均絕對差） */
  diff: number;
  /** 與 longLag 格之前比的角度差（度）；沒有足夠歷史或量不到時為 null */
  longDeltaDeg?: number | null;
  /** 長延遲實際用的格數 */
  longLag?: number;
  /** 平移速度（陀螺半徑／秒），由位置歷史求得；量不到為 null */
  speed?: number | null;
  /** 本格畫面的雜訊底：背景（非前景）像素的前後格平均絕對差 */
  noiseFloor?: number;
  /** 整張畫面（含前景）的前後格平均絕對差；接近 0 代表重複格 */
  frameDiff?: number;
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
 * 回傳 null 代表本格沒有可用的觀測（量不到、或前後格完全相同沒有新資訊）。
 * 量不到時不沿用舊狀態：舊狀態會讓停轉計時在沒有證據的期間繼續累計。
 * 只有介於 spinOffDeg 與 spinOnDeg 之間的遲滯區才維持前一格。
 */
export function decideSpinning(m: SpinMeasure, prev: boolean | null, cfg: SpinConfig): boolean | null {
  if (m.diff >= cfg.diffHigh) return true; // 高速模糊：一定在轉
  if (isDuplicateFrame(m, cfg)) return null; // 前後格相同（重複格）：沒有新資訊，不是停止
  if (m.speed !== null && m.speed !== undefined && m.speed >= cfg.movingRadiusPerSec) return true; // 還在快速平移：一定在轉
  if (m.deltaDeg === null) return null; // 量不到
  const mag = Math.abs(m.deltaDeg);
  if (mag >= cfg.spinOnDeg) return true;
  const long = m.longDeltaDeg;
  // 外觀仍在變化（扣掉雜訊底）就不可能已停：角度讀數≈0 只能是未知
  const still = m.diff - (m.noiseFloor ?? 0) <= cfg.stillDiffMax;
  if (mag <= cfg.spinOffDeg) {
    // 單格看起來停了：還要長延遲也≈0、且像素幾乎不變才算停止（破解混疊）；沒有長延遲資料＝未知
    if (long === null || long === undefined) return null;
    const lmag = Math.abs(long);
    if (lmag <= cfg.longStopDeg) return still ? false : null;
    if (lmag >= cfg.spinOnDeg) return true;
    return null;
  }
  // 遲滯區：維持前一格；但長延遲明顯在轉就直接判旋轉
  if (long !== null && long !== undefined && Math.abs(long) >= cfg.spinOnDeg) return true;
  return prev === false && !still ? null : prev;
}

/**
 * 前後兩格完全相同：遮罩內平均絕對差為 0 且互相關峰值 ≈ 1。
 * 真實相機有感光雜訊，差值不會是 0；這是串流重複格或取格重複的特徵。
 */
export function isDuplicateFrame(m: SpinMeasure, cfg: SpinConfig = DEFAULT_SPIN_CONFIG): boolean {
  // 重複格是「整張畫面」沒變（螢幕錄影補格、相機掉格）；只看單顆陀螺會把壓縮影片裡
  // 靜止的陀螺（H.264 跳過區塊，前後格逐位元相同）當成重複格，永遠判不出轉停
  if (m.frameDiff !== undefined) return m.frameDiff < cfg.frameDupMax;
  return m.diff < 0.5 && m.peak > 0.995;
}
