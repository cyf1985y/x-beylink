/**
 * 自動裁判的所有可調設定（規格 6.2 設定頁）：存 IndexedDB，啟動時載入。
 */
import { DEFAULT_RULE_CONFIG, type RuleConfig } from "./types.ts";
import { DEFAULT_VISION_CONFIG, type VisionConfig } from "./vision/config.ts";

export interface AutorefSettings {
  rules: RuleConfig;
  vision: VisionConfig;
  /** 盤面裁切後縮到長邊的像素數（規格建議約 600；手機效能不足時調低） */
  processLongSide: number;
  camera: {
    width: number;
    height: number;
    fps: number;
  };
  /** 除錯模式：顯示前景遮罩與自轉訊號數值 */
  debug: boolean;
  /** 判定時語音播報 */
  speech: boolean;
  /** 自動錄下每局影片 */
  record: boolean;
}

export const DEFAULT_SETTINGS: AutorefSettings = {
  rules: DEFAULT_RULE_CONFIG,
  vision: DEFAULT_VISION_CONFIG,
  processLongSide: 480,
  camera: { width: 1280, height: 720, fps: 60 },
  debug: false,
  speech: true,
  record: true,
};

/** 把存下來的舊設定補上新欄位（深度合併一層） */
export function mergeSettings(saved: Partial<AutorefSettings> | null | undefined): AutorefSettings {
  if (!saved) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    rules: { ...DEFAULT_RULE_CONFIG, ...(saved.rules ?? {}), points: { ...DEFAULT_RULE_CONFIG.points, ...(saved.rules?.points ?? {}) } },
    vision: {
      ...DEFAULT_VISION_CONFIG,
      ...(saved.vision ?? {}),
      spin: { ...DEFAULT_VISION_CONFIG.spin, ...(saved.vision?.spin ?? {}) },
    },
    camera: { ...DEFAULT_SETTINGS.camera, ...(saved.camera ?? {}) },
  };
}
