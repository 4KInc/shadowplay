// Hands only, end to end (competition rule: "Can someone complete the entire
// experience without ever pairing a controller?"). In the emulator with hand
// input, no controllers: pinch the journal open, press every headset panel
// button with the hand ray, pinch the lamp switch off and on, pinch-drag the
// lamp along the desk.
//
// Record, Send, Go live and Talk are not pressed here (they would open the
// microphone or a Live room); they are the same panel buttons as the rest.
//
//   node scripts/sim/hands-only.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SKIPPED = new Set(['record-button', 'send-button', 'live-button', 'talk-button']);
// Buttons that close the journal (and with it the panel) go last.
const LAST = ['story-start', 'replace-stage-button', 'replay-button'];

const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
// The chapter buttons are The Moth's (a first launch opens Counting Stars).
await page.evaluate(() => __sp.set('StoryState', 'script', 'story/the-moth.story.json'));
await sleep(1500);

const remote = (method, params) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [method, params]);
const where = (name) => page.evaluate((n) => __sp.where(n), name);
const eye = (await page.evaluate(() => __sp.view())).head[1];
// In front of the chest, clear of the lamp (right) and the journal (left).
const REST = { x: 0.05, y: eye - 0.25, z: -0.3 };

await remote('set_input_mode', { mode: 'hand' });
await sleep(500);
const controllers = await page.evaluate(() => [...(IWER_DEVICE.activeSession?.inputSources ?? [])].filter((s) => !s.hand).length);
check('emulator in hand mode: no controllers connected', controllers === 0, { controllers });

/**
 * Where the pinch point sits relative to the hand once the fingers close
 * (closing moves the index tip), measured once at rest, away from everything.
 */
let pinchOffset = null;
async function measurePinch() {
  await remote('set_transform', { device: 'hand-right', position: REST });
  await sleep(200);
  await remote('set_select_value', { device: 'hand-right', value: 1 });
  await sleep(400);
  const p = await page.evaluate(() => __sp.pinchPoint('right'));
  await remote('set_select_value', { device: 'hand-right', value: 0 });
  await sleep(400);
  pinchOffset = { x: p[0] - REST.x, y: p[1] - REST.y, z: p[2] - REST.z };
}
/** Put the right hand where its closed pinch lands on a world point. */
async function handTo(target) {
  if (!pinchOffset) await measurePinch();
  await remote('set_transform', { device: 'hand-right', position: { x: target.x - pinchOffset.x, y: target.y - pinchOffset.y, z: target.z - pinchOffset.z } });
  await sleep(200);
}
const pinch = async (down) => {
  await remote('set_select_value', { device: 'hand-right', value: down ? 1 : 0 });
  await sleep(400);
};
async function pinchAt(name) {
  const p = await where(name);
  await handTo({ x: p[0], y: p[1], z: p[2] });
  await pinch(true);
  await pinch(false);
  await remote('set_transform', { device: 'hand-right', position: REST });
  await sleep(200);
}
/** Point the right hand's ray at a world point (correcting for where the ray really starts). */
async function aimAt(target) {
  let aim = { ...target };
  for (let i = 0; i < 3; i++) {
    await remote('look_at', { device: 'hand-right', target: aim });
    await sleep(150);
    const { origin, dir } = await page.evaluate(() => __sp.ray('right'));
    const d = Math.hypot(target.x - origin[0], target.y - origin[1], target.z - origin[2]);
    const hit = { x: origin[0] + dir[0] * d, y: origin[1] + dir[1] * d, z: origin[2] + dir[2] * d };
    const miss = Math.hypot(target.x - hit.x, target.y - hit.y, target.z - hit.z);
    if (miss < 0.004) return;
    aim = { x: aim.x + target.x - hit.x, y: aim.y + target.y - hit.y, z: aim.z + target.z - hit.z };
  }
}
const journalOpen = () => page.evaluate(() => __sp.get('ShadowJournal', 'open'));
async function openJournal() {
  if (await journalOpen()) return true;
  // After "Move stage here" or Replay the stage (and the journal with it) is being placed again.
  await page.waitForFunction(() => window.__sp.view().ready, null, { timeout: 15000 });
  await sleep(300);
  await pinchAt('journal-cover-top');
  await sleep(600);
  return journalOpen();
}

