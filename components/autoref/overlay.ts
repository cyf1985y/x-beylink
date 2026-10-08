"use client";

/**
 * 對戰頁疊圖：區域外框、每顆陀螺的圈選與狀態、前景遮罩（除錯）。
 * 疊圖 canvas 的像素尺寸＝處理解析度，用 CSS 縮放到與影片顯示區一致。
 */
import type { BeyId, Zone } from "@/lib/autoref/types";
import type { ZonePolygons } from "@/lib/autoref/vision/calibration";
import type { Point } from "@/lib/autoref/vision/image";
import type { TrackInfo } from "@/lib/autoref/vision/worker";

export const ZONE_COLOR: Record<"in" | "xtreme" | "over", string> = {
  in: "#38e0ff",
  xtreme: "#f5c542",
  over: "#ff5c7a",
};

const BEY_COLOR: Record<BeyId, string> = { A: "#5b8dff", B: "#ff6b6b" };

export function drawPolygon(ctx: CanvasRenderingContext2D, poly: Point[], color: string, fill = false, lineWidth = 2) {
  if (poly.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = color + "33";
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

export function drawZones(ctx: CanvasRenderingContext2D, zones: ZonePolygons, fill = false) {
  drawPolygon(ctx, zones.in, ZONE_COLOR.in, fill);
  drawPolygon(ctx, zones.xtreme, ZONE_COLOR.xtreme, fill);
  for (const p of zones.over) drawPolygon(ctx, p, ZONE_COLOR.over, fill);
}

const ZONE_SHORT: Record<Zone, string> = { IN: "", XTREME: "極限", OVER: "出界", OUT: "盤外" };

export function drawTracks(
  ctx: CanvasRenderingContext2D,
  tracks: Record<BeyId, TrackInfo | null>,
  labels: Record<BeyId, string>,
  engineInfo: Record<BeyId, { pending: Zone | null; suspectStop: boolean }> | null,
  debug: boolean
) {
  for (const id of ["A", "B"] as BeyId[]) {
    const t = tracks[id];
    if (!t) continue;
    const color = BEY_COLOR[id];
    ctx.save();
    ctx.globalAlpha = t.visible ? 1 : 0.35;
    ctx.beginPath();
    ctx.arc(t.cx, t.cy, Math.max(6, t.radius + 3), 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = t.spinning === false ? 4 : 2;
    ctx.setLineDash(t.spinning === false ? [6, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    const info = engineInfo?.[id];
    let tag = labels[id];
    if (t.spinning === false) tag += " 停";
    else if (t.spinning === null) tag += " ?";
    if (t.zone !== "IN") tag += ` ${ZONE_SHORT[t.zone]}`;
    if (info?.pending) tag += " 待確認";
    if (info?.suspectStop) tag += " 疑似停";
    if (t.merged) tag += " 黏合";
    if (debug && t.spin) {
      const l = t.spin.longDeltaDeg;
      tag += ` ${t.spin.deltaDeg === null ? "–" : t.spin.deltaDeg.toFixed(1) + "°"}`;
      tag += `/${l === null || l === undefined ? "–" : l.toFixed(1) + "°"}/${t.spin.diff.toFixed(0)}`;
    }
    ctx.font = "bold 13px sans-serif";
    const w = ctx.measureText(tag).width + 8;
    ctx.fillStyle = "rgba(4,6,14,0.75)";
    ctx.fillRect(t.cx - w / 2, t.cy - t.radius - 24, w, 18);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(tag, t.cx, t.cy - t.radius - 10);
    ctx.restore();
  }
}

/** 前景遮罩（0/1）畫成半透明白色 */
export function drawMask(ctx: CanvasRenderingContext2D, mask: Uint8Array, w: number, h: number) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    if (mask[i]) {
      d[i * 4] = 255;
      d[i * 4 + 1] = 255;
      d[i * 4 + 2] = 255;
      d[i * 4 + 3] = 90;
    }
  }
  ctx.putImageData(img, 0, 0);
}
