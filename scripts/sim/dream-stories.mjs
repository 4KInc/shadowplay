// "Dream a new one": pinching the button (hand ray) asks the server for a new
// story (answered here by the server's own story builder, server/dream.ts, from
// a canned reply in place of Claude's words); it is told at once, played to the
// end by the demo player, resumed after a reload mid-story, and kept out of
// Record (it lives on this headset only). Saying "dream a new story" asks for
// another. Where the server has no AI, the button says so and nothing changes.
//
//   node scripts/sim/dream-stories.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
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

async function session(available) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const asked = [];
  await context.route('**/api/dream', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { available } });
    const body = checkDream(JSON.parse(req.postData() ?? '{}'));
    asked.push(body);
    if (!body) return route.fulfill({ status: 400, json: { error: 'bad' } });
    return route.fulfill({ json: assembleStory(body, cannedWords(body.shapes)) });
  });
  await context.route('**/api/coach', (route) => route.fulfill({ json: { available: false } }));
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
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { context, page, asked };
}
async function enter(page) {
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().head[1] > 1 && window.__sp.view().ready, null, { timeout: 30000 });
  await sleep(2000);
}
const remote = (page, m, p) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [m, p]);
async function pinch(page, id) {
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
  await sleep(1000);
  await remote(page, 'set_input_mode', { mode: 'hand' });
  await sleep(400);
  const t = await page.evaluate((id) => __sp.where(id), id);
  await remote(page, 'look_at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
  await sleep(300);
  await remote(page, 'set_select_value', { device: 'hand-right', value: 1 });
  await sleep(250);
  await remote(page, 'set_select_value', { device: 'hand-right', value: 0 });
  await sleep(400);
}

// A. AI available.
{
  const { context, page, asked } = await session(true);
  await enter(page);
  await pinch(page, 'story-dream');
  await page.waitForFunction(() => /^dreamed:/.test(__sp.get('StoryState', 'script')) && __sp.get('StoryState', 'beatId')?.startsWith('dream-'), null, { timeout: 15000 });
  const d = await page.evaluate(() => ({ script: __sp.get('StoryState', 'script'), dream: __sp.view().dream, open: __sp.get('ShadowJournal', 'open') }));
  check('pinching "Dream a new one": a new story, told at once', asked.length === 1 && asked[0].shapes.length >= 2 && d.script === 'dreamed:1' && d.dream.title === 'The Lantern Tide' && d.open === false, { asked: asked[0], ...d });

  // Played by the demo player; reload after the first creature: the next launch carries on in it.
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'dream-1-after', null, { timeout: 120000 });
  // Progress is saved at chapter beats (a dreamed story has one, its title): a reload keeps the dreamed story as tonight's.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && __sp.get('StoryState', 'beatIndex') >= 0, null, { timeout: 30000 });
  await sleep(1500);
  const resumed = await page.evaluate(() => ({ script: __sp.get('StoryState', 'script'), beat: __sp.get('StoryState', 'beatId') }));
  check('after a reload the dreamed story is still tonight\'s story', resumed.script === 'dreamed:1' && resumed.beat.startsWith('dream-'), resumed);

  // Record is refused for a dreamed story, with a reason.
  await pinch(page, 'record-button');
  const rec = await page.evaluate(() => ({ pressed: __sp.presses().includes('record-button'), recording: __sp.get('PerformanceRecorder', 'recording') }));
  check('Record refused for a dreamed story', rec.pressed && rec.recording === false, rec);
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));

  // To the end.
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'dream-end', null, { timeout: 300000 }).catch(() => {});
  check('the dreamed story plays to the end', (await page.evaluate(() => __sp.get('StoryState', 'beatId'))) === 'dream-end', { beat: await page.evaluate(() => __sp.get('StoryState', 'beatId')) });

  // By voice: another.
  await page.evaluate(() => __sp.set('Settings', 'voiceCommands', true));
  await sleep(800);
  await page.evaluate(() => window.__say('dream a new story'));
  await page.waitForFunction(() => __sp.get('StoryState', 'script') === 'dreamed:2', null, { timeout: 15000 }).catch(() => {});
  check('"dream a new story" (voice) dreams another', asked.length === 2 && (await page.evaluate(() => __sp.get('StoryState', 'script'))) === 'dreamed:2', { asked: asked.length });
  await context.close();
}

// B. No AI on this server.
{
  const { context, page, asked } = await session(false);
  await enter(page);
  const before = await page.evaluate(() => __sp.get('StoryState', 'script'));
  await pinch(page, 'story-dream');
  const after = await page.evaluate(() => __sp.get('StoryState', 'script'));
  check('no AI: the button says so; the story is unchanged and nothing is sent', asked.length === 0 && after === before, { before, after });
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
