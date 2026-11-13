// A finished story starts from the beginning on the next launch: play Counting
// Stars to its end, reload (a new session), enter XR again, and check it opens
// at the start, not on "Welcome back. Continuing from The End".
//
//   node scripts/sim/story-end.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
const enter = async () => {
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.__sp.get('DemoDirector', 'status') !== undefined, null, { timeout: 30000 });
};
await page.goto(APP + '/', { waitUntil: 'load' });
await enter();
await page.evaluate(() => {
  __sp.set('StoryState', 'script', 'story/counting-stars.story.json');
  __sp.set('DemoDirector', 'persona', 'perfect');
  __sp.set('DemoDirector', 'playing', true);
});
await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-end', null, { timeout: 300000, polling: 250 });
await sleep(1500);
await page.reload({ waitUntil: 'load' });
await enter();
await page.waitForFunction(() => __sp.get('StoryState', 'beatIndex') >= 0 && __sp.get('StoryState', 'caption'), null, { timeout: 60000 });
await sleep(500);
const s = await page.evaluate(() => ({
  script: __sp.get('StoryState', 'script'),
  index: __sp.get('StoryState', 'beatIndex'),
  beat: __sp.get('StoryState', 'beatId'),
  caption: __sp.get('StoryState', 'caption'),
}));
await browser.close();
const ok = s.index === 0 && !/Welcome back/.test(s.caption);
console.log(`${ok ? 'PASS' : 'FAIL'}  a finished story starts from the beginning next launch  ${JSON.stringify(s)}`);
if (!ok) process.exitCode = 1;
