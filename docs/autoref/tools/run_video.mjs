import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { options, engines, jobsFor, calibration, decodeFrames } from './common.mjs';

const opt = options();
const { VisionProcessor, RefereeEngine, DEFAULT_VISION_CONFIG } = await engines(opt.sourceRoot);
const run = { sourceRevision: opt.revision, videoSha256: opt.videoSha, sourceRoot: opt.sourceRoot, jobs: [] };
for (const job of jobsFor(opt)) {
  const calib = calibration(job);
  const config = structuredClone(DEFAULT_VISION_CONFIG);
  if (job.visionOverrides) Object.assign(config, job.visionOverrides);
  const vision = new VisionProcessor(calib, config), engine = new RefereeEngine();
  const metrics = { frames: 0, hand: 0, shaken: 0, twoVisible: 0, twoSpinning: 0, fgSum: 0, msSum: 0, stateCounts: {}, calls: [], transitions: [], job, config, sourceRevision: opt.revision, videoSha256: opt.videoSha };
  const log = fs.createWriteStream(path.join(opt.out, `${job.id}.jsonl`));
  let lastState = engine.state;
  for await (const { frame, index, t } of decodeFrames(opt, job)) {
    if (job.manualStart !== undefined && index === Math.round((job.manualStart - job.start) * job.fps)) {
      engine.manualStart(t); vision.resetTracks();
    }
    // Diagnostic preprocessing only; never enabled in the primary jobs.
    if (job.ignoreBands) for (const [y0, y1] of job.ignoreBands) frame.set(calib.background.subarray(y0 * 480 * 4, y1 * 480 * 4), y0 * 480 * 4);
    const r = vision.process(new Uint8ClampedArray(frame.buffer, frame.byteOffset, frame.length), t);
    const previous = engine.state, step = engine.update(r.obs);
    if (engine.state !== previous && engine.state === 'ARMED') vision.resetTracks();
    if (engine.state !== lastState) { metrics.transitions.push({ t, from: lastState, to: engine.state }); lastState = engine.state; }
    const tracks = {};
    for (const id of ['A', 'B']) {
      const tr = r.debug.tracks[id];
      tracks[id] = tr ? { cx: tr.cx, cy: tr.cy, radius: tr.radius, visible: tr.visible, missing: tr.missing, merged: tr.merged, zone: tr.zone, spinning: tr.spinning, spin: tr.spin, zoneRatio: tr.zoneRatio } : null;
    }
    const record = { t, obs: r.obs, state: engine.state, call: step.call, events: step.events, fg: r.debug.fgRatio, shaken: r.debug.shaken, handArea: r.debug.handArea, tracks,
      blobs: r.debug.blobs.map(b => ({ area: b.area, cx: b.cx, cy: b.cy, bbox: b.bbox, cls: b.cls })) };
    if (job.logEvery === undefined || index % job.logEvery === 0 || step.call || step.events.length) {
      if (!log.write(JSON.stringify(record) + '\n')) await once(log, 'drain');
    }
    if (job.saveFrames?.some(x => Math.abs(t - x) < 0.5 / job.fps)) {
      const frameDir = path.join(opt.out, 'frames'); fs.mkdirSync(frameDir, { recursive: true });
      const stem = path.join(frameDir, `${job.id}_${t.toFixed(3)}`);
      fs.writeFileSync(stem + '.rgba', frame); fs.writeFileSync(stem + '.mask', vision.foreground); fs.writeFileSync(stem + '.json', JSON.stringify(record, null, 2));
    }
    metrics.frames++; metrics.hand += +r.obs.hand; metrics.shaken += +r.debug.shaken;
    metrics.twoVisible += +(r.obs.beys.filter(b => b.visible).length === 2);
    metrics.twoSpinning += +(r.obs.beys.filter(b => b.visible && b.spinning === true).length === 2);
    metrics.fgSum += r.debug.fgRatio; metrics.msSum += r.debug.ms;
    metrics.stateCounts[engine.state] = (metrics.stateCounts[engine.state] ?? 0) + 1;
    if (step.call) { metrics.calls.push({ ...step.call, tracks, obs: r.obs }); console.log(job.id, 'CALL', JSON.stringify(step.call)); }
    if (index % 3600 === 0) console.log(job.id, 'source sec', t.toFixed(1), 'frames', index);
  }
  log.end(); await once(log, 'finish');
  fs.writeFileSync(path.join(opt.out, `${job.id}.summary.json`), JSON.stringify(metrics, null, 2) + '\n');
  run.jobs.push({ id: job.id, frames: metrics.frames, calls: metrics.calls.length });
  console.log('DONE', job.id, metrics.frames, 'frames,', metrics.calls.length, 'calls');
}
fs.writeFileSync(path.join(opt.out, 'run_manifest.json'), JSON.stringify(run, null, 2) + '\n');
console.log('Results:', opt.out);
