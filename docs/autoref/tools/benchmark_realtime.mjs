import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { options, engines, jobsFor, calibration, decodeFrames } from './common.mjs';
const opt = options();
const { VisionProcessor, RefereeEngine } = await engines(opt.sourceRoot);
const base = jobsFor(opt).find(j => j.id === 'spin_local_60fps');
if (!base) throw new Error('Benchmark requires spin_local_60fps from clips.json.');
const duration = opt['limit-seconds'] === undefined ? 30 : Number(opt['limit-seconds']);
const job = { ...base, end: base.start + duration, fps: 60 };
const vision = new VisionProcessor(calibration(job)), engine = new RefereeEngine();
const core = [], withRules = [], wallStart = performance.now();
for await (const { frame, index, t } of decodeFrames(opt, job)) {
  if (index === 30) { engine.manualStart(t); vision.resetTracks(); }
  const begin = performance.now();
  const r = vision.process(new Uint8ClampedArray(frame.buffer, frame.byteOffset, frame.length), t);
  const old = engine.state; engine.update(r.obs);
  if (old !== engine.state && engine.state === 'ARMED') vision.resetTracks();
  withRules.push(performance.now() - begin); core.push(r.debug.ms);
}
const wallSec = (performance.now() - wallStart) / 1000;
function stats(a) {
  if (!a.length) return null;
  const b = a.slice().sort((x, y) => x - y);
  return { n: a.length, mean: a.reduce((s, v) => s + v, 0) / a.length,
    p50: b[Math.ceil(.5 * b.length) - 1], p95: b[Math.ceil(.95 * b.length) - 1], p99: b[Math.ceil(.99 * b.length) - 1], max: b.at(-1),
    over16_67ms: a.filter(x => x > 1000 / 60).length / a.length, over33_33ms: a.filter(x => x > 1000 / 30).length / a.length };
}
const result = { sourceRevision: opt.revision, videoSha256: opt.videoSha, cpu: os.cpus()[0].model, logicalCores: os.cpus().length, node: process.version,
  source_range: [job.start, job.end], fps_input: 60, resolution: [480, 480], frames: core.length, warmup_frames_excluded: Math.min(120, core.length),
  core_all: stats(core), core_steady: stats(core.slice(120)), vision_and_rules_steady: stats(withRules.slice(120)),
  offline_decode_and_inference: { wall_sec: wallSec, throughput_fps: core.length / wallSec, source_duration_sec: duration },
  limitations: ['Desktop Node/FFmpeg only. No browser camera, canvas, Worker roundtrip, recording, UI, or mobile thermal test.', 'No per-frame JSON output; first 120 frames excluded from steady statistics.', 'Offline throughput is not capture-to-decision latency or camera FPS.'] };
fs.writeFileSync(path.join(opt.out, 'realtime_benchmark.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
