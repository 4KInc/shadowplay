// High-contrast mode: the first-screen toggle (remembered), then in the headset
// solid shadows on the wall, and the Settings toggle pressed by hand ray turns it
// off and on again. Saves one screenshot of the panel and caption in high contrast.
//
//   node scripts/sim/high-contrast.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `high-contrast-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
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
const remote = (m, p) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [m, p]);

await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });

// 1. First screen: one tap, remembered after a reload.
{
  const button = page.getByRole('button', { name: 'High contrast' });
  await button.waitFor({ state: 'visible', timeout: 15000 });
  await button.click();
  await sleep(500);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  const pressed = await page.getByRole('button', { name: 'High contrast' }).getAttribute('aria-pressed');
  const on = await page.evaluate(() => __sp.get('Settings', 'highContrast'));
  check('first screen: High contrast toggle applied and remembered', pressed === 'true' && on === true, { pressed, on });
}

// 2. In the headset: solid shadows on the wall.
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().head[1] > 1 && window.__sp.view().ready, null, { timeout: 30000 });
await sleep(2500);
{
  const v = await view();
  check('in XR: high contrast on, wall shadows solid', v.highContrast && v.shadowOpacity === 1, { highContrast: v.highContrast, shadowOpacity: v.shadowOpacity });
}

/** Pinch a Settings button with the right hand's ray (held in real time, see rooms.mjs). */
async function pinch(id) {
  const target = await page.evaluate((id) => __sp.where(id), id);
  await remote('look_at', { device: 'hand-right', target: { x: target[0], y: target[1], z: target[2] } });
  await sleep(300);
  await remote('set_select_value', { device: 'hand-right', value: 1 });
  await sleep(250);
  await remote('set_select_value', { device: 'hand-right', value: 0 });
  await sleep(400);
}

// 3. The Settings toggle, by hand: off, then on again.
await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
await sleep(1000);
await remote('set_input_mode', { mode: 'hand' });
await sleep(500);
{
  await pinch('contrast-toggle');
  const off = await view();
  await pinch('contrast-toggle');
  const on = await view();
  const presses = await page.evaluate(() => __sp.presses().filter((p) => p === 'contrast-toggle').length);
  check('Settings toggle by hand ray: off then on', presses === 2 && !off.highContrast && Math.abs(off.shadowOpacity - 0.85) < 1e-6 && on.highContrast && on.shadowOpacity === 1, {
    presses,
    off: [off.highContrast, off.shadowOpacity],
    on: [on.highContrast, on.shadowOpacity],
  });
}

// 4. Preserved: one-hand mode still toggles by hand beside it.
{
  const before = await page.evaluate(() => __sp.get('Settings', 'oneHand'));
  await pinch('one-hand-toggle');
  const after = await page.evaluate(() => __sp.get('Settings', 'oneHand'));
  check('one-hand toggle beside it still works', after === !before, { before, after });
  await pinch('one-hand-toggle');
}

// 5. One picture: panel and caption in high contrast.
await page.evaluate(() => __sp.set('StoryState', 'caption', 'Make a rabbit with your hand, and hold it still.'));
await sleep(1200);
await page.screenshot({ path: join(OUT, 'high-contrast.png') });
console.log(`screenshot: ${join(OUT, 'high-contrast.png')}`);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
