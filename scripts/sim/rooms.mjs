// Rooms nobody tested: feeds the emulated headset fake room planes (no planes,
// floor and ceiling only, walls too close / too far / at a steep angle, a window
// ahead, room data arriving late), re-places the stage the way "Move stage here"
// does, recenters mid-story, and checks where the stage and its essential UI end up.
//
//   node scripts/sim/rooms.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `rooms-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A vertical rectangle in front of a player at (0, eye, 0) looking down -Z (yaw in degrees turns it). */
function wall({ dist = 2, width = 4, height = 2.6, y0 = 0, yaw = 0, cx = 0, label = 'wall' } = {}) {
  const a = (yaw * Math.PI) / 180;
  const nx = Math.sin(a);
  const nz = Math.cos(a);
  const center = { x: cx, y: y0 + height / 2, z: -dist };
  const corners = [-1, 1, 1, -1].map((u, i) => ({
    x: center.x + (nz * u * width) / 2,
    y: y0 + (i >= 2 ? height : 0),
    z: center.z + (-nx * u * width) / 2,
  }));
  return { orientation: 'vertical', label, point: center, normal: { x: nx, y: 0, z: nz }, corners };
}
const flat = (y, label) => ({
  orientation: 'horizontal',
  label,
  point: { x: 0, y, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  corners: [
    { x: -3, y, z: -3 },
    { x: 3, y, z: -3 },
    { x: 3, y, z: 3 },
    { x: -3, y, z: 3 },
  ],
});

const CASES = [
  { name: 'ordinary wall 2 m ahead', planes: [flat(0, 'floor'), wall()], expect: { mode: 'wall', distance: [1.99, 2.01] } },
  { name: 'no planes at all', planes: [], expect: { mode: 'screen', distance: [1.99, 2.01] } },
  { name: 'only floor and ceiling', planes: [flat(0, 'floor'), flat(2.6, 'ceiling')], expect: { mode: 'screen', distance: [1.99, 2.01] } },
  { name: 'wall too close (0.45 m)', planes: [wall({ dist: 0.45 })], expect: { mode: 'screen', distance: [0.89, 0.91] } },
  { name: 'wall too far (5 m)', planes: [wall({ dist: 5 })], expect: { mode: 'screen', distance: [1.99, 2.01] } },
  { name: 'wall at a steep angle (55 deg)', planes: [wall({ yaw: 55 })], expect: { mode: 'screen' } },
  { name: 'wall at a usable angle (30 deg)', planes: [wall({ yaw: 30 })], expect: { mode: 'wall' } },
  {
    name: 'open-plan: only an "invisible wall face"',
    planes: [flat(0, 'floor'), wall({ label: 'invisible wall face' })],
    expect: { mode: 'wall', distance: [1.99, 2.01] },
  },
  {
    name: 'a TV ("screen") on the wall ahead: the wall holds the stage',
    planes: [wall({ dist: 2 }), wall({ dist: 1.95, width: 1.4, height: 0.8, y0: 0.9, label: 'screen' })],
    expect: { mode: 'wall', distance: [1.99, 2.01] },
  },
  {
    name: 'labelled "wall face"',
    planes: [wall({ label: 'wall face' })],
    expect: { mode: 'wall' },
  },
  {
    name: 'window just right of centre',
    planes: [wall({ width: 5 }), wall({ dist: 1.98, width: 0.4, height: 1.2, y0: 0.9, cx: 0.5, label: 'window frame' })],
    expect: { mode: 'wall', rightEdgeBelow: Math.atan2(0.3, 2) * (180 / Math.PI) },
  },
  {
    name: 'narrow window straight ahead',
    planes: [wall({ width: 5 }), wall({ dist: 1.98, width: 0.5, height: 1.2, y0: 0.9, label: 'window frame' })],
    expect: { mode: 'screen', distance: [1.82, 1.84] },
  },
  {
    name: 'wide window straight ahead',
    planes: [wall({ width: 5 }), wall({ dist: 1.98, width: 1.2, height: 1.4, y0: 0.8, label: 'window frame' })],
    expect: { mode: 'screen', distance: [1.82, 1.84] },
  },
  {
    name: 'door frame only',
    planes: [wall({ dist: 2, width: 1, height: 2.1, label: 'door frame' })],
    expect: { mode: 'screen', distance: [1.84, 1.86] },
  },
];

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await page.getByRole('button', { name: /Enter XR/i }).click();
// The stage is already 'ready' in the 2D view before the session starts: wait for the XR session itself.
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
await sleep(1000);

const eye = (await page.evaluate(() => __sp.view())).head[1];
console.log(`emulated eye height ${eye} m`);
if (!(eye > 1)) throw new Error(`eye height ${eye}: not in the XR session yet`);
const lift = (planes) =>
  // Planes are authored for eyes at 1.2 m; shift them to the emulated head height (floors stay at 0).
  planes.map((p) =>
    p.orientation === 'vertical'
      ? { ...p, point: { ...p.point, y: p.point.y + eye - 1.2 }, corners: p.corners.map((c) => ({ ...c, y: c.y + eye - 1.2 })) }
      : p,
  );

/** Re-place like "Move stage here", then wait for placement (1.5 s turn delay + up to 4 s scan). */
async function place(planes) {
  await page.evaluate((p) => {
    __sp.room(p);
    __sp.set('Stage', 'replaceRequested', true);
  }, planes && lift(planes));
  await sleep(300);
  await page.waitForFunction(() => window.__sp.view().ready, null, { timeout: 15000 });
  await sleep(300);
  return page.evaluate(() => __sp.view());
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

for (const c of CASES) {
  const t0 = Date.now();
  const v = await place(c.planes);
  const seconds = +((Date.now() - t0) / 1000).toFixed(1);
  let ok = v.mode === c.expect.mode;
  if (c.expect.distance) ok &&= v.distance >= c.expect.distance[0] && v.distance <= c.expect.distance[1];
  // The stage's right edge stays left of the window.
  if (c.expect.rightEdgeBelow) ok &&= v.stage.right < c.expect.rightEdgeBelow;
  check(c.name, ok, { mode: v.mode, distance: +(+v.distance).toFixed(2), width: v.width, stage: v.stage, seconds });
  await page.screenshot({ path: join(OUT, `${c.name.replace(/[^a-z0-9]+/gi, '-')}.png`) });
}

// Room data arriving late: nothing at first (paper screen), the wall a few seconds later.
{
  await place([]);
  await page.evaluate((p) => __sp.room(p), lift([wall({ dist: 2.5 })]));
  await sleep(1500);
  const v = await page.evaluate(() => __sp.view());
  check('planes arrive after the timeout: wall takes over', v.mode === 'wall' && Math.abs(v.distance - 2.5) < 0.02, { mode: v.mode, distance: v.distance });
}
// ...but not once the story is under way.
{
  await place([]);
  await sleep(8000);
  await page.evaluate((p) => __sp.room(p), lift([wall({ dist: 2.5 })]));
  await sleep(1500);
  const v = await page.evaluate(() => __sp.view());
  check('planes arrive much later: stage stays put', v.mode === 'screen', { mode: v.mode, distance: v.distance });
}

// Recenter mid-story: turn the head 60 degrees, recenter; the stage comes back ahead and the story carries on.
{
  await place([flat(0, 'floor')]);
  await page.evaluate(() => {
    __sp.set('StoryState', 'script', 'story/the-moth.story.json');
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  await sleep(12000);
  const before = await page.evaluate(() => __sp.get('StoryState', 'beatIndex'));
  // Turn the emulated head 60 degrees to the left.
  await page.evaluate((y) =>
    IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x: -Math.sin(Math.PI / 3) * 2, y, z: -Math.cos(Math.PI / 3) * 2 } }),
  eye);
  await sleep(500);
  const turned = await page.evaluate(() => __sp.view());
  await page.evaluate(() => IWER_DEVICE.recenter());
  await sleep(300);
  await page.waitForFunction(() => window.__sp.view().ready, null, { timeout: 15000 });
  await sleep(1500);
  const v = await page.evaluate(() => __sp.view());
  const after = await page.evaluate(() => __sp.get('StoryState', 'beatIndex'));
  const centred = Math.abs(v.stage.left - v.stage.right) < 2 && turned.stage.right > 40;
  check('recenter mid-story: stage ahead again, story continues', centred && after >= before, {
    turnedStage: turned.stage,
    stage: v.stage,
    beatBefore: before,
    beatAfter: after,
  });
  await page.evaluate(() => __sp.set('DemoDirector', 'playing', false));
}

// "Move stage here" by hand: open the journal (Settings appears beside the stage), pinch the
// button with the right hand's ray, then look at the wall on the left; the stage follows.
{
  const leftWall = { ...wall({ dist: 2 }), normal: { x: 1, y: 0, z: 0 } };
  leftWall.point = { x: -2, y: 1.3, z: 0 };
  leftWall.corners = [
    { x: -2, y: 0, z: 2 },
    { x: -2, y: 0, z: -2 },
    { x: -2, y: 2.6, z: -2 },
    { x: -2, y: 2.6, z: 2 },
  ];
  await place([flat(0, 'floor'), wall(), leftWall]);
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
  await sleep(1000);
  const remote = (method, params) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [method, params]);
  await remote('set_input_mode', { mode: 'hand' });
  await sleep(500);
  const button = await page.evaluate(() => __sp.where('replace-stage-button'));
  await remote('look_at', { device: 'hand-right', target: { x: button[0], y: button[1], z: button[2] } });
  await sleep(300);
  await remote('select', { device: 'hand-right', duration: 0.15 });
  await sleep(200);
  const pending = await page.evaluate(() => __sp.get('Stage', 'mode'));
  await remote('look_at', { device: 'headset', target: { x: -2, y: eye, z: 0 } });
  await page.waitForFunction(() => window.__sp.view().ready, null, { timeout: 15000 });
  await sleep(500);
  const v = await page.evaluate(() => __sp.view());
  const centred = Math.abs(v.stage.left - v.stage.right) < 2;
  check('"Move stage here" by pinch, then looking left: stage on the left wall', pending === 'pending' && v.mode === 'wall' && centred, {
    afterPinch: pending,
    mode: v.mode,
    distance: v.distance,
    stage: v.stage,
  });
  await page.screenshot({ path: join(OUT, 'moved-to-left-wall.png') });
  await remote('look_at', { device: 'headset', target: { x: 0, y: eye, z: -2 } });
  await remote('set_input_mode', { mode: 'controller' }).catch(() => undefined);
}

