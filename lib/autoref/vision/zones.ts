/**
 * 自動取得對戰區（規格 4.2）：HSV 找紅色邊框，取最大連通元件的凸包。
 */
import { connectedComponents, convexHull, redMask, type Point } from "./image.ts";

/**
 * 回傳紅框凸包（處理座標），找不到足夠大的紅色區域時回傳 null。
 * minAreaRatio：紅框元件面積至少要佔畫面的比例，避免把小紅點當成盤面。
 */
export function detectArenaHull(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  minAreaRatio = 0.01
): Point[] | null {
  const mask = redMask(rgba, w, h);
  const labels = new Int32Array(w * h);
  const blobs = connectedComponents(mask, w, h, labels, Math.floor(w * h * minAreaRatio));
  if (blobs.length === 0) return null;
  blobs.sort((a, b) => b.area - a.area);
  const target = blobs[0];
  // 只取元件的邊界像素做凸包，點數少很多
  const pts: Point[] = [];
  const { x: bx, y: by, w: bw, h: bh } = target.bbox;
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      const i = y * w + x;
      if (labels[i] !== target.label) continue;
      const edge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        labels[i - 1] !== target.label ||
        labels[i + 1] !== target.label ||
        labels[i - w] !== target.label ||
        labels[i + w] !== target.label;
      if (edge) pts.push({ x, y });
    }
  }
  const hull = convexHull(pts);
  return hull.length >= 3 ? hull : null;
}
