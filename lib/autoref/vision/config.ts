/**
 * 影像管線參數（規格 4.1 的實測起始值，面積一律是「相對於校正陀螺面積」的比例）。
 * 離線實測基準：560×590 盤面、陀螺直徑 60–70 px、面積約 3,000 px。
 */
import { DEFAULT_SPIN_CONFIG, type SpinConfig } from "./spin.ts";

export interface VisionConfig {
  /** 前景差值門檻（三通道最大絕對差） */
  fgThreshold: number;
  /** 開運算核大小 */
  openKernel: number;
  /** 閉運算核大小 */
  closeKernel: number;
  /** 單顆陀螺面積下限（×陀螺面積）：1,200 / 3,000 */
  beyMinRatio: number;
  /** 單顆陀螺面積上限：5,200 / 3,000 */
  beyMaxRatio: number;
  /** 黏合兩顆的上限：7,500 / 3,000 */
  mergedMaxRatio: number;
  /** 手或發射器：單一元件超過此比例 */
  handBlobRatio: number;
  /** 手在盤內：大型元件總面積超過此比例：15,000 / 3,000 */
  handInsideRatio: number;
  /** 外接矩形長寬比超過此值不是陀螺 */
  maxAspect: number;
  /** 「完全進入」：遮罩像素落在某區的比例 */
  zoneInsideRatio: number;
  /** 陀螺候選：至少此比例的像素要落在區域圖內，否則視為盤外物件 */
  beyInsideMinRatio: number;
  /** 整張畫面前景比例超過此值視為鏡頭晃動／光線改變 */
  shakeRatio: number;
  /** 黏合判定：前一格兩顆距離小於陀螺直徑的幾倍才允許視為黏合 */
  mergeDistanceScale: number;
  spin: SpinConfig;
}

export const DEFAULT_VISION_CONFIG: VisionConfig = {
  fgThreshold: 45,
  openKernel: 5,
  closeKernel: 9,
  beyMinRatio: 0.4,
  beyMaxRatio: 1.75,
  mergedMaxRatio: 2.5,
  handBlobRatio: 2.5,
  handInsideRatio: 5,
  maxAspect: 1.9,
  zoneInsideRatio: 0.85,
  beyInsideMinRatio: 0.5,
  shakeRatio: 0.4,
  mergeDistanceScale: 1.6,
  spin: DEFAULT_SPIN_CONFIG,
};
