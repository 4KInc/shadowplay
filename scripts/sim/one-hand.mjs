// One-hand mode in a story: Counting Stars (the first-launch story) opens with a
// two-hand bird. A child holding up one open hand (the "slow" persona's first
// 25 s) wakes it at once in one-hand mode; without one-hand mode it waits.
//
//   node scripts/sim/one-hand.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function firstBird(oneHand) {
  const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.evaluate((on) => {
    __sp.set('Settings', 'oneHand', on);
    __sp.set('DemoDirector', 'persona', 'slow');
    __sp.set('DemoDirector', 'playing', true);
  }, oneHand);
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.__sp.get('DemoDirector', 'status') !== undefined, null, { timeout: 30000 });
  await page.evaluate(() => __sp.set('StoryState', 'script', 'story/counting-stars.story.json'));
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-want-bird', null, { timeout: 90000, polling: 100 });
  const t0 = Date.now();
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') !== 'stars-want-bird', null, { timeout: 90000, polling: 100 });
  const seconds = (Date.now() - t0) / 1000;
  const shape = await page.evaluate(() => __sp.get('ShapeRecognizer', 'matchedShape'));
  await browser.close();
  return { seconds: +seconds.toFixed(1), shape };
}

const on = await firstBird(true);
const off = await firstBird(false);
const results = [
  [`one-hand mode: an open hand wakes the story's first bird at once (${on.seconds} s)`, on.seconds < 5],
  [`without one-hand mode the bird waits for two hands (${off.seconds} s)`, off.seconds > 15],
];
for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
if (results.some(([, ok]) => !ok)) process.exitCode = 1;
