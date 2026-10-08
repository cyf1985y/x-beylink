import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { spawn, execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const docsDir = fileURLToPath(new URL('../', import.meta.url));
export const repoDir = path.resolve(docsDir, '../..');
export const expectedVideoSha = 'c82097e4e7b4ae48601a09c39f8c52f74c553795fac62670f58a1290c8611ad8';

export function options(defaultJobs = 'clips.json') {
  const { values } = parseArgs({ options: {
    jobs: { type: 'string', default: path.join(docsDir, 'config', defaultJobs) },
    video: { type: 'string', default: path.join(docsDir, 'data/oXBdn4yQYog.mp4') },
    out: { type: 'string' }, 'source-root': { type: 'string', default: repoDir },
    only: { type: 'string' }, 'limit-seconds': { type: 'string' },
    'allow-different-video': { type: 'boolean', default: false },
    ffmpeg: { type: 'string', default: 'ffmpeg' },
  }});
  const video = path.resolve(values.video);
  if (!fs.existsSync(video)) throw new Error(`Video missing: ${video}. See docs/autoref/README.md.`);
  const videoSha = createHash('sha256').update(fs.readFileSync(video)).digest('hex');
  if (videoSha !== expectedVideoSha && !values['allow-different-video']) {
    throw new Error('Video SHA-256 differs from the baseline. Use the original file or explicitly pass --allow-different-video; calibration may then be invalid.');
  }
  const sourceRoot = path.resolve(values['source-root']);
  const out = path.resolve(values.out ?? path.join(docsDir, 'runs', new Date().toISOString().replace(/[:.]/g, '-')));
  for (const sub of ['baseline', 'calibration', 'config', 'evidence', 'reports', 'tools']) {
    const protectedDir = path.join(docsDir, sub);
    if (out === protectedDir || out.startsWith(protectedDir + path.sep)) throw new Error(`Refusing to write into preserved ${sub}/.`);
  }
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`Output directory is not empty: ${out}`);
  fs.mkdirSync(out, { recursive: true });
  let revision = null;
  try { revision = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(); } catch { /* non-Git source roots are recorded as null */ }
  return { ...values, video, videoSha, sourceRoot, out, revision };
}

export async function engines(sourceRoot) {
  const base = path.join(sourceRoot, 'lib/autoref');
  const [{ VisionProcessor }, { RefereeEngine }, { DEFAULT_VISION_CONFIG }] = await Promise.all([
    import(pathToFileURL(path.join(base, 'vision/pipeline.ts')).href),
    import(pathToFileURL(path.join(base, 'rules.ts')).href),
    import(pathToFileURL(path.join(base, 'vision/config.ts')).href),
  ]);
  return { VisionProcessor, RefereeEngine, DEFAULT_VISION_CONFIG };
}

export function jobsFor(opt) {
  const configPath = path.resolve(opt.jobs);
  let jobs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (opt.only) jobs = jobs.filter(j => j.id === opt.only);
  if (!jobs.length) throw new Error('No matching jobs.');
  return jobs.map(j => {
    const job = { ...j, background: path.resolve(path.dirname(configPath), j.background) };
    if (opt['limit-seconds'] !== undefined) {
      const limit = Number(opt['limit-seconds']);
      if (!Number.isFinite(limit) || limit <= 0) throw new Error('--limit-seconds must be positive.');
      job.end = Math.min(job.end, job.start + limit);
    }
    if (!Number.isFinite(job.start) || !Number.isFinite(job.end) || job.end <= job.start || !Number.isInteger(job.fps) || job.fps <= 0) throw new Error(`Invalid job: ${job.id}`);
    return job;
  });
}

export function calibration(job) {
  const raw = fs.readFileSync(job.background);
  const background = new Uint8ClampedArray(job.background.endsWith('.gz') ? gunzipSync(raw) : raw);
  if (background.length !== 480 * 480 * 4) throw new Error('Expected 480x480 RGBA calibration.');
  return { width: 480, height: 480, crop: { x: 0, y: 0, w: 720, h: 720 }, background, zones: job.zones, beyArea: job.beyArea, createdAt: 0 };
}

export async function* decodeFrames(opt, job) {
  const child = spawn(opt.ffmpeg, ['-v', 'error', '-ss', String(job.start), '-i', opt.video,
    '-t', String(job.end - job.start), '-vf', `fps=${job.fps},scale=480:480:flags=bilinear`,
    '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', c => { errors = (errors + c).slice(-16000); });
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg failed (${code}): ${errors}`)));
  });
  finished.catch(() => {});
  const frame = Buffer.alloc(480 * 480 * 4);
  let fill = 0, index = 0;
  try {
    for await (const chunk of child.stdout) {
      let offset = 0;
      while (offset < chunk.length) {
        const n = Math.min(frame.length - fill, chunk.length - offset);
        chunk.copy(frame, fill, offset, offset + n); fill += n; offset += n;
        if (fill === frame.length) { yield { frame, index, t: job.start + index / job.fps }; index++; fill = 0; }
      }
    }
    await finished;
    if (fill) throw new Error('Incomplete RGBA frame.');
  } finally {
    if (child.exitCode === null) child.kill();
  }
}
