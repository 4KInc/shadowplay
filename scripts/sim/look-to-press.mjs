// Look to press (head-gaze dwell), with controllers in hand and no hand tracking:
// the first-screen toggle, opening the Shadow Journal by looking at it, pressing a
// Settings button by looking (once, no repeats), the ghost hand shown at once and
// looking at it waking the creature, and the story never pausing for "put your
// controllers down", the whole story told eyes only. Then the mode is turned off by looking at its own toggle.
//
//   node scripts/sim/look-to-press.mjs [--gpu]
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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const view = () => page.evaluate(() => __sp.view());
const get = (c, f) => page.evaluate(([c, f]) => __sp.get(c, f), [c, f]);
const remote = (m, p) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [m, p]);
/** Turn the emulated head toward a named object (or a point). */
async function lookAt(name) {
  const p = typeof name === 'string' ? await page.evaluate((n) => __sp.where(n), name) : name;
  if (!p) throw new Error(`nothing named ${name}`);
  await remote('look_at', { device: 'headset', target: { x: p[0], y: p[1], z: p[2] } });
}

await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });

// 1. First screen.
{
  const b = page.getByRole('button', { name: 'Look to press' });
  await b.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => __sp.get('Settings', 'tolerance') !== undefined, null, { timeout: 15000 });
  await sleep(1000);
  await b.click();
  await sleep(1000);
  const pressed = await b.getAttribute('aria-pressed');
  const on = await get('Settings', 'gazeDwell');
  check('first screen: Look to press toggle', pressed === 'true' && on === true, { pressed, on });
}

// 2. Into the headset holding controllers (no hands seen).
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().head[1] > 1 && window.__sp.view().ready, null, { timeout: 30000 });
await remote('set_input_mode', { mode: 'controller' });
await sleep(2000);

// 3. Look at the book: the ring fills, then the journal opens.
{
  await lookAt('journal-cover-top');
  await sleep(600);
  const mid = (await view()).gaze;
  await sleep(1400);
  const open = await get('ShadowJournal', 'open');
  check('looking at the Shadow Journal opens it (ring filling first)', mid.target === 'journal' && mid.progress > 0.1 && mid.progress < 1 && open === true, { mid, open });
}

// 4. Look at a Settings button: pressed once, not again while still looked at.
{
  await sleep(800);
  await lookAt('tol-forgiving');
  await sleep(2000);
  const tol = await get('Settings', 'tolerance');
  const presses = (await page.evaluate(() => __sp.presses())).filter((p) => p === 'tol-forgiving').length;
  await sleep(2500);
  const again = (await page.evaluate(() => __sp.presses())).filter((p) => p === 'tol-forgiving').length;
  check('looking at "Forgiving" presses it once', tol === 'forgiving' && presses === 1 && again === 1, { tol, presses, again });
}

// 5. Close the book by looking; the story goes on although only controllers are held.
{
  await lookAt('journal-cover-top');
  await sleep(2200);
  await lookAt([0, 1.6, -2]);
  await sleep(3000);
  const s = { open: await get('ShadowJournal', 'open'), status: await get('StoryState', 'status'), caption: await get('StoryState', 'caption') };
  check('journal closed by looking; story plays with controllers in hand', s.open === false && s.status !== 'paused' && !/controllers down/.test(s.caption), s);
}

// 6. The first shape request: the ghost hand shows at once; looking at it wakes the creature.
{
  await page.waitForFunction(() => __sp.get('StoryState', 'hintVisible'), null, { timeout: 60000 });
  const beat = await get('StoryState', 'beatId');
  const shape = await get('StoryState', 'hintShape');
  await lookAt('show-me-hint');
  await page.waitForFunction((b) => __sp.get('StoryState', 'beatId') !== b, beat, { timeout: 8000 }).catch(() => {});
  const after = await get('StoryState', 'beatId');
  const g = (await view()).gaze;
  check('looking at the ghost hand makes the shape: the creature wakes, the story moves on', after !== beat && g.shapes >= 1, { beat, shape, after, shapes: g.shapes });
}

// 6b. The rest of Counting Stars, eyes only: the ghost hand when a shape is asked for, the stage otherwise.
{
  const t0 = Date.now();
  let shapes = 0;
  while (Date.now() - t0 < 360000) {
    const s = await page.evaluate(() => ({ beat: __sp.get('StoryState', 'beatId'), hint: __sp.get('StoryState', 'hintVisible'), status: __sp.get('StoryState', 'status') }));
    if (s.beat === 'stars-end' || s.status === 'ended') break;
    await lookAt(s.hint ? 'show-me-hint' : [0, 1.62, -2]);
    await sleep(500);
  }
  const g = (await view()).gaze;
  shapes = g.shapes;
  const beat = await get('StoryState', 'beatId');
  check('Counting Stars told to the end without hands', beat === 'stars-end', { beat, shapesByGaze: shapes, minutes: +((Date.now() - t0) / 60000).toFixed(1) });
}

// 7. Turn the mode off by looking at its own toggle: the reticle goes.
{
  await lookAt('journal-cover-top');
  await sleep(2200);
  await sleep(800);
  await lookAt('gaze-toggle');
  await sleep(2200);
  const on = await get('Settings', 'gazeDwell');
  const reticle = await page.evaluate(() => __sp.where('gaze-reticle') !== null && window.__sp.view().gaze.on);
  check('Look to press turned off by looking at its toggle', on === false && reticle === false, { on, reticle });
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
