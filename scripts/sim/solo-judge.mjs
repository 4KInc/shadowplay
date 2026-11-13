// The solo-judge path: one person, one headset, no second device, no setup.
//   Headset: Mia's goodnight is waiting and plays on the wall; tell a story, record
//   it (voice off here: no microphone in tests) and send it: a family code comes back.
//   Viewer (another browser, as on a phone or the Quest Browser in 2D): the sample
//   story from Dad is listed and plays; the code just sent opens and plays too.
//
//   node scripts/sim/solo-judge.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082 and port 8787 free
// (this script runs the API server there for the sharing step).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

const server = spawn(process.execPath, ['server/main.ts'], {
  env: { ...process.env, PORT: '8787', DATA_DIR: mkdtempSync(join(tmpdir(), 'sp-solo-')) },
  stdio: 'ignore',
});
await sleep(1000);
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
try {
  // ---- The headset.
  const hs = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  await hs.goto(APP + '/', { waitUntil: 'load' });
  await hs.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await hs.getByRole('button', { name: /Enter XR/i }).click();
  await hs.waitForFunction(() => window.__sp.view().ready && window.__sp.get('DemoDirector', 'status') !== undefined, null, { timeout: 30000 });
  await hs.waitForFunction(() => __sp.get('FamilyInbox', 'unwatched') > 0, null, { timeout: 30000 }).catch(() => undefined);
  const waiting = await hs.evaluate(() => __sp.get('FamilyInbox', 'unwatched'));
  await hs.evaluate(() => __sp.set('FamilyInbox', 'playRequested', true));
  const played = await hs.waitForFunction(() => __sp.get('PerformancePlayer', 'playing'), null, { timeout: 15000 }).then(() => true, () => false);
  const id = await hs.evaluate(() => __sp.get('PerformancePlayer', 'recordingId'));
  await hs.waitForFunction(() => !__sp.get('PerformancePlayer', 'playing'), null, { timeout: 40000 }).catch(() => undefined);
  check("headset: Mia's goodnight is waiting and plays on the wall", waiting > 0 && played && /mia/.test(id), { waiting, played, id });

  await hs.evaluate(() => {
    __sp.set('PerformanceRecorder', 'withVoice', false);
    __sp.set('PerformanceRecorder', 'recording', true);
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  await sleep(15000);
  await hs.evaluate(() => {
    __sp.set('PerformanceRecorder', 'recording', false);
    __sp.set('DemoDirector', 'playing', false);
  });
  await hs.waitForFunction(() => __sp.get('PerformanceRecorder', 'lastId'), null, { timeout: 15000 });
  await hs.evaluate(() => __sp.set('PerformanceRecorder', 'shareRequested', true));
  await hs.waitForFunction(() => /^Sent!|^Could not/.test(__sp.get('PerformanceRecorder', 'status') ?? ''), null, { timeout: 20000 }).catch(() => undefined);
  const status = await hs.evaluate(() => __sp.get('PerformanceRecorder', 'status'));
  const code = status.match(/Family code: (\S+)/)?.[1] ?? '';
  check('headset: tell a story, record it, send it: a family code comes back', /^[a-z]+-[a-z]+-[a-z]+-\d+$/.test(code), { status });

  // ---- The viewer, as another device (its own storage).
  const v = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  await v.goto(APP + '/?viewer', { waitUntil: 'load' });
  const card = v.getByRole('button', { name: /Watch A story from far away from Dad/ }).first();
  const listed = await card.waitFor({ timeout: 30000 }).then(() => true, () => false);
  if (listed) await card.click();
  const dad = await v.waitForFunction(() => __sp.get('PerformancePlayer', 'position') > 3, null, { timeout: 30000 }).then(() => true, () => false);
  check('viewer: the sample story from Dad is listed and plays', listed && dad);
  await v.evaluate(() => __sp.set('PerformancePlayer', 'playing', false));
  await sleep(500);

  if (code) {
    await v.getByRole('textbox', { name: 'Family code' }).fill(code);
    await v.getByRole('button', { name: 'Open' }).click();
    // The story arrives at the top of the list ("... is here. Tap it to watch."); tap it.
    const note = await v.waitForFunction(() => /is here/.test(document.querySelector('.sp-note')?.textContent ?? ''), null, { timeout: 20000 })
      .then(() => v.evaluate(() => document.querySelector('.sp-note').textContent), () => '');
    await v.locator('.sp-card').first().click();
    const opened = await v.waitForFunction(() => __sp.get('PerformancePlayer', 'playing') && __sp.get('PerformancePlayer', 'position') > 2, null, { timeout: 30000 }).then(() => true, () => false);
    check('viewer: the story just sent opens by its code and plays', Boolean(note) && opened, { code, note });
  } else check('viewer: the story just sent opens by its code and plays', false, { reason: 'no code' });
} finally {
  await browser.close();
  server.kill();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
if (results.some((r) => !r)) process.exitCode = 1;
