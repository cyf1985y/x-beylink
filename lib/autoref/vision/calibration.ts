/**
 * 校正資料（規格 4.1 步驟 1、4.2）：空盤背景、三種區域的多邊形、陀螺面積。
 * 每次架設做一次，存在 IndexedDB。
 */
import { polygonBounds, rasterizePolygon, type Point, type Rect } from "./image.ts";

/** 區域標籤圖的值 */
export const ZONE_NONE = 0;
export const ZONE_IN = 1;
export const ZONE_XTREME = 2;
export const ZONE_OVER = 3;

export interface ZonePolygons {
  /** 對戰區（紅框凸包） */
  in: Point[];
  /** 極限區 */
  xtreme: Point[];
  /** 出界區（左右兩個口袋） */
  over: Point[][];
}

export interface Calibration {
  /** 處理解析度（盤面裁切後縮放） */
  width: number;
  height: number;
  /** 相機原始畫面中的裁切範圍（相機像素座標） */
  crop: Rect;
  /** 空盤背景（RGBA，width×height） */
  background: Uint8ClampedArray;
  zones: ZonePolygons;
  /** 一顆靜止陀螺的前景面積（像素），所有面積門檻以它為基準 */
  beyArea: number;
  /** 校正時間 */
  createdAt: number;
}

/** 可序列化到 IndexedDB 的形式 */
export interface StoredCalibration extends Omit<Calibration, "background"> {
  background: ArrayBuffer;
}

export function toStored(c: Calibration): StoredCalibration {
  return { ...c, background: c.background.buffer.slice(0) as ArrayBuffer };
}

export function fromStored(s: StoredCalibration): Calibration {
  return { ...s, background: new Uint8ClampedArray(s.background) };
}

/**
 * 區域標籤圖：每個像素屬於哪個區。出界區 > 極限區 > 對戰區（使用者畫的口袋蓋過紅框凸包）。
 */
export function buildZoneMap(zones: ZonePolygons, w: number, h: number): Uint8Array {
  const map = new Uint8Array(w * h);
  rasterizePolygon(zones.in, w, h, ZONE_IN, map);
  rasterizePolygon(zones.xtreme, w, h, ZONE_XTREME, map);
  for (const p of zones.over) rasterizePolygon(p, w, h, ZONE_OVER, map);
  return map;
}

/**
 * 標準 Xtreme Stadium 的預設範本：極限區在下方，出界區在左右兩側口袋。
 * 依對戰區凸包的外接矩形推出，使用者可再拖曳修正。
 */
export function presetZones(inHull: Point[], w: number, h: number): ZonePolygons {
  const b = polygonBounds(inHull);
  const cx = b.x + b.w / 2;
  const margin = Math.max(8, b.w * 0.04);
  // 極限區：底部中央，寬約 55%、高約 22%，從紅框內緣延伸到紅框外
  const xw = b.w * 0.55;
  const xtop = b.y + b.h * 0.8;
  const xtreme: Point[] = [
    { x: cx - xw / 2, y: xtop },
    { x: cx + xw / 2, y: xtop },
    { x: cx + xw / 2 + margin, y: Math.min(h - 1, b.y + b.h + margin * 3) },
    { x: cx - xw / 2 - margin, y: Math.min(h - 1, b.y + b.h + margin * 3) },
  ];
  // 出界區：左右中段的口袋，從紅框內緣延伸到畫面邊緣
  const ph = b.h * 0.3;
  const py0 = b.y + b.h * 0.3;
  const left: Point[] = [
    { x: Math.max(0, b.x - margin * 3), y: py0 - margin },
    { x: b.x + b.w * 0.14, y: py0 },
    { x: b.x + b.w * 0.14, y: py0 + ph },
    { x: Math.max(0, b.x - margin * 3), y: py0 + ph + margin },
  ];
  const right: Point[] = [
    { x: b.x + b.w * 0.86, y: py0 },
    { x: Math.min(w - 1, b.x + b.w + margin * 3), y: py0 - margin },
    { x: Math.min(w - 1, b.x + b.w + margin * 3), y: py0 + ph + margin },
    { x: b.x + b.w * 0.86, y: py0 + ph },
  ];
  return { in: inHull, xtreme, over: [left, right] };
}

/** 沒有紅框可偵測時的備援：以畫面中央的八邊形當對戰區 */
export function fallbackArena(w: number, h: number): Point[] {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.42;
  const pts: Point[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}
