// Summarize device diagnostics (?diag sessions), one block per session.
//   node scripts/diag/summarize.mjs .data/diag                    (local folder, recursive)
//   node scripts/diag/summarize.mjs path/to/session.jsonl ...
//   gsutil cat 'gs://<bucket>/diag/2026-11-12/*.jsonl' | node scripts/diag/summarize.mjs -
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(path) {
  if (statSync(path).isDirectory()) return readdirSync(path).flatMap((f) => files(join(path, f)));
  return path.endsWith('.jsonl') ? [path] : [];
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: summarize.mjs <dir | file.jsonl ... | ->');
  process.exit(1);
}
const text = args[0] === '-' ? readFileSync(0, 'utf8') : args.flatMap(files).map((f) => readFileSync(f, 'utf8')).join('\n');
const sessions = new Map();
for (const line of text.split('\n')) {
  if (!line.trim()) continue;
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }
  if (!sessions.has(row.session)) sessions.set(row.session, []);
  sessions.get(row.session).push(row);
}

const pct = (xs, p) => {
  if (!xs.length) return '-';
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1);
};
const count = (xs) => Object.entries(xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).map(([k, v]) => `${k} x${v}`).join(', ') || '-';

for (const [id, rows] of [...sessions].sort((a, b) => a[1][0].at - b[1][0].at)) {
  rows.sort((a, b) => a.at - b.at || a.t - b.t);
  const snaps = rows.filter((r) => r.k === 'snap');
  const xrSnaps = snaps.filter((s) => s.vis && s.vis !== 'non-immersive');
  const ev = (e) => rows.filter((r) => r.k === 'ev' && r.e === e);
  const first = rows[0];
  const minutes = ((rows.at(-1).at - first.at) / 60000).toFixed(1);
  console.log(`\n=== ${id}  ${first.device}  ${first.gpu}  ${new Date(first.at).toISOString().replace('T', ' ').slice(0, 19)}  ${minutes} min`);
  const fps = xrSnaps.map((s) => s.fps).filter((x) => x > 0);
  const p95 = xrSnaps.map((s) => s.p95Ms).filter((x) => x > 0);
  const worst = xrSnaps.map((s) => s.worstMs).filter((x) => x > 0);
  console.log(`fps in XR (per 5 s window): p5 ${pct(fps, 0.05)}  median ${pct(fps, 0.5)}  p95 ${pct(fps, 0.95)}   frame p95 ms: median ${pct(p95, 0.5)}  worst window ${pct(worst, 1)}`);
  const below = fps.filter((f) => f < 60).length;
  console.log(`windows under 60 fps: ${below}/${fps.length}   session frame rate: ${[...new Set(xrSnaps.map((s) => s.rate))].join('/') || '-'}  supported: ${(xrSnaps.at(-1)?.rates ?? []).join(',') || '-'}`);
  const rate = ev('rate')[0];
  if (rate) console.log(`requested 72 Hz: ${rate.result ?? (rate.ok ? 'granted' : 'refused')}`);
  const q = ev('quality');
  console.log(`quality: ${q.length ? q.map((e) => `-> ${e.level} at ${e.t}s (${e.fps} fps)`).join(', ') : 'stayed at 0'}   final shadow map ${snaps.at(-1)?.shadowMap ?? '-'}`);
  for (const p of ev('placed')) {
    console.log(`placed: ${p.place}  wall ${p.wallW} m wide at ${p.wallD} m  stage ${p.stageW} m  planes ${p.planes} (vertical ${p.vplanes})${p.labels?.length ? ' labels: ' + p.labels.join(', ') : p.vlabels ? ': ' + p.vlabels : ''}  meshes ${p.meshes}  at ${p.t}s`);
  }
  const last = snaps.at(-1);
  if (last) console.log(`startup: page load to XR ${(last.xrMs / 1000).toFixed(1)}s, XR to stage placed ${(last.placedMs / 1000).toFixed(1)}s   heap ${last.heapMB} MB`);
  const triggers = ev('trigger');
  // First five minutes: Enter XR to the first creature waking (target under 60 s).
  const xrAt = ev('vis').find((v) => v.state !== 'non-immersive')?.t;
  const firstWake = triggers.find((t) => xrAt !== undefined && t.t >= xrAt);
  if (xrAt !== undefined) console.log(`first creature: ${firstWake ? `${(firstWake.t - xrAt).toFixed(0)} s after entering XR (${firstWake.shape})` : 'none woke'}   target under 60 s`);
  console.log(`recognition triggers: ${count(triggers.map((t) => `${t.shape}${t.target && t.target !== t.shape && t.target !== 'none' ? `(asked ${t.target})` : ''}${t.free ? '[free]' : ''}`))}`);
  const drops = ev('dropouts');
  if (drops.length) {
    const total = drops.reduce((n, d) => n + d.flickers, 0);
    console.log(`hand-tracking flickers: ${total} in ${drops.length} beats; worst ${[...drops].sort((a, b) => b.flickers / b.seconds - a.flickers / a.seconds).slice(0, 3).map((d) => `${d.beat} ${d.flickers} in ${d.seconds}s`).join(', ')}`);
  } else console.log('hand-tracking flickers: none');
  const beats = ev('beat');
  console.log(`story: ${beats.length} beats, ${[...new Set(beats.map((b) => b.script))].join(', ') || '-'}; last ${beats.at(-1)?.beat ?? '-'}`);
  console.log(`visibility: ${ev('vis').map((v) => v.state).join(' > ') || '-'}   page: ${ev('page').map((v) => v.state).join(' > ') || '-'}`);
  const errors = ev('error');
  console.log(`errors: ${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log(`  ${e.t}s ${e.message.slice(0, 120)}  [${e.source}]\n    ${(e.stack ?? '').split('\n').slice(0, 2).join(' | ').slice(0, 200)}`);
}
console.log(`\n${sessions.size} session(s)`);
