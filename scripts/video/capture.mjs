// Submission video, step 1: capture synchronized footage from the running app (dev server)
// with headless Chrome on the GPU. Three views play the bundled sample story from Dad:
//   wall:     the stage as Dad sees it (browser rendering of the same stage, no emulator UI)
//   emulator: the emulated Quest view (for an establishing shot; cropped in assembly)
//   phone:    the family viewer on a tablet, opened from a real family code
// then the phone's goodnight card and "Send a goodnight back", and Mia's goodnight on the wall.
// Frames (JPEG) and timing go to node_modules/.cache/shadowplay-video/. Step 2: assemble.py.
//   node scripts/video/capture.mjs     (dev server running; starts its own API server on :8787)
//   node scripts/video/capture.mjs --stills
//     six clean 1920x1080 stills instead (submission/screenshots/, local only): the emulated headset with no
//     emulator panels or input models, and the family viewer.
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  await page.addStyleTag({ content: '.sp-family-chip, .sp-access, .sp-credits-link, .sp-credits-btn { display: none !important; }' });
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

if (process.argv.includes('--stills')) {
  await stills();
  await browser.close();
  server.kill();
  process.exit(0);
}

/**
 * Stills for the submission page. The headset shots are the emulated Quest in
 * XR with its developer panels hidden and no controller or hand models: the
 * demo director's hands cast the shadows, as real hands would.
 */
async function stills() {
  const dir = join(process.cwd(), 'submission/screenshots');
  mkdirSync(dir, { recursive: true });
  const shot = async (page, name, folder = dir) => {
    // The emulator's toolbar and device panels: the one HTML layer among its canvases. Tag it and hide it.
    await page.evaluate(() => {
      const layer = [...document.body.children].find((e) => getComputedStyle(e).zIndex === '999');
      for (const e of layer?.children ?? []) if (e.tagName === 'DIV') e.classList.add('sp-emulator-ui');
    });
    await page.addStyleTag({ content: '.sp-emulator-ui { display: none !important; }' });
    await sleep(100);
    await page.screenshot({ path: join(folder, `${name}.png`) });
    log('still', name);
  };
  // ?clean: as judges see it (no development-only rows).
  const headset = (await view('stills-headset', '/?clean', { viewport: { width: 1920, height: 1080 } })).page;
  await headset.getByRole('button', { name: /Enter XR/i }).click();
  await headset.waitForFunction(() => window.IWER_DEVICE?.activeSession && __sp.view().ready, null, { timeout: 30000 });
  await headset.evaluate(() => {
    for (const side of ['left', 'right']) {
      IWER_DEVICE.controllers[side].connected = false;
      IWER_DEVICE.hands[side].connected = false;
    }
    // A camera-like view: the emulator's full headset field of view makes the stage small.
    IWER_DEVICE.fovy = (52 * Math.PI) / 180;
    __sp.set('StoryState', 'script', 'story/the-moth.story.json');
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  const family = (await view('stills-family', `/?viewer&watch=${code}`, { viewport: { width: 1920, height: 1080 }, hasTouch: true })).page;
  await family.getByRole('button', { name: /Watch A story from far away from Dad/ }).first().click({ timeout: 30000 });

  /** Shot once the story has moved past `beat` (the creature it asked for is awake). */
  const after = async (beat, name, settle = 1500) => {
    await headset.waitForFunction((b) => __sp.get('StoryState', 'beatId') === b, beat, { timeout: 300000, polling: 100 });
    await headset.waitForFunction((b) => __sp.get('StoryState', 'beatId') !== b, beat, { timeout: 120000, polling: 100 });
    await sleep(settle);
    await shot(headset, name);
  };
  const familyStory = (async () => {
    // Candidates through the story, kept in the cache to choose from.
    const candidates = join(OUT, 'family-candidates');
    mkdirSync(candidates, { recursive: true });
    for (const at of [20, 35, 50, 65, 80, 95]) {
      await family.waitForFunction((t) => __sp.get('PerformancePlayer', 'position') > t, at, { timeout: 200000, polling: 100 });
      await shot(family, `family-${at}s`, candidates);
      // The bird in the rain (a different creature from the headset stills).
      if (at === 80) copyFileSync(join(candidates, 'family-80s.png'), join(dir, '4-family-viewer.png'));
    }
    await family.waitForFunction(() => !__sp.get('PerformancePlayer', 'playing'), null, { timeout: 300000, polling: 200 });
    await family.getByRole('button', { name: /Send a goodnight back/ }).waitFor({ timeout: 15000 });
    await sleep(1200);
    await shot(family, '5-goodnight-card');
  })();
  await after('want-rabbit', '1-headset-rabbit', 3500);
  await after('want-wings', '2-headset-bird', 400);
  await after('want-cup', '3-headset-cupped-hands', 2500);
  await headset.evaluate(() => {
    __sp.set('DemoDirector', 'playing', false);
    __sp.set('ShadowJournal', 'open', true);
    // Wider, so the whole Settings panel beside the stage fits.
    IWER_DEVICE.fovy = (78 * Math.PI) / 180;
  });
  await sleep(2500);
  await shot(headset, '6-headset-journal-settings');
  await familyStory;
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

// The headset side only seeds Mia's goodnight (samples are per role); Dad's story reaches the wall
// and the emulated headset the way it reaches a family: fetched by its family code.
const fetchByCode = (page) => page.evaluate(async (c) => (await import('/src/performance/sharing.ts')).fetchStory(c).then((p) => p.id), code);
const dadOnWall = await fetchByCode(wall.page);
const dadOnEmulator = await fetchByCode(emulator.page);

// Start all three replays together.
log('play');
await Promise.all([
  wall.page.evaluate((id) => { __sp.set('PerformancePlayer', 'recordingId', id); __sp.set('PerformancePlayer', 'playing', true); }, dadOnWall),
  emulator.page.evaluate((id) => { __sp.set('PerformancePlayer', 'recordingId', id); __sp.set('PerformancePlayer', 'playing', true); }, dadOnEmulator),
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
