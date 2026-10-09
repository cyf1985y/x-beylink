/**
 * 離線重播單一影片：ffmpeg 解碼（原始解析度）→ VisionProcessor → RefereeEngine，
 * 自動狀態轉移、不手動開局，輸出逐格 trace.jsonl、summary.json 與判定當格的 RGBA 快照。
 *
 * 用法（repo 根目錄，Node 22 需加旗標）：
 *   node --experimental-strip-types docs/autoref/tools/run_clip.ts <video.mp4> docs/autoref/clips/test3/calib.json <outdir> [fps]
 * calib.json：width/height（＝影片尺寸）、background（相對路徑，.rgba 或 .rgba.gz）、zones、beyArea，
 * 可選 vision／spin／rules 覆寫。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { VisionProcessor } from "../../../lib/autoref/vision/pipeline.ts";
import { DEFAULT_VISION_CONFIG } from "../../../lib/autoref/vision/config.ts";
import { RefereeEngine } from "../../../lib/autoref/rules.ts";

const [video, calibPath, outDir, fpsArg] = process.argv.slice(2);
const fps = Number(fpsArg ?? 30);
const calibJson = JSON.parse(fs.readFileSync(calibPath, "utf8"));
const W = calibJson.width, H = calibJson.height;
const bgPath = path.resolve(path.dirname(calibPath), calibJson.background);
const bgRaw = fs.readFileSync(bgPath);
const background = new Uint8ClampedArray(bgPath.endsWith(".gz") ? gunzipSync(bgRaw) : bgRaw);
if (background.length !== W * H * 4) throw new Error("background size mismatch");
const calib = { width: W, height: H, crop: { x: 0, y: 0, w: W, h: H }, background, zones: calibJson.zones, beyArea: calibJson.beyArea, createdAt: 0 };
const config = structuredClone(DEFAULT_VISION_CONFIG);
if (calibJson.vision) Object.assign(config, calibJson.vision);
if (calibJson.spin) Object.assign(config.spin, calibJson.spin);
const vision = new VisionProcessor(calib, config);
const engine = new RefereeEngine(calibJson.rules ?? {});
fs.mkdirSync(outDir, { recursive: true });
const log = fs.createWriteStream(path.join(outDir, "trace.jsonl"));
const calls: unknown[] = [];
const transitions: unknown[] = [];
let lastState = engine.state;
let msSum = 0, n = 0, handFrames = 0;

const child = spawn("ffmpeg", ["-v", "error", "-i", video, "-vf", `fps=${fps}`, "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"], { stdio: ["ignore", "pipe", "inherit"] });
const frameLen = W * H * 4;
const buf = Buffer.alloc(frameLen);
let fill = 0, index = 0;
function snapshot(t: number, tag: string, rgba: Uint8ClampedArray) {
  fs.writeFileSync(path.join(outDir, `snap_${tag}_${t.toFixed(2)}.rgba`), rgba);
}
for await (const chunk of child.stdout) {
  let off = 0;
  while (off < chunk.length) {
    const k = Math.min(frameLen - fill, chunk.length - off);
    chunk.copy(buf, fill, off, off + k); fill += k; off += k;
    if (fill === frameLen) {
      const t = index / fps;
      const rgba = new Uint8ClampedArray(buf.buffer, buf.byteOffset, frameLen);
      const r = vision.process(rgba, t);
      const prev = engine.state;
      const step = engine.update(r.obs);
      if (engine.state !== prev && engine.state === "ARMED") vision.resetTracks();
      if (engine.state !== lastState) { transitions.push({ t: +t.toFixed(3), from: lastState, to: engine.state }); lastState = engine.state; }
      const tracks: Record<string, unknown> = {};
      for (const id of ["A", "B"] as const) {
        const tr = r.debug.tracks[id];
        tracks[id] = tr ? { cx: +tr.cx.toFixed(1), cy: +tr.cy.toFixed(1), r: +tr.radius.toFixed(1), vis: tr.visible, miss: tr.missing, merged: tr.merged, zone: tr.zone, spin: tr.spinning, d: tr.spin?.deltaDeg == null ? null : +tr.spin.deltaDeg.toFixed(2), dl: tr.spin?.longDeltaDeg == null ? null : +tr.spin.longDeltaDeg.toFixed(2), pk: tr.spin ? +tr.spin.peak.toFixed(2) : null, diff: tr.spin ? +tr.spin.diff.toFixed(1) : null, zr: tr.zoneRatio } : null;
      }
      log.write(JSON.stringify({ t: +t.toFixed(3), state: engine.state, hand: r.obs.hand, handArea: r.debug.handArea, fg: +r.debug.fgRatio.toFixed(3), shaken: r.debug.shaken, tracks, events: step.events, call: step.call, blobs: r.debug.blobs.map(b => ({ cls: b.cls, area: b.area, inside: b.inside, cx: Math.round(b.cx), cy: Math.round(b.cy) })) }) + "\n");
      if (step.call) { calls.push({ ...step.call, tracks }); console.log("CALL", t.toFixed(2), JSON.stringify(step.call)); snapshot(t, "call", rgba); }
      for (const e of step.events) if (e.kind === "live" || e.kind === "hand") console.log("EVENT", t.toFixed(2), e.kind, e.note ?? "");
      msSum += r.debug.ms; n++; handFrames += +r.obs.hand;
      index++; fill = 0;
    }
  }
}
log.end();
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ frames: n, fps, meanMs: +(msSum / n).toFixed(2), handFrames, transitions, calls }, null, 2));
console.log("DONE frames", n, "mean ms", (msSum / n).toFixed(2), "hand frames", handFrames, "calls", calls.length);
