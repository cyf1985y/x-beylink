/**
 * 影像管線測試：用合成影像（平坦背景＋畫上去的圓盤）驗證各步驟。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  close,
  connectedComponents,
  convexHull,
  dilate,
  erode,
  open,
  pointInPolygon,
  rasterizePolygon,
  redMask,
  toGray,
  type Point,
} from "./image.ts";
import { DEFAULT_SPIN_CONFIG, measureSpin, decideSpinning } from "./spin.ts";
import { buildZoneMap, presetZones, ZONE_IN, ZONE_OVER, type Calibration } from "./calibration.ts";
import { DEFAULT_VISION_CONFIG } from "./config.ts";
import { VisionProcessor, measureBeyArea } from "./pipeline.ts";
import { detectArenaHull } from "./zones.ts";

const W = 240;
const H = 240;

/** 可重現的感光雜訊：真實相機前後格永遠不會完全相同，重複格會被當成「沒有新資訊」 */
let seed = 12345;
function noise(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed % 5) - 2; // -2..2
}

function blank(r = 40, g = 40, b = 40): Uint8ClampedArray {
  const a = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const n = noise();
    a[i * 4] = r + n;
    a[i * 4 + 1] = g + n;
    a[i * 4 + 2] = b + n;
    a[i * 4 + 3] = 255;
  }
  return a;
}

/** 完全沒有雜訊的平坦畫面（只給「重複格」測試用） */
function flat(r = 40, g = 40, b = 40): Uint8ClampedArray {
  const a = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    a[i * 4] = r;
    a[i * 4 + 1] = g;
    a[i * 4 + 2] = b;
    a[i * 4 + 3] = 255;
  }
  return a;
}

/** 畫一個有紋理的圓盤：紋理隨 phase 剛性旋轉，不對稱才量得到旋轉；最暗處仍高於前景門檻 */
function disc(
  img: Uint8ClampedArray,
  cx: number,
  cy: number,
  r: number,
  phase: number,
  color: [number, number, number] = [200, 200, 200]
) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const a = Math.atan2(dy, dx);
      const k = 0.72 + 0.28 * Math.cos(3 * (a - phase)) * Math.cos(2 * (a - phase));
      const i = (y * W + x) * 4;
      const n = noise();
      img[i] = color[0] * k + n;
      img[i + 1] = color[1] * k + n;
      img[i + 2] = color[2] * k + n;
      img[i + 3] = 255;
    }
  }
}

function rect(img: Uint8ClampedArray, x0: number, y0: number, w: number, h: number, c: [number, number, number]) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * 4;
      img[i] = c[0];
      img[i + 1] = c[1];
      img[i + 2] = c[2];
    }
  }
}