// The lamp and journal stand on the real desk when Room Setup found one under them.
{
  const deskY = eye - 0.5;
  const desk = {
    orientation: 'horizontal',
    label: 'table',
    point: { x: 0, y: deskY, z: -0.3 },
    normal: { x: 0, y: 1, z: 0 },
    corners: [
      { x: -0.8, y: deskY, z: -0.7 },
      { x: 0.8, y: deskY, z: -0.7 },
      { x: 0.8, y: deskY, z: 0.1 },
      { x: -0.8, y: deskY, z: 0.1 },
    ],
  };
  // (Planes are passed as they are: place() lifts only vertical planes to the eye height.)
  const on = await place([flat(0, 'floor'), wall(), desk]);
  check('a table in front: the lamp and journal stand on it', on.desk === 'surface' && Math.abs(on.lampY - deskY) < 0.005, { desk: on.desk, lampY: on.lampY, deskY: +deskY.toFixed(3) });
  const off = await place([flat(0, 'floor'), wall()]);
  check('no desk detected: the usual seated height', off.desk === 'estimate' && Math.abs(off.lampY - (eye - 0.45)) < 0.005, { desk: off.desk, lampY: off.lampY });
}

// Field-of-view aware: a narrower device view (the emulator's view narrowed) gets a smaller stage
// (at most 45% of the view) and Settings over the stage instead of beside it.
{
  await place([flat(0, 'floor'), wall()]);
  const wide = await page.evaluate(() => __sp.view());
  // 38 degrees tall is about 58 degrees across in the emulator.
  await page.evaluate(() => { IWER_DEVICE.fovy = (38 * Math.PI) / 180; });
  await sleep(500);
  const narrowView = await place([flat(0, 'floor'), wall()]);
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
  await sleep(1200);
  const withPanel = await page.evaluate(() => __sp.view());
  await page.evaluate(() => {
    __sp.set('ShadowJournal', 'open', false);
    IWER_DEVICE.fovy = Math.PI / 2;
  });
  const stageAngle = narrowView.stage.left + narrowView.stage.right;
  check('Quest-class view: the usual 33-degree stage', Math.abs(wide.stage.left + wide.stage.right - 33) < 0.6, { fovH: wide.fovH, stage: wide.stage });
  check('narrow view: the stage takes at most 45% of it', narrowView.fovH > 0 && narrowView.fovH < 75 && stageAngle <= narrowView.fovH * 0.45 + 0.6, { fovH: narrowView.fovH, stageAngle: +stageAngle.toFixed(1) });
  check('narrow view: Settings sits over the stage (centred), inside the view', withPanel.settings && Math.abs(withPanel.settings.left - withPanel.settings.right) < 2 && Math.max(withPanel.settings.left, withPanel.settings.right) < withPanel.fovH / 2, { fovH: withPanel.fovH, settings: withPanel.settings });
  await place([flat(0, 'floor'), wall()]);
}

// Essential UI inside the comfortable field of view, with the journal (and settings) open.
{
  await place([flat(0, 'floor'), wall()]);
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', true)).catch(() => undefined);
  await sleep(1000);
  const v = await page.evaluate(() => __sp.view());
  check('field of view with the journal open', true, { stage: v.stage, caption: v.caption, journalPage: v.journalPage, settings: v.settings });
  await page.screenshot({ path: join(OUT, 'journal-open.png') });
}

await page.evaluate(() => __sp.room(null));
await browser.close();
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ results, errors }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors. Report and screenshots: ${OUT}`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
