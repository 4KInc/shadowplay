// Hands that keep dropping out of tracking (a dim room): during a shape request
// the ghost hand shows at once with "Hands lost — try turning a light on", and
// ?diag logs the flickers per beat. Steady hands never see it.
//
//   node scripts/sim/tracking-dropouts.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

async function play(persona) {
  const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  const events = [];
  page.on('request', (r) => {
    if (!r.url().includes('/api/diag')) return;
    try {
      for (const it of JSON.parse(r.postData()).items) if (it.e === 'dropouts') events.push(it);
    } catch {}
  });
  await page.goto(APP + '/?diag', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.__sp.get('DemoDirector', 'status') !== undefined, null, { timeout: 30000 });
  await page.evaluate((p) => {
    __sp.set('StoryState', 'script', 'story/the-moth.story.json');
    __sp.set('DemoDirector', 'persona', p);
    __sp.set('DemoDirector', 'playing', true);
  }, persona);
  // The second shape request (the fish): the ghost hand would otherwise wait 15 s.
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'want-fish', null, { timeout: 180000, polling: 100 });
  const t0 = Date.now();
  let lightAt = -1;
  let hintAt = -1;
  let sawLight = false;
  while (Date.now() - t0 < 30000) {
    const s = await page.evaluate(() => ({ beat: __sp.get('StoryState', 'beatId'), hint: __sp.get('StoryState', 'hintVisible'), light: __sp.view().lightHint }));
    const t = (Date.now() - t0) / 1000;
    if (s.light) sawLight = true;
    if (s.light && lightAt < 0) lightAt = t;
    if (s.hint && hintAt < 0) hintAt = t;
    if (s.beat !== 'want-fish') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const woke = await page.evaluate(() => __sp.get('StoryState', 'beatId') !== 'want-fish');
  await new Promise((r) => setTimeout(r, 7000)); // the next beacon carries the beat's dropout count
  await browser.close();
  return { lightAt, hintAt, sawLight, woke, events };
}

const dim = await play('dim');
check('flickering hands: the light line shows within 5 s', dim.lightAt >= 0 && dim.lightAt <= 5, { lightAt: dim.lightAt });
check('flickering hands: the ghost hand shows at once (not after 15 s)', dim.hintAt >= 0 && dim.hintAt <= 5, { hintAt: dim.hintAt });
check('flickering hands: once the light is on (12 s), the shape wakes', dim.woke);
const logged = dim.events.find((e) => e.beat === 'want-fish');
check('?diag logs the flickers for that beat', Boolean(logged && logged.flickers >= 3), logged ?? { events: dim.events.length });
const steady = await play('perfect');
check('steady hands never see the light line', !steady.sawLight, { sawLight: steady.sawLight });

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
if (results.some((r) => !r)) process.exitCode = 1;
