// Bot playtesters: simulated children (demo director personas) play The Moth from the
// Prologue in the emulated headset, each in a fresh browser. Checks that the story never
// stalls, that help arrives for children who struggle, and collects performance numbers.
//
//   node scripts/sim/playtest.mjs [--seconds 240] [--personas perfect,small,shaky,wrong,slow,wanderer]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const SECONDS = Number(arg('--seconds', 240));
const PERSONAS = arg('--personas', 'perfect,small,shaky,wrong,slow,wanderer').split(',');
const OUT = join(MEDIA_DIR, `playtest-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const script = JSON.parse(readFileSync('public/story/the-moth.story.json', 'utf8'));

async function play(persona) {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.__sp.get('DemoDirector', 'status') !== undefined, null, { timeout: 30000 });
  await page.evaluate((p) => {
    __sp.set('StoryState', 'script', 'story/the-moth.story.json');
    __sp.set('DemoDirector', 'persona', p);
    __sp.set('DemoDirector', 'playing', true);
  }, persona);
  const start = Date.now();
  const samples = [];
  const perf = [];
  while (Date.now() - start < SECONDS * 1000) {
    await sleep(1000);
    const s = await page.evaluate(() => ({
      beat: __sp.get('StoryState', 'beatId'),
      index: __sp.get('StoryState', 'beatIndex'),
      hint: __sp.get('StoryState', 'hintVisible'),
      assist: __sp.get('StoryState', 'assist'),
      caption: __sp.get('StoryState', 'caption'),
    })).catch(() => null);
    if (s) samples.push({ t: Date.now() - start, ...s });
    if (samples.length % 5 === 0) perf.push(await page.evaluate(() => __sp.perf()).catch(() => null));
    if (samples.length === 90) await page.screenshot({ path: join(OUT, `${persona}.png`) }).catch(() => undefined);
  }
  const beats = await page.evaluate(() => __sp.beats());
  const frames = await page.evaluate(() => __sp.frames());
  await browser.close();

  const types = Object.fromEntries((script?.beats ?? []).map((b) => [b.id, b.type]));
  const spans = beats.map((b, i) => ({ id: b.id, type: types[b.id], seconds: ((beats[i + 1]?.t ?? Date.now()) - b.t) / 1000 }));
  const requests = spans.filter((s) => s.type === 'request' || s.type === 'choice');
  const longest = [...spans].sort((a, b) => b.seconds - a.seconds)[0];
  const peaks = perf.filter(Boolean);
  return {
    persona,
    furthestBeat: samples.reduce((m, s) => (s.index > m.index ? s : m), { index: -1 }).beat,
    beatsEntered: beats.length,
    shapeMoments: requests.map((r) => `${r.id} ${r.seconds.toFixed(0)}s`),
    hintShown: samples.some((s) => s.hint),
    maxAssist: Math.max(0, ...samples.map((s) => s.assist ?? 0)),
    longestBeat: longest ? `${longest.id} (${longest.type}) ${longest.seconds.toFixed(0)}s` : null,
    stalled: longest ? longest.seconds > 75 : true,
    fps: +(frames / SECONDS).toFixed(1),
    peakDrawCalls: Math.max(0, ...peaks.map((p) => p.peak.calls)),
    peakTriangles: Math.max(0, ...peaks.map((p) => p.peak.triangles)),
    appMsMedian: peaks.at(-1)?.appMs?.median?.toFixed(2),
    appMsP95: peaks.at(-1)?.appMs?.p95?.toFixed(2),
    errors: errors.slice(0, 3),
  };
}

const results = [];
for (const persona of PERSONAS) {
  console.log(`playing as ${persona}...`);
  const r = await play(persona);
  results.push(r);
  console.log(JSON.stringify(r));
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 2));
console.table(results.map(({ shapeMoments, errors, ...r }) => ({ ...r, errors: errors.length })));
console.log('screenshots and report:', OUT);
