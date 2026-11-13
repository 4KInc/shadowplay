// Voice commands, without any real microphone:
//  A. the browser's speech recognition, replaced by a fake the test speaks into:
//     the first-screen toggle, the journal and Settings by voice, "go on" for a
//     movement beat, a shape the story did not ask for refused, the asked one
//     waking the creature, pause and continue, the whole of Counting Stars told
//     by voice with controllers in hand, and "voice commands off".
//  B. no speech recognition in the browser: Chromium's synthetic audio device
//     (a beep) is cut into short clips that are posted to /api/voice (answered
//     here by the test), and the answer acted on.
//
//   node scripts/sim/voice-commands.mjs [--gpu]
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
const errors = [];

async function open(context) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/api\/voice|ERR_|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.waitForFunction(() => __sp.get('Settings', 'tolerance') !== undefined, null, { timeout: 15000 });
  await sleep(1000);
  return page;
}
async function enterXR(page) {
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().head[1] > 1 && window.__sp.view().ready, null, { timeout: 30000 });
  await page.evaluate(() => IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'controller' }));
  await sleep(1500);
}

const browser = await chromium.launch({
  args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

// ------------------------------------------------------------------ A. browser speech recognition (fake)
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  await context.addInitScript(() => {
    window.__recStarts = 0;
    window.SpeechRecognition = class {
      start() {
        window.__rec = this;
        window.__recStarts++;
      }
      abort() {
        if (window.__rec === this) window.__rec = null;
      }
    };
    window.__say = (t) => window.__rec?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] });
  });
  const page = await open(context);
  const get = (c, f) => page.evaluate(([c, f]) => __sp.get(c, f), [c, f]);
  const say = async (t, wait = 600) => {
    await page.evaluate((t) => window.__say(t), t);
    await sleep(wait);
    return page.evaluate(() => __sp.view().voice);
  };

  const b = page.getByRole('button', { name: 'Voice commands' });
  await b.click();
  await sleep(800);
  check('first screen: Voice commands toggle', (await b.getAttribute('aria-pressed')) === 'true' && (await get('Settings', 'voiceCommands')) === true, {});
  await enterXR(page);
  check('in XR: listening with the browser\'s recognition', (await page.evaluate(() => __sp.view().voice.state)) === 'browser', { starts: await page.evaluate(() => window.__recStarts) });

  let v = await say('open the journal');
  const opened = await get('ShadowJournal', 'open');
  await say('forgiving shapes');
  const tol = await get('Settings', 'tolerance');
  await say('Close the journal.');
  const closed = await get('ShadowJournal', 'open');
  check('"open the journal", "forgiving shapes", "close the journal"', opened === true && tol === 'forgiving' && closed === false && v.heard === 'Heard: open the journal', { opened, tol, closed, heard: v.heard });

  // Mo follows a fingertip: "go on" instead.
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-follow', null, { timeout: 60000 });
  await sleep(500);
  await say('go on', 800);
  check('"go on" finishes the follow beat', (await get('StoryState', 'beatId')) !== 'stars-follow', { beat: await get('StoryState', 'beatId') });

  // The bird is asked for: "rabbit" is refused, "bird" wakes it.
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-want-bird', null, { timeout: 60000 });
  await page.waitForFunction(() => __sp.get('StoryState', 'voiceDone'), null, { timeout: 30000 });
  v = await say('rabbit');
  const stillAsking = (await get('StoryState', 'beatId')) === 'stars-want-bird';
  await say('the bird please', 1200);
  const after = await get('StoryState', 'beatId');
  check('a shape not asked for is refused; the asked one wakes the creature', stillAsking && /not now/.test(v.heard) && after !== 'stars-want-bird', { refused: v.heard, after });

  await say('pause');
  const paused = await get('StoryState', 'status');
  await say('continue', 1000);
  const playing = await get('StoryState', 'status');
  check('"pause" and "continue"', paused === 'paused' && playing === 'playing', { paused, playing });

  // The rest of the story by voice alone.
  const t0 = Date.now();
  let spoken = 0;
  while (Date.now() - t0 < 360000) {
    const s = await page.evaluate(() => ({ beat: __sp.get('StoryState', 'beatId'), target: __sp.get('ShapeRecognizer', 'target'), reading: !__sp.get('StoryState', 'voiceDone') }));
    if (s.beat === 'stars-end') break;
    if (!s.reading) {
      // As a player would: the shape when one is asked for, otherwise "go on".
      if (s.target && s.target !== 'none') await say(s.target, 300);
      await say('go on', 300);
      spoken++;
    }
    await sleep(700);
  }
  check('Counting Stars told to the end by voice', (await get('StoryState', 'beatId')) === 'stars-end', { last: await get('StoryState', 'beatId'), commands: spoken, minutes: +((Date.now() - t0) / 60000).toFixed(1) });

  await say('stop listening');
  const off = await page.evaluate(() => ({ setting: __sp.get('Settings', 'voiceCommands'), state: __sp.view().voice.state, rec: window.__rec !== null }));
  check('"stop listening" turns it off and stops recognition', off.setting === false && off.state === 'off' && !off.rec, off);
  await context.close();
}

// ------------------------------------------------------------------ B. server speech-to-text (synthetic audio)
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  await context.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });
  const posts = [];
  await context.route('**/api/voice', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { available: true } });
    posts.push({ type: req.headers()['content-type'], bytes: req.postDataBuffer()?.length ?? 0 });
    return route.fulfill({ json: { text: posts.length === 1 ? 'open the journal' : 'hmm' } });
  });
  const page = await open(context);
  await page.evaluate(() => __sp.set('Settings', 'voiceCommands', true));
  await enterXR(page);
  await page.waitForFunction(() => __sp.view().voice.state === 'server', null, { timeout: 10000 }).catch(() => {});
  const state = await page.evaluate(() => __sp.view().voice.state);
  for (let i = 0; i < 40 && !posts.length; i++) await sleep(250);
  await sleep(800);
  const opened = await page.evaluate(() => __sp.get('ShadowJournal', 'open'));
  check('no browser recognition: short webm clips go to /api/voice and the answer is acted on', state === 'server' && posts.length >= 1 && /^audio\/webm/.test(posts[0].type) && posts[0].bytes > 200 && opened === true, {
    state,
    clips: posts.length,
    first: posts[0],
    opened,
  });
  await page.evaluate(() => __sp.set('Settings', 'voiceCommands', false));
  await sleep(500);
  check('turned off: microphone released', (await page.evaluate(() => __sp.view().voice.state)) === 'off', {});
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
