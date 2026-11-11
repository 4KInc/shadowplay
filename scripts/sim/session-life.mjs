// A session's life: the first screen's accessibility toggles, stepping away
// (Quest menu: visible-blurred; headset off: hidden) and coming back, the
// first shape taught early, the light flare when a creature wakes, and a
// session ended mid-story continuing on the next launch.
//
//   node scripts/sim/session-life.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
// Watch the narration's audio elements: are any playing right now?
await context.addInitScript(() => {
  const all = new Set();
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    all.add(this);
    return play.apply(this, a);
  };
  window.__audioPlaying = () => [...all].some((a) => !a.paused && !a.ended);
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const get = (c, f) => page.evaluate(([c, f]) => __sp.get(c, f), [c, f]);
const story = () =>
  page.evaluate(() => ({
    status: __sp.get('StoryState', 'status'),
    beat: __sp.get('StoryState', 'beatId'),
    index: __sp.get('StoryState', 'beatIndex'),
    caption: __sp.get('StoryState', 'caption'),
    audio: window.__audioPlaying(),
  }));
const visibility = (state) => page.evaluate((s) => IWER_DEVICE.updateVisibilityState(s), state);

await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });

// 1. First screen: one-hand mode and forgiving shapes, one tap each, remembered.
{
  const oneHand = page.getByRole('button', { name: 'One-hand mode' });
  const forgiving = page.getByRole('button', { name: 'Forgiving shapes' });
  const visible = await Promise.all([oneHand, forgiving].map((b) => b.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false))).then((v) => v.every(Boolean));
  await oneHand.click();
  await forgiving.click();
  await sleep(500);
  const after = { oneHand: await get('Settings', 'oneHand'), tolerance: await get('Settings', 'tolerance') };
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  const reloaded = { oneHand: await get('Settings', 'oneHand'), tolerance: await get('Settings', 'tolerance') };
  const pressed = await page.getByRole('button', { name: 'One-hand mode' }).getAttribute('aria-pressed');
  check('first screen: accessibility toggles visible, applied and remembered', visible && after.oneHand && after.tolerance === 'forgiving' && reloaded.oneHand && reloaded.tolerance === 'forgiving' && pressed === 'true', { after, reloaded, pressed });
  // Back to defaults so the rest of the run behaves like a first-timer's.
  await page.getByRole('button', { name: 'One-hand mode' }).click();
  await page.getByRole('button', { name: 'Forgiving shapes' }).click();
  await sleep(300);
}

// 2. Enter XR with a slow child; the first request shows the ghost hand within ~2 s.
await page.evaluate(() => {
  __sp.set('DemoDirector', 'persona', 'slow');
  __sp.set('DemoDirector', 'playing', true);
});
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'hush', null, { timeout: 60000 });

// 3. Quest menu mid-line: everything pauses; back: it carries on.
{
  await sleep(1200);
  const before = await story();
  await visibility('visible-blurred');
  await sleep(4000);
  const during = await story();
  await visibility('visible');
  await sleep(1500);
  const after = await story();
  check('Quest menu (visible-blurred): story and narration pause, then resume', before.audio && during.status === 'paused' && during.caption === 'Paused.' && !during.audio && during.index === before.index && after.status === 'playing' && after.audio, { before, during, after });
}

// 4. Headset off for 10 s (hidden): no frames run; on return the story has not skipped ahead.
{
  const before = await story();
  await visibility('hidden');
  await sleep(10000);
  const during = await story();
  await visibility('visible');
  await sleep(600);
  const after = await story();
  check('headset off (hidden) 10 s: narration silent, no beats skipped on return', !during.audio && after.index - before.index <= 1 && after.status === 'playing', { before, during, after });
}

// 5. The first request: ghost hand at ~2 s, then the wake flare.
{
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'want-rabbit', null, { timeout: 90000 });
  const t0 = Date.now();
  await page.waitForFunction(() => __sp.get('StoryState', 'hintVisible'), null, { timeout: 20000 });
  const hintAfter = (Date.now() - t0) / 1000;
  check('first request: the ghost hand appears within 3 s (setting: after 15 s)', hintAfter <= 3, { hintAfter });
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') !== 'want-rabbit', null, { timeout: 60000 });
  const flare = await page.evaluate(() => __sp.view().flare);
  check('a creature waking flares the lamp light', flare > 0.3, { flare });
}

// 6. Session ends mid-story (reload during Chapter One); next launch continues there, and says so.
{
  await page.waitForFunction(() => __sp.get('StoryState', 'chapter') === 'Chapter One', null, { timeout: 30000 });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => __sp.get('StoryState', 'beatIndex') >= 0 && __sp.get('StoryState', 'caption'), null, { timeout: 60000 });
  await sleep(500);
  const s = await story();
  check('next launch continues from Chapter One with a welcome back', /^Welcome back\. Continuing from Chapter One/.test(s.caption) && s.beat === 'ch1', s);
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
