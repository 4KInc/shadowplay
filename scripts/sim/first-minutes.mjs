// First five minutes: a fresh first launch (empty storage), Enter XR, and a bot
// child (demo director persona) playing. Measures the time from Enter XR to the
// first creature waking, and how much text is on screen before it.
//
//   node scripts/sim/first-minutes.mjs [--gpu] [--personas perfect,small,slow]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const PERSONAS = arg('--personas', 'perfect,small,slow').split(',');
const TARGET_SECONDS = 60;
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(persona) {
  const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  // The director plays as soon as the stage is up; it acts only on request beats.
  await page.evaluate((p) => {
    __sp.set('DemoDirector', 'persona', p);
    __sp.set('DemoDirector', 'playing', true);
  }, persona);
  const xrAt = await page.evaluate(() => Date.now());
  await page.getByRole('button', { name: /Enter XR/i }).click();
  const captions = [];
  let woke = null;
  let asked = null;
  let firstCaption = null;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await sleep(250);
    const s = await page.evaluate(() => ({ beat: __sp.get('StoryState', 'beatId'), caption: __sp.get('StoryState', 'caption'), now: Date.now() }));
    const t = (s.now - xrAt) / 1000;
    if (s.caption && captions.at(-1) !== s.caption) {
      captions.push(s.caption);
      firstCaption ??= t;
    }
    if (s.beat === 'want-rabbit') asked ??= t;
    if (asked !== null && s.beat !== 'want-rabbit') {
      woke = t;
      break;
    }
  }
  const words = captions.join(' ').split(/\s+/).filter(Boolean).length;
  await browser.close();
  return {
    persona,
    firstCaptionS: firstCaption?.toFixed(1),
    askedS: asked?.toFixed(1),
    firstCreatureS: woke?.toFixed(1) ?? 'never',
    underTarget: woke !== null && woke < TARGET_SECONDS,
    captionsBefore: captions.length,
    wordsBefore: words,
    errors: errors.length,
  };
}

const results = [];
for (const p of PERSONAS) {
  const r = await run(p);
  results.push(r);
  console.log(JSON.stringify(r));
}
console.table(results);
if (results.some((r) => !r.underTarget || r.errors)) process.exitCode = 1;