// 1. The journal opens with a direct pinch (Settings appears beside it).
check('pinch the Shadow Journal: it opens', await openJournal());

// 2. Every panel button by the hand ray.
const all = [
  'inbox-button', 'duet-button', 'story-prev', 'story-next',
  'tol-strict', 'tol-normal', 'tol-forgiving', 'tol-very-forgiving',
  'hint-off', 'hint-delayed', 'hint-always', 'one-hand-toggle', 'voice-toggle',
  'chap-prologue', 'chap-ch1', 'chap-ch2', 'chap-ch3', 'chap-ch4', 'chap-ch5',
  ...LAST,
];
let pressed = 0;
const missed = [];
const nudged = [];
for (const id of all) {
  if (SKIPPED.has(id)) continue;
  if (!(await openJournal())) {
    missed.push(`${id} (journal would not open)`);
    continue;
  }
  await sleep(400);
  const target = await where(id);
  if (!target) {
    missed.push(`${id} (not on the panel)`);
    continue;
  }
  // Aim at the centre; if the emulated ray lands in a gap, nudge it a little.
  let ok = false;
  let hit = '';
  for (const [dx, dy] of [[0, 0], [0, 0.015], [0, -0.015], [0.02, 0], [-0.02, 0]]) {
    if (!(await journalOpen()) && !(await openJournal())) break;
    const t = await where(id);
    const before = (await page.evaluate(() => __sp.presses())).length;
    await remote('set_transform', { device: 'hand-right', position: REST });
    await aimAt({ x: t[0] + dx, y: t[1] + dy, z: t[2] });
    await remote('select', { device: 'hand-right', duration: 0.12 });
    await sleep(400);
    const after = await page.evaluate(() => __sp.presses());
    if (after.length > before) {
      hit = after.at(-1);
      ok = hit === id;
      if (dx || dy) nudged.push(id);
      break;
    }
  }
  if (ok) pressed++;
  else missed.push(hit ? `${id} (hit ${hit})` : id);
}
check(`every headset panel button presses by hand ray (${pressed} pressed; Record, Send, Go live, Talk skipped: microphone)`, missed.length === 0, { missed, nudged });
// The tolerance, hint and one-hand buttons took effect.
const settings = await page.evaluate(() => ({ tolerance: __sp.get('Settings', 'tolerance'), hints: __sp.get('Settings', 'hints') }));
check('panel presses took effect (last tolerance and hint choices)', settings.tolerance === 'very-forgiving' && settings.hints === 'always', settings);
await page.waitForFunction(() => window.__sp.view().ready, null, { timeout: 15000 });
await sleep(1000);

// 3. Lamp switch: pinch it off, then on.
{
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));
  await sleep(300);
  const before = await page.evaluate(() => __sp.get('Stage', 'lampOn'));
  await pinchAt('lamp-switch');
  await sleep(300);
  const off = await page.evaluate(() => __sp.get('Stage', 'lampOn'));
  await pinchAt('lamp-switch');
  await sleep(300);
  const on = await page.evaluate(() => __sp.get('Stage', 'lampOn'));
  check('pinch the lamp switch: off, then on again', before === true && off === false && on === true, { before, off, on });
}

// 4. Lamp drag: pinch the lamp head, slide 15 cm, let go.
{
  const start = await where('lamp-head');
  await handTo({ x: start[0], y: start[1], z: start[2] });
  await pinch(true);
  const held = (await page.evaluate(() => __sp.get('DeskLamp', 'heldBy'))) === 'right';
  const p = await page.evaluate(() => __sp.pinchPoint('right'));
  for (let i = 1; i <= 5; i++) {
    await remote('set_transform', { device: 'hand-right', position: { x: p[0] + 0.03 * i, y: p[1], z: p[2] } });
    await sleep(80);
  }
  await pinch(false);
  const end = await where('lamp-head');
  const moved = Math.hypot(end[0] - start[0], end[2] - start[2]);
  check('pinch and drag the lamp along the desk', held && moved > 0.08, { moved: +moved.toFixed(3) });
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
