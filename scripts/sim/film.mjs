// ?film (recording the submission video): after Enter XR the story picker is up
// (journal open, Settings beside it), the lamp is lit, the story waits, and the
// sample family is there. Without ?film nothing changes and the code never loads.
//
//   node scripts/sim/film.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
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

async function open(query) {
  const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  let filmChunk = false;
  page.on('request', (r) => (filmChunk ||= /\/film(\.ts|-[^/]*\.js)/.test(r.url())));
  await page.goto(APP + '/' + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && __sp.view().ready, null, { timeout: 30000 });
  // With ?film the journal opens once the stage is placed; give the story a moment to pause for it.
  await page.waitForFunction(() => __sp.get('ShadowJournal', 'open'), null, { timeout: 8000 }).catch(() => undefined);
  await sleep(1500);
  const s = await page.evaluate(() => ({
    journal: __sp.get('ShadowJournal', 'open'),
    picker: (__sp.where('story-next') ?? [0, -10])[1] > 0,
    status: __sp.get('StoryState', 'status'),
    lamp: __sp.get('Stage', 'lampLevel'),
    goodnights: __sp.get('FamilyInbox', 'unwatched'),
    beat: __sp.get('StoryState', 'beatId'),
    caption: (__sp.get('StoryState', 'caption') || '').slice(0, 40),
  }));
  await browser.close();
  return { ...s, filmChunk };
}

const film = await open('?film');
check('?film: the story picker is up after Enter XR (journal open, Settings beside it)', film.journal && film.picker, film);
check('?film: the lamp is lit and the story waits', film.lamp >= 0.99 && film.status === 'paused', film);
check('?film: the sample family is there (a goodnight waiting)', film.goodnights > 0, film);
const normal = await open('');
// (The emulator holds controllers, so the hands-first guard may pause the story here: not ?film's doing.)
check('without ?film: the normal start (journal and picker closed)', !normal.journal && !normal.picker && normal.beat !== '', normal);
check('without ?film: the film code is never loaded', !normal.filmChunk, normal);

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
if (results.some((r) => !r)) process.exitCode = 1;
