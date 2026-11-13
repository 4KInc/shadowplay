// The stage's room anchor: the stage is anchored when placed on a wall, follows
// the anchor when tracking shifts it, comes back to the same wall on the next
// launch (even before the room is scanned), moves with "Move stage here", is
// not restored when the remembered wall is off to the side, and without anchor
// support everything still works as before.
//
//   node scripts/sim/wall-anchor.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082. Uses the
// emulator's anchors (IWER keeps persistent anchors in localStorage across reloads).
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A vertical wall facing back along `normal`, centred `dist` m from a player at the origin. */
function wall({ dist = 2, width = 4, eye = 1.6, dir = [0, -1] } = {}) {
  const [dx, dz] = dir;
  const center = { x: dx * dist, y: eye - 0.2, z: dz * dist };
  const right = { x: -dz, z: dx };
  const corners = [-1, 1, 1, -1].map((u, i) => ({
    x: center.x + (right.x * u * width) / 2,
    y: center.y - 1.3 + (i >= 2 ? 2.6 : 0),
    z: center.z + (right.z * u * width) / 2,
  }));
  return { orientation: 'vertical', label: 'wall', point: center, normal: { x: -dx, y: 0, z: -dz }, corners };
}

const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const view = () => page.evaluate(() => __sp.view());
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Load (or reload) the page, show it these planes, enter XR, and wait for the stage. */
async function launch(planes, before = () => {}) {
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.evaluate((p) => __sp.room(p), planes);
  await before();
  const t0 = Date.now();
  await page.getByRole('button', { name: /Enter XR/i }).click();
  // The 2D page's stage is 'ready' before the session starts: wait for the XR placement and its anchor.
  await page.waitForFunction(
    () => {
      const v = window.IWER_DEVICE?.activeSession && window.__sp.view();
      return v && v.ready && v.mode !== 'pending' && v.anchor && v.anchor !== 'pending';
    },
    null,
    { timeout: 30000 },
  );
  const seconds = (Date.now() - t0) / 1000;
  await sleep(300);
  return { seconds: +seconds.toFixed(1), v: await view() };
}

/** "Move stage here" with these planes, then wait for the new stage and its anchor. */
async function place(planes) {
  await page.evaluate((p) => {
    __sp.room(p);
    __sp.set('Stage', 'replaceRequested', true);
  }, planes);
  await sleep(300);
  await page.waitForFunction(() => window.__sp.view().ready, null, { timeout: 15000 });
  await page.waitForFunction(() => ['saved', 'live', 'failed', 'unsupported'].includes(window.__sp.view().anchor), null, { timeout: 5000 }).catch(() => {});
  return view();
}

// 1. A wall 2 m ahead: the stage is anchored and remembered.
let eye;
let saved;
{
  const { v } = await launch(null);
  eye = v.head[1];
  saved = await place([wall({ eye })]);
  const stored = await page.evaluate(() => localStorage.getItem('shadowplay.stage-anchor'));
  check('wall stage: anchored and remembered for next time', saved.mode === 'wall' && saved.anchor === 'saved' && !!stored, { mode: saved.mode, anchor: saved.anchor, center: saved.center });
}

// 2. Tracking shifts the stage 12 cm: it goes back onto its anchor.
{
  await page.evaluate(() => __sp.nudgeStage(0.12));
  await sleep(400);
  const v = await view();
  const off = dist2(v.center, saved.center);
  check('tracking shift: stage follows its anchor back (within 1 cm)', off < 0.01 && v.anchorFixes >= 1, { offCm: +(off * 100).toFixed(1), fixes: v.anchorFixes });
  await sleep(1500);
  const still = await view();
  check('no further corrections once back in place', still.anchorFixes === v.anchorFixes, { fixes: still.anchorFixes });
}

// 3. Next launch, before any room data: the stage is back on the same wall.
{
  const { seconds, v } = await launch([]);
  const off = dist2(v.center, saved.center);
  check('next launch: stage back on last time\'s wall without a room scan', v.mode === 'wall' && v.anchorLastTime && off < 0.02, {
    mode: v.mode,
    anchor: v.anchor,
    lastTime: v.anchorLastTime,
    offCm: +(off * 100).toFixed(1),
    readyAfterS: seconds,
  });
  await page.waitForFunction(() => window.__sp.view().anchor === 'saved', null, { timeout: 5000 }).catch(() => {});
  check('restored stage is anchored and remembered again', (await view()).anchor === 'saved', {});
}

// 4. "Move stage here" to a wall 2.5 m away: that is what the next launch brings back.
{
  const moved = await place([wall({ eye, dist: 2.5 })]);
  const { v } = await launch([]);
  check('after "Move stage here", the next launch restores the new spot', moved.anchor === 'saved' && v.anchorLastTime && Math.abs(v.distance - 2.5) < 0.03, {
    movedDistance: +(+moved.distance).toFixed(2),
    restoredDistance: +(+v.distance).toFixed(2),
  });
}

// 5. The remembered wall is 90 degrees to the left of where the player now faces: scan instead.
{
  await page.evaluate(
    (y) => IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x: -2, y, z: 0 } }),
    eye,
  );
  await sleep(500);
  await place([wall({ eye, dir: [-1, 0] })]);
  const { v } = await launch([]);
  check('remembered wall off to the side: not restored, the usual scan places the stage', !v.anchorLastTime && v.mode === 'screen', { mode: v.mode, lastTime: v.anchorLastTime, anchor: v.anchor });
}

// 6. A browser without anchors: placement works exactly as before.
{
  const { v } = await launch([wall({ eye })], () => page.evaluate(() => __sp.noAnchors(true)));
  check('no anchor support: wall placement unchanged, anchor reported unsupported', v.mode === 'wall' && v.anchor === 'unsupported' && Math.abs(v.distance - 2) < 0.02, {
    mode: v.mode,
    anchor: v.anchor,
    distance: +(+v.distance).toFixed(2),
  });
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
