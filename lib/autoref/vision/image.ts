/**
 * 影像處理基本運算（純 TypeScript，操作 typed array，不依賴 OpenCV）。
 *
 * 與規格 4.1 的 OpenCV 做法一對一對應：絕對差 → 門檻 → 開運算 → 閉運算 → 連通元件。
 * 全部可在 Node 與 Web Worker 執行，所以能用合成影像做單元測試。
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 連通元件 */
export interface Blob {
  label: number;
  area: number;
  cx: number;
  cy: number;
  bbox: Rect;
}

/** RGBA → 灰階（0–255） */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number, out?: Uint8Array): Uint8Array {
  const n = w * h;
  const g = out ?? new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    // Rec.601 權重，整數運算
    g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  }
  return g;
}

/**
 * 前景遮罩：每個像素與背景做絕對差，取三通道最大值，高於門檻為 1。
 */
export function foregroundMask(
  rgba: Uint8ClampedArray,
  bg: Uint8ClampedArray,
  w: number,
  h: number,
  threshold: number,
  out?: Uint8Array
): Uint8Array {
  const n = w * h;
  const m = out ?? new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const dr = Math.abs(rgba[j] - bg[j]);
    const dg = Math.abs(rgba[j + 1] - bg[j + 1]);
    const db = Math.abs(rgba[j + 2] - bg[j + 2]);
    const d = dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db;
    m[i] = d > threshold ? 1 : 0;
  }
  return m;
}

/**
 * 方形結構元素的侵蝕／膨脹，可分離為水平與垂直兩道。
 * 兩道都用滑動視窗的和，每個像素 O(1)，且記憶體存取順序都是循序的（垂直那道用一列的欄位和）。
 */
function morphH(src: Uint8Array, dst: Uint8Array, w: number, h: number, r: number, erode: boolean) {
  const full = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const base = y * w;
    let sum = 0;
    for (let x = 0; x <= r && x < w; x++) sum += src[base + x];
    // 左緣：視窗被畫面切掉
    let x = 0;
    for (; x < r && x < w; x++) {
      const b = x + r + 1 > w ? w : x + r + 1;
      dst[base + x] = erode ? (sum === b ? 1 : 0) : sum > 0 ? 1 : 0;
      if (x + r + 1 < w) sum += src[base + x + r + 1];
    }
    // 中段：完整視窗，不需邊界檢查
    const mid = w - r - 1;
    if (erode) {
      for (; x < mid; x++) {
        dst[base + x] = sum === full ? 1 : 0;
        sum += src[base + x + r + 1] - src[base + x - r];
      }
    } else {
      for (; x < mid; x++) {
        dst[base + x] = sum > 0 ? 1 : 0;
        sum += src[base + x + r + 1] - src[base + x - r];
      }
    }
    // 右緣
    for (; x < w; x++) {
      const a = x - r < 0 ? 0 : x - r;
      dst[base + x] = erode ? (sum === w - a ? 1 : 0) : sum > 0 ? 1 : 0;
      if (x - r >= 0) sum -= src[base + x - r];
    }
  }
}

function morphV(src: Uint8Array, dst: Uint8Array, w: number, h: number, r: number, erode: boolean, colSum: Int32Array) {
  colSum.fill(0, 0, w);
  for (let y = 0; y <= r && y < h; y++) {
    const base = y * w;
    for (let x = 0; x < w; x++) colSum[x] += src[base + x];
  }
  for (let y = 0; y < h; y++) {
    const a = y - r < 0 ? 0 : y - r;
    const b = y + r + 1 > h ? h : y + r + 1;
    const full = b - a;
    const base = y * w;
    if (erode) {
      for (let x = 0; x < w; x++) dst[base + x] = colSum[x] === full ? 1 : 0;
    } else {
      for (let x = 0; x < w; x++) dst[base + x] = colSum[x] > 0 ? 1 : 0;
    }
    const hasNext = y + r + 1 < h;
    const hasPrev = y - r >= 0;
    if (hasNext && hasPrev) {
      const nb = (y + r + 1) * w;
      const ob = (y - r) * w;
      for (let x = 0; x < w; x++) colSum[x] += src[nb + x] - src[ob + x];
    } else if (hasNext) {
      const nb = (y + r + 1) * w;
      for (let x = 0; x < w; x++) colSum[x] += src[nb + x];
    } else if (hasPrev) {
      const ob = (y - r) * w;
      for (let x = 0; x < w; x++) colSum[x] -= src[ob + x];
    }
  }
}

let colSumScratch = new Int32Array(0);
function colSumFor(w: number): Int32Array {
  if (colSumScratch.length < w) colSumScratch = new Int32Array(w);
  return colSumScratch;
}

export function erode(src: Uint8Array, w: number, h: number, k: number, tmp?: Uint8Array, out?: Uint8Array): Uint8Array {
  const r = k >> 1;
  const t = tmp ?? new Uint8Array(w * h);
  const o = out ?? new Uint8Array(w * h);
  morphH(src, t, w, h, r, true);
  morphV(t, o, w, h, r, true, colSumFor(w));
  return o;
}