describe("基本運算", () => {
  test("開運算去掉小雜點、閉運算補洞", () => {
    const w = 20;
    const h = 20;
    const m = new Uint8Array(w * h);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) m[y * w + x] = 1;
    m[9 * w + 9] = 0; // 洞
    m[1 * w + 1] = 1; // 雜點
    const o = open(m, w, h, 3);
    assert.equal(o[1 * w + 1], 0, "雜點被去掉");
    assert.equal(o[6 * w + 6], 1, "方塊保留");
    const c = close(o, w, h, 3);
    assert.equal(c[9 * w + 9], 1, "洞被補上");
    const e = erode(m, w, h, 3);
    assert.equal(e[5 * w + 5], 0);
    const d = dilate(m, w, h, 3);
    assert.equal(d[4 * w + 4], 1);
  });

  test("連通元件：面積、質心、外接矩形", () => {
    const w = 30;
    const h = 30;
    const m = new Uint8Array(w * h);
    for (let y = 2; y < 6; y++) for (let x = 2; x < 8; x++) m[y * w + x] = 1;
    for (let y = 20; y < 25; y++) for (let x = 20; x < 25; x++) m[y * w + x] = 1;
    const labels = new Int32Array(w * h);
    const blobs = connectedComponents(m, w, h, labels);
    assert.equal(blobs.length, 2);
    assert.equal(blobs[0].area, 24);
    assert.deepEqual(blobs[0].bbox, { x: 2, y: 2, w: 6, h: 4 });
    assert.ok(Math.abs(blobs[0].cx - 4.5) < 1e-9);
    assert.equal(blobs[1].area, 25);
    assert.notEqual(labels[2 * w + 2], labels[20 * w + 20]);
  });

  test("多邊形填色與點在內", () => {
    const poly: Point[] = [
      { x: 2, y: 2 },
      { x: 10, y: 2 },
      { x: 10, y: 10 },
      { x: 2, y: 10 },
    ];
    const map = new Uint8Array(20 * 20);
    rasterizePolygon(poly, 20, 20, 7, map);
    assert.equal(map[5 * 20 + 5], 7);
    assert.equal(map[15 * 20 + 15], 0);
    assert.equal(map[2 * 20 + 2], 7);
    assert.equal(map[10 * 20 + 10], 0, "右下邊界外");
    assert.ok(pointInPolygon({ x: 5, y: 5 }, poly));
    assert.ok(!pointInPolygon({ x: 15, y: 5 }, poly));
  });

  test("凸包", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
      { x: 3, y: 7 },
    ];
    const hull = convexHull(pts);
    assert.equal(hull.length, 4);
  });

  test("紅色遮罩", () => {
    const img = blank();
    rect(img, 10, 10, 5, 5, [220, 30, 30]);
    rect(img, 30, 30, 5, 5, [30, 220, 30]);
    const m = redMask(img, W, H);
    assert.equal(m[12 * W + 12], 1);
    assert.equal(m[32 * W + 32], 0);
    assert.equal(m[0], 0);
  });

  test("自動取得對戰區：紅色圓環的凸包", () => {
    const img = blank();
    const cx = 120;
    const cy = 120;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > 80 && d < 90) {
          const i = (y * W + x) * 4;
          img[i] = 230;
          img[i + 1] = 20;
          img[i + 2] = 30;
        }
      }
    }
    const hull = detectArenaHull(img, W, H, 0.005);
    assert.ok(hull && hull.length >= 8);
    assert.ok(pointInPolygon({ x: cx, y: cy }, hull!));
    assert.ok(!pointInPolygon({ x: cx + 100, y: cy }, hull!));
  });
});

