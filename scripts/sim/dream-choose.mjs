// "Dream a new one" with the parent's choice: the button opens a chooser (a
// place, two or three shapes in story order), all by hand-ray pinch; at most
// three shapes, at least two to dream; the story asks for the chosen shapes in
// the chosen order; Cancel closes it; and by voice, "dream a story about the
// forest with a rabbit and a cup" dreams exactly that.
//
//   node scripts/sim/dream-choose.mjs [--gpu]
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
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
const asked = [];
await context.route('**/api/dream', async (route) => {
  const req = route.request();
  if (req.method() === 'GET') return route.fulfill({ json: { available: true } });
  const body = checkDream(JSON.parse(req.postData() ?? '{}'));
  asked.push(body);
  return route.fulfill({ json: assembleStory(body, cannedWords(body.shapes)) });
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
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const remote = (m, p) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [m, p]);
const chooser = () => page.evaluate(() => __sp.view().dream.chooser);
async function pinch(id) {
  const t = await page.evaluate((id) => __sp.where(id), id);
  await remote('look_at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
  await sleep(300);
  await remote('set_select_value', { device: 'hand-right', value: 1 });
  await sleep(250);
  await remote('set_select_value', { device: 'hand-right', value: 0 });
  await sleep(400);
}
async function openJournal() {
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
  await sleep(1000);
}

await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
await sleep(1500);
await openJournal();
await remote('set_input_mode', { mode: 'hand' });
await sleep(800);
check('the chooser is closed until asked for', (await chooser()).open === false, await chooser());

// 1. Open it: a place and two shapes are already picked.
await pinch('story-dream');
const first = await chooser();
check('"Dream a new one" opens the chooser with a place and two shapes picked', first.open && first.theme && first.shapes.length === 2 && asked.length === 0, first);

// 2. Choose: River; clear the picks, then fish, bird, cup; a fourth is refused; cup off again.
await pinch('dream-theme-river');
for (const s of first.shapes) await pinch(`dream-shape-${s}`);
for (const s of ['fish', 'bird', 'cup', 'dog']) await pinch(`dream-shape-${s}`);
const three = await chooser();
await pinch('dream-shape-cup');
const two = await chooser();
check('a place and shapes in order; never more than three', three.theme === 'river' && three.shapes.join() === 'fish,bird,cup' && two.shapes.join() === 'fish,bird', { three, two });

// 3. Dream it: exactly that, and the story asks for the fish first, then the bird.
await pinch('dream-go');
await page.waitForFunction(() => /^dreamed:/.test(__sp.get('StoryState', 'script')), null, { timeout: 15000 }).catch(() => {});
const story = await page.evaluate(() => ({ script: __sp.get('StoryState', 'script'), chooser: __sp.view().dream.chooser }));
check('Dream it: Mo dreams exactly that, and the chooser closes', asked.length === 1 && asked[0].theme === 'river' && asked[0].shapes.join() === 'fish,bird' && /^dreamed:/.test(story.script) && !story.chooser.open, { asked: asked[0], ...story });

// 4. Fewer than two shapes: no dream; Cancel closes.
await openJournal();
await pinch('story-dream');
const again = await chooser();
await pinch(`dream-shape-${again.shapes[0]}`);
await pinch('dream-go');
const one = await chooser();
await pinch('dream-cancel');
const closed = await chooser();
check('one shape is not enough to dream; Cancel closes the chooser', asked.length === 1 && one.open && one.shapes.length === 1 && !closed.open, { one, closed });
await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));

// 5. By voice.
await page.evaluate(() => __sp.set('Settings', 'voiceCommands', true));
await sleep(800);
await page.evaluate(() => window.__say('Dream a story about the forest with a rabbit and a cup'));
await page.waitForFunction(() => __sp.view().dream.ok >= 2, null, { timeout: 15000 }).catch(() => {});
const last = asked[asked.length - 1];
check('by voice: "dream a story about the forest with a rabbit and a cup"', asked.length === 2 && last.theme === 'forest' && last.shapes.join() === 'rabbit,cup', { asked: last, heard: await page.evaluate(() => __sp.view().voice.heard) });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
