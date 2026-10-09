import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { docsDir, repoDir } from './common.mjs';
const { values } = parseArgs({ options: {
  run: { type: 'string', default: path.join(docsDir, 'baseline/traces') },
  out: { type: 'string', default: path.join(docsDir, 'runs', `rules-${Date.now()}.json`) },
  'source-root': { type: 'string', default: repoDir },
}});
const { RefereeEngine } = await import(pathToFileURL(path.resolve(values['source-root'], 'lib/autoref/rules.ts')).href);
const jobs = JSON.parse(fs.readFileSync(path.join(docsDir, 'config/clips.json'), 'utf8'));
const results = [];
for (const job of jobs) {
  let file = path.resolve(values.run, `${job.id}.jsonl`);
  if (!fs.existsSync(file)) file += '.gz';
  const raw = fs.readFileSync(file);
  const rows = (file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  for (const stop of [.15, .3, .5, 1]) {
    const engine = new RefereeEngine({ spinStopConfirmSec: stop });
    let started = false, firstCall = null;
    for (const row of rows) {
      if (!started && row.t >= job.manualStart) { engine.manualStart(row.t); started = true; }
      const step = engine.update(row.obs);
      if (step.call && !firstCall) firstCall = step.call;
    }
    results.push({ id: job.id, spinStopConfirmSec: stop, firstCall });
  }
}
const out = path.resolve(values.out);
if (out.startsWith(path.join(docsDir, 'baseline') + path.sep) || fs.existsSync(out)) throw new Error('Refusing to overwrite a baseline or existing result.');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
console.log('Rule-only sensitivity result:', out);
