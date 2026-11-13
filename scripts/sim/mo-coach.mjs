// Mo the coach: a player stuck on a shape (the demo's "slow" persona holds one
// open hand for 25 s when the two-hand bird is asked for) gets Mo's tips at 9 s
// and 21 s, built from what the hand tracker sees ("only one hand is in view"),
// in a bubble beside Mo; none once the bird wakes. "help" (voice commands) asks
// at once. The server's /api/coach is answered by the test (as Claude would,
// through it); when it is unavailable or fails, Mo uses the app's own words.
//
//   node scripts/sim/mo-coach.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `mo-coach-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });

/** A page whose /api/coach behaves as `mode` says: 'ai' (answers), 'off' (unavailable), 'fail' (errors). */
async function session(mode) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const asked = [];
  await context.route('**/api/coach', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { available: mode !== 'off' } });
    asked.push(JSON.parse(req.postData() ?? '{}'));
    if (mode === 'fail') return route.fulfill({ status: 502, json: { error: 'down' } });
    return route.fulfill({ json: { line: `Two hands, little one! Wrists together, like wings. (${asked.length})`, source: 'ai' } });
  });
  await context.addInitScript(() => {
    window.SpeechRecognition = class {
      start() {
        window.__rec = this;
      }
      abort() {}
    };
    window.__say = (t) => window.__rec?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/api\/coach|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  await page.evaluate(() => {
    __sp.set('Settings', 'voiceCommands', true);
    __sp.set('DemoDirector', 'persona', 'slow');
    __sp.set('DemoDirector', 'playing', true);
  });
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-want-bird', null, { timeout: 90000 });
  return { context, page, asked, coach: () => page.evaluate(() => __sp.view().coach) };
}

// A. Claude available (through the server): two tips while stuck, then none once the bird wakes.
{
  const { context, page, asked, coach } = await session('ai');
  const t0 = Date.now();
  await page.waitForFunction(() => __sp.view().coach.tips >= 1, null, { timeout: 20000 });
  const first = await coach();
  const firstAt = (Date.now() - t0) / 1000;
  await sleep(700);
  await page.screenshot({ path: join(OUT, 'mo-tip.png') });
  console.log(`screenshot: ${join(OUT, 'mo-tip.png')}`);
  const bubble = await page.evaluate(() => {
    const p = __sp.where('mo-tip');
    return p !== null;
  });
  check('first tip after ~9 s, from what the tracker sees, in a bubble', first.source === 'ai' && /Wrists together/.test(first.line) && asked[0]?.shape === 'bird' && asked[0]?.facts?.[0] === 'one-hand-seen' && asked[0]?.attempt === 0 && bubble && firstAt > 6 && firstAt < 13, {
    firstAt: +firstAt.toFixed(1),
    sent: asked[0],
    line: first.line,
  });
  await page.waitForFunction(() => __sp.view().coach.tips >= 2, null, { timeout: 20000 });
  check('second tip around 21 s, asked to be said differently', asked[1]?.attempt === 1, { sent: asked[1] });
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') !== 'stars-want-bird', null, { timeout: 30000 });
  const tipsAtWake = (await coach()).tips;
  await sleep(4000);
  check('no more tips once the bird wakes', (await coach()).tips === tipsAtWake && asked.every((a) => !Object.keys(a).some((k) => !['shape', 'facts', 'attempt'].includes(k))), { tips: tipsAtWake, keysSent: [...new Set(asked.flatMap(Object.keys))] });

  // "help" at the next request: a tip at once.
  await page.waitForFunction(() => /^stars-want-/.test(__sp.get('StoryState', 'beatId')) && __sp.get('StoryState', 'beatId') !== 'stars-want-bird' && __sp.get('StoryState', 'status') === 'playing', null, { timeout: 120000 });
  await sleep(1500);
  const before = (await coach()).tips;
  await page.evaluate(() => window.__say('help'));
  await sleep(1200);
  const after = await coach();
  check('"help" asks Mo at once', after.tips === before + 1, { before, after: after.tips, beat: await page.evaluate(() => __sp.get('StoryState', 'beatId')) });
  await context.close();
}

// B. No AI on this server: Mo still helps, in the app's own words.
{
  const { context, page, asked, coach } = await session('off');
  await page.waitForFunction(() => __sp.view().coach.tips >= 1, null, { timeout: 20000 });
  const c = await coach();
  check('no AI available: a local tip, nothing sent', c.source === 'local' && /bird/.test(c.line) && asked.length === 0, { line: c.line });
  await context.close();
}

// C. The AI call fails: the same local words.
{
  const { context, page, asked, coach } = await session('fail');
  await page.waitForFunction(() => __sp.view().coach.tips >= 1, null, { timeout: 20000 });
  const c = await coach();
  check('AI call fails: falls back to a local tip', c.source === 'local' && asked.length === 1, { line: c.line });
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