describe("自轉訊號（運動補償）", () => {
  const cfg = DEFAULT_SPIN_CONFIG;

  test("旋轉 10 度且平移 3 像素，量到約 10 度", () => {
    const a = blank();
    const b = blank();
    disc(a, 100, 100, 28, 0);
    disc(b, 103, 101, 28, (10 * Math.PI) / 180);
    const ga = toGray(a, W, H);
    const gb = toGray(b, W, H);
    const m = measureSpin(ga, gb, W, H, 100, 100, 103, 101, 28, 50, cfg);
    assert.ok(m.deltaDeg !== null, "量得到");
    assert.ok(Math.abs(Math.abs(m.deltaDeg!) - 10) < 2.5, `delta=${m.deltaDeg}`);
    assert.ok(m.peak > 0.5);
  });

  test("只平移不旋轉（停轉後滾動）量到接近 0 度", () => {
    const a = blank();
    const b = blank();
    disc(a, 100, 100, 28, 0.7);
    disc(b, 106, 98, 28, 0.7);
    const ga = toGray(a, W, H);
    const gb = toGray(b, W, H);
    const m = measureSpin(ga, gb, W, H, 100, 100, 106, 98, 28, 30, cfg);
    assert.ok(m.deltaDeg !== null);
    assert.ok(Math.abs(m.deltaDeg!) < 1.5, `delta=${m.deltaDeg}`);
    assert.equal(decideSpinning(m, true, cfg), null, "沒有長延遲資料 → 未知");
    assert.equal(decideSpinning({ ...m, longDeltaDeg: 0.5 }, true, cfg), false, "長延遲也≈0 → 停止");
    assert.equal(decideSpinning({ ...m, longDeltaDeg: 9 }, true, cfg), true, "單格≈0 但隔 8 格轉了 9° → 混疊中的旋轉");
  });

  test("反轉時符號翻轉", () => {
    const a = blank();
    const b = blank();
    const c = blank();
    disc(a, 100, 100, 28, 0);
    disc(b, 100, 100, 28, (8 * Math.PI) / 180);
    disc(c, 100, 100, 28, 0);
    const ga = toGray(a, W, H);
    const gb = toGray(b, W, H);
    const gc = toGray(c, W, H);
    const m1 = measureSpin(ga, gb, W, H, 100, 100, 100, 100, 28, 50, cfg);
    const m2 = measureSpin(gb, gc, W, H, 100, 100, 100, 100, 28, 50, cfg);
    assert.ok(m1.deltaDeg! * m2.deltaDeg! < 0);
  });

  test("遲滯：高速模糊時簡單差值很高一律視為旋轉", () => {
    assert.equal(decideSpinning({ deltaDeg: null, peak: 0, diff: 80 }, false, cfg), true);
    assert.equal(decideSpinning({ deltaDeg: null, peak: 0, diff: 20 }, true, cfg), null, "量不到＝未知，不沿用舊狀態");
    assert.equal(decideSpinning({ deltaDeg: 0, peak: 1, diff: 0 }, true, cfg), null, "前後格完全相同＝沒有新資訊");
    assert.equal(decideSpinning({ deltaDeg: 4.5, peak: 0.9, diff: 20 }, true, cfg), true, "遲滯區維持");
    assert.equal(decideSpinning({ deltaDeg: 4.5, peak: 0.9, diff: 20, longDeltaDeg: 12 }, false, cfg), true, "遲滯區但長延遲明顯在轉");
    assert.equal(decideSpinning({ deltaDeg: 2, peak: 0.9, diff: 20 }, true, cfg), null, "單格停止但無長延遲 → 未知");
    assert.equal(decideSpinning({ deltaDeg: 2, peak: 0.9, diff: 20, longDeltaDeg: 1 }, true, cfg), false);
  });
});

