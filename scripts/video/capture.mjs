// Submission video, step 1: capture synchronized footage from the running app (dev server)
// with headless Chrome on the GPU. Three views play the bundled sample story from Dad:
//   wall:     the stage as Dad sees it (browser rendering of the same stage, no emulator UI)
//   emulator: the emulated Quest view (for an establishing shot; cropped in assembly)
//   phone:    the family viewer on a tablet, opened from a real family code
// then the phone's goodnight card and "Send a goodnight back", and Mia's goodnight on the wall.
// Frames (JPEG) and timing go to node_modules/.cache/shadowplay-video/. Step 2: assemble.py.
//   node scripts/video/capture.mjs     (dev server running; starts its own API server on :8787)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const APP = 'https://localhost:8082';
const OUT = join(process.cwd(), 'node_modules/.cache/shadowplay-video');
rmSync(OUT, { recursive: true, force: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, PORT: '8787', DATA_DIR: join(OUT, 'stories') }, stdio: 'ignore' });
await sleep(800);
// Share the sample story for real, so the phone opens it by family code (and can answer it).
const sample = JSON.parse(readFileSync('public/samples/story-from-dad.json', 'utf8'));
const { code } = await (await fetch('http://localhost:8787/api/stories', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(sample),
})).json();
log('family code', code);

const gpu = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required', '--mute-audio'];
const browser = await chromium.launch({ args: gpu });

/** A page whose frames are streamed (CDP screencast) to OUT/<name>/ with timestamps. */
async function view(name, url, context) {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, ...context })).newPage();
  page.on('pageerror', (e) => log(name, 'page error', String(e)));
  await page.goto(APP + url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  // No page chrome in the footage (the family chip; the emulator's Enter XR button stays until used).
  await page.addStyleTag({ content: '.sp-family-chip { display: none !important; }' });
  const dir = join(OUT, name);
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const cdp = await page.context().newCDPSession(page);
  let n = 0;
  cdp.on('Page.screencastFrame', async (f) => {
    const file = `${String(n++).padStart(6, '0')}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp * 1000 });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
  });
  const start = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  const stop = () => cdp.send('Page.stopScreencast').catch(() => undefined);
  return { name, page, frames, start, stop };
}

/** When (ms since epoch) the page's replay clock was at 0, from its reported position. */
async function clockStart(page) {
  await page.waitForFunction(() => __sp.get('PerformancePlayer', 'position') > 0.5, null, { timeout: 60000, polling: 50 });
  const samples = [];
  for (let i = 0; i < 10; i++) {
    const [pos, now] = await page.evaluate(() => [__sp.get('PerformancePlayer', 'position'), Date.now()]);
    samples.push(now - pos * 1000);
    await sleep(100);
  }
  return samples.sort((a, b) => a - b)[5]; // median (position is rounded to 0.1 s)
}

const wall = await view('wall', '/', { viewport: { width: 1920, height: 1080 } });
const emulator = await view('emulator', '/', { viewport: { width: 2400, height: 1350 } });
// A tablet in landscape: the bedtime device (and the stage fills it).
const phone = await view('phone', `/?viewer&watch=${code}`, { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1.6, hasTouch: true });

await emulator.page.getByRole('button', { name: /Enter XR/i }).click();
await emulator.page.waitForFunction(() => __sp.get('Stage', 'mode') !== 'pending', null, { timeout: 30000 }).catch(() => undefined);
const card = phone.page.getByRole('button', { name: /Watch A story from far away from Dad/ }).first();
await card.waitFor({ timeout: 30000 });
await sleep(3000);
for (const v of [wall, emulator, phone]) await v.start();
await sleep(1500);

// Start all three replays together.
log('play');
await Promise.all([
  wall.page.evaluate(() => { __sp.set('PerformancePlayer', 'recordingId', 'sample-story-from-dad'); __sp.set('PerformancePlayer', 'playing', true); }),
  emulator.page.evaluate(() => { __sp.set('PerformancePlayer', 'recordingId', 'sample-story-from-dad'); __sp.set('PerformancePlayer', 'playing', true); }),
  card.click(),
]);
const starts = { wall: await clockStart(wall.page), emulator: await clockStart(emulator.page), phone: await clockStart(phone.page) };
log('clock starts (ms apart):', Object.values(starts).map((s) => Math.round(s - starts.wall)).join(' / '));

await phone.page.waitForFunction(() => !__sp.get('PerformancePlayer', 'playing'), null, { timeout: 240000, polling: 200 });
const storyEnd = Date.now();
log('story finished; goodnight card');
await emulator.stop();
await sleep(3500);
const reply = phone.page.getByRole('button', { name: /Send a goodnight back/ });
await reply.waitFor({ timeout: 15000 });
const replyAt = Date.now();
await reply.click();
await sleep(4500); // the reply sheet (never pressing Start: no camera)
await phone.page.getByRole('button', { name: 'Not now' }).click().catch(() => undefined);
await phone.stop();

// Mia's goodnight on Dad's wall.
await wall.page.evaluate(() => { __sp.set('PerformancePlayer', 'recordingId', 'sample-goodnight-from-mia'); __sp.set('PerformancePlayer', 'playing', true); });
const miaStart = await clockStart(wall.page);
await wall.page.waitForFunction(() => !__sp.get('PerformancePlayer', 'playing'), null, { timeout: 30000, polling: 200 });
await sleep(1500);
await wall.stop();

writeFileSync(join(OUT, 'timing.json'), JSON.stringify({
  code, starts, storyEnd, replyAt, miaStart,
  frames: { wall: wall.frames, emulator: emulator.frames, phone: phone.frames },
}, null, 1));
log('frames:', wall.frames.length, emulator.frames.length, phone.frames.length);
await browser.close();
server.kill();
