// Narration that stalls: a clip whose download never completes must not leave
// the story waiting on silence. The mo-intro clip's request is held open:
//   1. always held: the line ends a few seconds after it should have started
//      (retry at 3 s, give up at 6 s), not at the 28 s safety limit;
//   2. held once: the retry fetches it again and it plays to the end (the line
//      then lasts the 3 s wait plus the whole clip).
//
//   node scripts/sim/narration-stall.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

async function scenario(name, holdFirstOnly) {
  const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  let requests = 0;
  await page.route(/narration\/.*mo-intro/, async (route) => {
    requests++;
    if (holdFirstOnly && requests > 1) return route.continue();
    // Held open: never answered (a stalled download).
  });
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'mo-intro', null, { timeout: 60000 });
  const t0 = Date.now();
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') !== 'mo-intro', null, { timeout: 60000, polling: 100 });
  const seconds = (Date.now() - t0) / 1000;
  await browser.close();
  return { name, seconds: +seconds.toFixed(1), requests };
}

const held = await scenario('clip download never completes', false);
results.push({ ...held, ok: held.seconds < 12 && held.requests >= 2 });
const once = await scenario('first download stalls, the retry works', true);
// The whole clip played after the retry: the line outlasts the wait plus the clip's length.
const clip = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'public/narration/mo-intro.mp3']));
results.push({ ...once, ok: once.seconds >= 3 + clip - 0.3 && once.seconds < 16 && once.requests >= 2 });
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: line lasted ${r.seconds} s, ${r.requests} requests (safety limit without the watch: about 28 s)`);
if (results.some((r) => !r.ok)) process.exitCode = 1;