describe("整條管線", () => {
  const arena: Point[] = [
    { x: 30, y: 30 },
    { x: 210, y: 30 },
    { x: 210, y: 210 },
    { x: 30, y: 210 },
  ];
  const zones = presetZones(arena, W, H);
  // 把右口袋改成明確的矩形方便測試
  zones.over = [
    [
      { x: 0, y: 90 },
      { x: 40, y: 90 },
      { x: 40, y: 150 },
      { x: 0, y: 150 },
    ],
    [
      { x: 200, y: 90 },
      { x: 240, y: 90 },
      { x: 240, y: 150 },
      { x: 200, y: 150 },
    ],
  ];
  const R = 14;
  const beyArea = Math.PI * R * R;

  function calib(): Calibration {
    return {
      width: W,
      height: H,
      crop: { x: 0, y: 0, w: W, h: H },
      background: blank(),
      zones,
      beyArea,
      createdAt: 0,
    };
  }

  test("區域標籤圖：出界區蓋過對戰區", () => {
    const map = buildZoneMap(zones, W, H);
    assert.equal(map[120 * W + 120], ZONE_IN);
    assert.equal(map[120 * W + 220], ZONE_OVER);
    assert.equal(map[120 * W + 35], ZONE_OVER, "口袋與紅框重疊處算口袋");
  });

  test("量測陀螺面積", () => {
    const img = blank();
    disc(img, 120, 120, R, 0);
    const m = measureBeyArea(img, blank(), W, H);
    assert.ok(m && Math.abs(m.area - beyArea) / beyArea < 0.15, `area=${m?.area}`);
  });

  test("兩顆陀螺：左 A 右 B，都在對戰區，旋轉中", () => {
    const vp = new VisionProcessor(calib(), DEFAULT_VISION_CONFIG);
    let last;
    for (let f = 0; f < 5; f++) {
      const img = blank();
      disc(img, 80 + f, 120, R, f * 0.3, [220, 80, 80]);
      disc(img, 160 - f, 118, R, -f * 0.3, [80, 120, 240]);
      last = vp.process(img, f / 30);
    }
    const obs = last!.obs;
    assert.equal(obs.hand, false);
    assert.equal(obs.beys.length, 2);
    const A = obs.beys.find((b) => b.id === "A")!;
    const B = obs.beys.find((b) => b.id === "B")!;
    assert.ok(A.x! < B.x!);
    assert.equal(A.zone, "IN");
    assert.equal(B.zone, "IN");
    assert.equal(A.spinning, true);
    assert.equal(B.spinning, true);
    assert.ok(last!.debug.ms < 200);
  });

  test("陀螺停住：spinning 變 false；移到口袋：zone 變 OVER；消失：visible false", () => {
    const vp = new VisionProcessor(calib(), DEFAULT_VISION_CONFIG);
    const run = (ax: number, ay: number, aPhase: number, bVisible = true) => {
      const img = blank();
      disc(img, ax, ay, R, aPhase, [220, 80, 80]);
      if (bVisible) disc(img, 160, 120, R, 0.4, [80, 120, 240]);
      return vp.process(img, 0);
    };
    run(80, 120, 0);
    run(80, 120, 0.3);
    let r = run(80, 120, 0.3); // A 停住，但長延遲歷史還不夠
    let A = r.obs.beys.find((b) => b.id === "A")!;
    assert.equal(A.spinning, null, "歷史不足 8 格：未知，不是停止");
    for (let i = 0; i < 8; i++) r = run(80, 120, 0.3);
    A = r.obs.beys.find((b) => b.id === "A")!;
    assert.equal(A.spinning, false);
    r = run(82, 121, 0.3); // 停住但滾動
    A = r.obs.beys.find((b) => b.id === "A")!;
    assert.equal(A.spinning, false);
    r = run(222, 120, 0.3); // 整顆進右口袋
    A = r.obs.beys.find((b) => b.id === "A")!;
    assert.equal(A.zone, "OVER");
    r = run(195, 120, 0.3); // 跨在口袋邊界上：沒有完全進入任何區 → 沿用上一格
    A = r.obs.beys.find((b) => b.id === "A")!;
    assert.equal(A.zone, "OVER");
    r = run(222, 120, 0.3, false); // B 消失
    const B = r.obs.beys.find((b) => b.id === "B")!;
    assert.equal(B.visible, false);
    assert.equal(B.zone, "IN");
  });

  test("混疊：三重對稱紋理每格轉 119°，單格像 −1° 但長延遲看得出在轉，不得判停", () => {
    const vp = new VisionProcessor(calib(), DEFAULT_VISION_CONFIG);
    const sym = (img: Uint8ClampedArray, cx: number, cy: number, phase: number) => {
      for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) {
        for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy > R * R) continue;
          const a = Math.atan2(dy, dx);
          const k = 0.72 + 0.28 * Math.cos(3 * (a - phase)); // 純三重對稱：週期 120°
          const i = (y * W + x) * 4;
          const n = noise();
          img[i] = 220 * k + n;
          img[i + 1] = 200 * k + n;
          img[i + 2] = 60 * k + n;
        }
      }
    };
    const step = (119 * Math.PI) / 180;
    let falseCount = 0;
    let trueCount = 0;
    for (let f = 0; f < 24; f++) {
      const img = blank();
      sym(img, 80, 120, f * step);
      disc(img, 160, 120, R, f * 0.3, [80, 120, 240]);
      const r = vp.process(img, f / 60);
      const A = r.obs.beys.find((b) => b.id === "A")!;
      if (f >= 10) {
        if (A.spinning === false) falseCount++;
        if (A.spinning === true) trueCount++;
      }
    }
    assert.equal(falseCount, 0, "混疊中的旋轉陀螺不得被判停止");
    assert.ok(trueCount >= 10, `長延遲應看出在轉（true=${trueCount}）`);
  });

  test("手進盤：大面積前景", () => {
    const vp = new VisionProcessor(calib(), DEFAULT_VISION_CONFIG);
    const img = blank();
    disc(img, 80, 120, R, 0);
    disc(img, 160, 120, R, 0);
    rect(img, 100, 0, 60, 130, [180, 150, 120]);
    const r = vp.process(img, 0);
    assert.equal(r.obs.hand, true);
    assert.ok(r.debug.blobs.some((b) => b.cls === "hand"));
  });

  test("盤外的大型前景（字幕條、器材）不算手；跨入盤內才算", () => {
    const vp = new VisionProcessor(calib(), DEFAULT_VISION_CONFIG);
    const img = blank();
    disc(img, 80, 120, R, 0);
    disc(img, 160, 120, R, 0);
    rect(img, 0, 0, 240, 26, [180, 150, 120]); // 頂部標題條，完全在區域圖外
    let r = vp.process(img, 0);
    assert.equal(r.obs.hand, false);
    const bar = r.debug.blobs.find((b) => b.cls === "hand");
    assert.ok(bar && bar.inside === 0, "標題條被分類為手部尺寸，但盤內像素為 0");
    const img2 = blank();
    disc(img2, 80, 120, R, 0);
    disc(img2, 160, 120, R, 0);
    rect(img2, 100, 150, 60, 90, [180, 150, 120]); // 從底部伸進對戰區的手
    r = vp.process(img2, 1 / 30);
    assert.equal(r.obs.hand, true);
  });

  test("盤外的陀螺尺寸物件（字幕、器材）不是陀螺候選", () => {
    const vp = new VisionProcessor(calib(), DEFAULT_VISION_CONFIG);
    const img = blank();
    disc(img, 80, 120, R, 0, [220, 80, 80]);
    disc(img, 160, 120, R, 0.5, [80, 120, 240]);
    disc(img, 200, 228, R, 0.2, [240, 240, 240]); // 區域圖外（對戰區與極限區之下、口袋之外）
    const r = vp.process(img, 0);
    assert.equal(r.obs.beys.length, 2);
    assert.ok(r.obs.beys.every((b) => b.y! < 200));
    assert.ok(r.debug.blobs.some((b) => b.cls === "discard" && Math.abs(b.cy - 228) < 3));
  });

  test("重複格：前後格完全相同時 spinning 為未知，不是停止", () => {
    const vp = new VisionProcessor(
      { ...calib(), background: flat() },
      DEFAULT_VISION_CONFIG
    );
    const img = flat();
    disc(img, 80, 120, R, 0.3, [220, 80, 80]);
    disc(img, 160, 120, R, 0.7, [80, 120, 240]);
    vp.process(img, 0);
    const r = vp.process(img, 1 / 60);
    for (const b of r.obs.beys) assert.equal(b.spinning, null);
  });

  test("鏡頭晃動：整張畫面前景比例過高", () => {
    const vp = new VisionProcessor(calib(), DEFAULT_VISION_CONFIG);
    const img = blank(140, 140, 140);
    const r = vp.process(img, 0);
    assert.equal(r.debug.shaken, true);
  });

  test("黏合再分開：用色彩重新配對", () => {
    const vp = new VisionProcessor(calib(), DEFAULT_VISION_CONFIG);
    const red: [number, number, number] = [230, 60, 60];
    const blue: [number, number, number] = [60, 90, 240];
    const frame = (ax: number, bx: number) => {
      const img = blank();
      disc(img, ax, 120, R, 0.2, red);
      disc(img, bx, 120, R, 0.9, blue);
      return vp.process(img, 0);
    };
    frame(80, 160);
    frame(100, 140);
    const merged = frame(112, 142); // 相切，閉運算後黏成一塊
    assert.equal(merged.debug.blobs.filter((b) => b.cls === "merged").length, 1);
    assert.equal(merged.obs.beys.length, 2);
    // 分開時交換位置：紅的跑到右邊
    const r = frame(160, 80);
    const A = r.obs.beys.find((b) => b.id === "A")!;
    const B = r.obs.beys.find((b) => b.id === "B")!;
    assert.ok(A.x! > B.x!, "A（紅）應配對到右邊的紅色圓盤");
  });
});