export function dilate(src: Uint8Array, w: number, h: number, k: number, tmp?: Uint8Array, out?: Uint8Array): Uint8Array {
  const r = k >> 1;
  const t = tmp ?? new Uint8Array(w * h);
  const o = out ?? new Uint8Array(w * h);
  morphH(src, t, w, h, r, false);
  morphV(t, o, w, h, r, false, colSumFor(w));
  return o;
}

/** 開運算（去雜點）：先侵蝕再膨脹 */
export function open(src: Uint8Array, w: number, h: number, k: number, tmp?: Uint8Array, out?: Uint8Array): Uint8Array {
  const t = tmp ?? new Uint8Array(w * h);
  const e = erode(src, w, h, k, t, out);
  return dilate(e, w, h, k, t, e === out ? out : undefined);
}

/** 閉運算（補洞）：先膨脹再侵蝕 */
export function close(src: Uint8Array, w: number, h: number, k: number, tmp?: Uint8Array, out?: Uint8Array): Uint8Array {
  const t = tmp ?? new Uint8Array(w * h);
  const d = dilate(src, w, h, k, t, out);
  return erode(d, w, h, k, t, d === out ? out : undefined);
}

/**
 * 連通元件（4 連通）。labels[i] = 0 代表背景，1.. 為元件編號。
 * 回傳各元件的面積、質心、外接矩形。minArea 以下的元件直接略過（仍會標號）。
 */
let ccStack = new Int32Array(0);

export function connectedComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  labels: Int32Array,
  minArea = 1
): Blob[] {
  labels.fill(0);
  if (ccStack.length < w * h) ccStack = new Int32Array(w * h);
  const stack = ccStack;
  const blobs: Blob[] = [];
  let next = 1;
  for (let start = 0; start < w * h; start++) {
    if (mask[start] === 0 || labels[start] !== 0) continue;
    const label = next++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w;
      const y = (i - x) / w;
      area++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[i - 1] && labels[i - 1] === 0) {
        labels[i - 1] = label;
        stack[sp++] = i - 1;
      }
      if (x < w - 1 && mask[i + 1] && labels[i + 1] === 0) {
        labels[i + 1] = label;
        stack[sp++] = i + 1;
      }
      if (y > 0 && mask[i - w] && labels[i - w] === 0) {
        labels[i - w] = label;
        stack[sp++] = i - w;
      }
      if (y < h - 1 && mask[i + w] && labels[i + w] === 0) {
        labels[i + w] = label;
        stack[sp++] = i + w;
      }
    }
    if (area >= minArea) {
      blobs.push({
        label,
        area,
        cx: sx / area,
        cy: sy / area,
        bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      });
    }
  }
  return blobs;
}

/** 點在多邊形內（射線法） */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * 多邊形掃描線填色到標籤圖：polygon 內的像素寫入 value。
 * 一次校正做完，之後每格只查表。
 */
export function rasterizePolygon(
  poly: Point[],
  w: number,
  h: number,
  value: number,
  out: Uint8Array
) {
  if (poly.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    xs.length = 0;
    const sy = y + 0.5;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > sy !== b.y > sy) {
        xs.push(a.x + ((sy - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) out[y * w + x] = value;
    }
  }
}

/** 凸包（Andrew monotone chain） */
export function convexHull(points: Point[]): Point[] {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** 多邊形面積（Shoelace，取絕對值） */
export function polygonArea(poly: Point[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(s) / 2;
}

/**
 * HSV 紅色遮罩（規格 4.2：H<8 或 H>172（OpenCV 0–180 刻度）、S>130、V>120）。
 * 這裡 H 用 0–360 度、S/V 用 0–255。
 */
export function redMask(rgba: Uint8ClampedArray, w: number, h: number, out?: Uint8Array): Uint8Array {
  const n = w * h;
  const m = out ?? new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = rgba[j];
    const g = rgba[j + 1];
    const b = rgba[j + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const v = max;
    const s = max === 0 ? 0 : ((max - min) * 255) / max;
    let hue = 0;
    const d = max - min;
    if (d !== 0) {
      if (max === r) hue = (60 * ((g - b) / d) + 360) % 360;
      else if (max === g) hue = 60 * ((b - r) / d) + 120;
      else hue = 60 * ((r - g) / d) + 240;
    }
    m[i] = v > 120 && s > 130 && (hue < 16 || hue > 344) ? 1 : 0;
  }
  return m;
}

/** 雙線性取樣灰階影像 */
export function sampleBilinear(g: Uint8Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return 0;
  const x0 = x | 0;
  const y0 = y | 0;
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * w + x0;
  const a = g[i];
  const b = g[i + 1];
  const c = g[i + w];
  const d = g[i + w + 1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/** 多邊形的外接矩形 */
export function polygonBounds(poly: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
