// A dreamed story is shared like any other: dreamed in the headset (the server's
// own builder answers /api/dream from a canned reply), recorded, sent, and opened
// by its family code on the family viewer, where the dreamed story plays from the
// words it carries; then told live, where the family's device tells it too.
//
//   node scripts/sim/share-dreamed.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082 and the API server
// (npm run server) on :8787.
import { chromium } from 'playwright';
import { assembleStory, checkDream } from '../../server/dream.ts';
import { cannedWords } from '../../tests/fixtures/dream-words.mjs';

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
const errors = [];
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
async function page() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  // No AI key here: the server's own story builder answers, from a canned reply in place of the model's words.
  await context.route('**/api/dream', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { available: true } });
    const body = checkDream(JSON.parse(req.postData() ?? '{}'));
    return route.fulfill({ json: assembleStory(body, cannedWords(body.shapes)) });
  });
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return p;
}

// ---- Headset: dream a story, tell it while recording, send it.
const hs = await page();
await hs.goto(APP + '/', { waitUntil: 'load' });
await hs.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await hs.getByRole('button', { name: /Enter XR/i }).click();
await hs.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
await sleep(1500);
await hs.evaluate(() => __sp.set('ShadowJournal', 'open', true));
await sleep(1000);
await hs.evaluate(() => IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'hand' }));
// Hand tracking needs a moment after switching input, or the first pinch is missed.
await sleep(800);
// "Dream a new one" opens the chooser (a place and two shapes already picked); then "Dream it".
for (const id of ['story-dream', 'dream-go']) {
  const target = await hs.evaluate((id) => __sp.where(id), id);
  await hs.evaluate((t) => IWER_DEVICE.remote.dispatch('look_at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } }), target);
  await sleep(300);
  await hs.evaluate(() => IWER_DEVICE.remote.dispatch('set_select_value', { device: 'hand-right', value: 1 }));
  await sleep(250);
  await hs.evaluate(() => IWER_DEVICE.remote.dispatch('set_select_value', { device: 'hand-right', value: 0 }));
  await sleep(600);
}
await hs.waitForFunction(() => /^dreamed:/.test(__sp.get('StoryState', 'script')) && (__sp.get('StoryState', 'beatId') ?? '').startsWith('dream-'), null, { timeout: 20000 });
const title = await hs.evaluate(() => __sp.view().dream.title);
await hs.evaluate(() => {
  __sp.set('PerformanceRecorder', 'withVoice', false);
  __sp.set('PerformanceRecorder', 'recording', true);
  __sp.set('DemoDirector', 'persona', 'perfect');
  __sp.set('DemoDirector', 'playing', true);
});
await hs.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'dream-1-after', null, { timeout: 120000 });
await sleep(1000);
await hs.evaluate(() => {
  __sp.set('PerformanceRecorder', 'recording', false);
  __sp.set('DemoDirector', 'playing', false);
});
await hs.waitForFunction(() => __sp.get('PerformanceRecorder', 'lastId'), null, { timeout: 15000 });
await hs.evaluate(() => __sp.set('PerformanceRecorder', 'shareRequested', true));
await hs.waitForFunction(() => /^Sent!|^Could not/.test(__sp.get('PerformanceRecorder', 'status') ?? ''), null, { timeout: 20000 }).catch(() => undefined);
const status = await hs.evaluate(() => __sp.get('PerformanceRecorder', 'status'));
const code = status.match(/Family code: (\S+)/)?.[1] ?? '';
check('headset: a dreamed story is recorded and sent; a family code comes back', /^[a-z]+-[a-z]+-[a-z]+-\d+$/.test(code), { title, status });

// ---- Family viewer (another device): open it by its code; the dreamed story plays.
const v = await page();
await v.goto(APP + '/?viewer', { waitUntil: 'load' });
await v.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
if (code) {
  await v.getByRole('textbox', { name: 'Family code' }).fill(code);
  await v.getByRole('button', { name: 'Open' }).click();
  await v.waitForFunction(() => /is here/.test(document.querySelector('.sp-note')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => undefined);
  await v.locator('.sp-card').first().click();
  await v.waitForFunction(() => (__sp.get('StoryState', 'beatId') ?? '').startsWith('dream-'), null, { timeout: 30000 }).catch(() => undefined);
  const s = await v.evaluate(() => ({ script: __sp.get('StoryState', 'script'), beat: __sp.get('StoryState', 'beatId'), caption: __sp.get('StoryState', 'caption'), playing: __sp.get('PerformancePlayer', 'playing') }));
  check('viewer: the dreamed story opens by its code and plays from the words it carries', /^shared:/.test(s.script) && s.beat.startsWith('dream-') && s.playing, s);
  await v.evaluate(() => __sp.set('PerformancePlayer', 'playing', false));
} else check('viewer: the dreamed story opens by its code and plays from the words it carries', false, { reason: 'no code' });

// ---- Live: the headset (still on its dreamed story) goes live; a family device joins.
await hs.evaluate(() => {
  __sp.set('DemoDirector', 'playing', true);
  __sp.set('LiveSession', 'role', 'host');
});
await hs.waitForFunction(() => __sp.get('LiveSession', 'code'), null, { timeout: 15000 });
const liveCode = await hs.evaluate(() => __sp.get('LiveSession', 'code'));
const child = await page();
await child.goto(APP + '/?viewer', { waitUntil: 'load' });
await child.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await child.getByLabel('Family code').fill(liveCode.replace(/-/g, ' '));
await child.getByRole('button', { name: 'Join live' }).click();
await child.waitForFunction(() => __sp.get('LiveSession', 'peerPresent'), null, { timeout: 15000 }).catch(() => undefined);
await child.waitForFunction(() => /^shared:live-/.test(__sp.get('StoryState', 'script') ?? '') && (__sp.get('StoryState', 'beatId') ?? '').startsWith('dream-'), null, { timeout: 30000 }).catch(() => undefined);
const live = await child.evaluate(() => ({ script: __sp.get('StoryState', 'script'), beat: __sp.get('StoryState', 'beatId') }));
const host = await hs.evaluate(() => __sp.get('StoryState', 'beatId'));
check('live: the family device tells the same dreamed story', /^shared:live-/.test(live.script) && live.beat.startsWith('dream-'), { ...live, hostBeat: host });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
