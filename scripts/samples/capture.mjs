// Step 1 of the bundled samples: record the demo director performing "Goodnight Across the
// Sea" (family names Dad and Mia) in a headless emulated headset, and save the recording in
// its shareable form. Step 2 (scripts/samples/voice.py) adds the voices.
//   node scripts/samples/capture.mjs      (needs the dev server on https://localhost:8082)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const OUT = join(process.cwd(), 'node_modules/.cache/shadowplay-samples');
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => log('page error', String(e)));
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await page.getByRole('button', { name: /Who are the stories for|Stories for/ }).click();
await page.getByLabel('Who are the stories for?').fill('Mia');
await page.getByLabel('Your name, as they call you').fill('Dad');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.__sp.get('DemoDirector', 'status') !== undefined, null, { timeout: 30000 });
await page.evaluate(() => {
  __sp.set('StoryState', 'script', 'story/across-the-sea.story.json');
  __sp.set('DemoDirector', 'persona', 'perfect');
});
await page.waitForTimeout(3000);
await page.evaluate(() => {
  __sp.set('Settings', 'replayRequested', true);
  __sp.set('PerformanceRecorder', 'withVoice', false);
  __sp.set('PerformanceRecorder', 'title', 'A story from far away');
  __sp.set('PerformanceRecorder', 'recording', true);
  __sp.set('DemoDirector', 'playing', true);
});
log('recording...');
await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'sea-end', null, { timeout: 15 * 60_000, polling: 1000 });
await page.waitForTimeout(4000);
const before = await page.evaluate(() => __sp.get('PerformanceRecorder', 'lastId'));
await page.evaluate(() => __sp.set('PerformanceRecorder', 'recording', false));
await page.waitForFunction((b) => __sp.get('PerformanceRecorder', 'lastId') !== b, before, { timeout: 30000 });
const id = await page.evaluate(() => __sp.get('PerformanceRecorder', 'lastId'));
const wire = await page.evaluate((i) => __sp.exportRecording(i), id);
writeFileSync(join(OUT, 'story-raw.json'), JSON.stringify(wire));
log(`saved ${id}: ${(wire.durationMs / 1000).toFixed(0)} s, ${wire.events.length} events, ${wire.frameCount} frames`);
await browser.close();
