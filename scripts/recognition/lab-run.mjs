// Run the in-app recognition lab's synthetic trials (every fixture x every synthetic tester,
// through the real pipeline: hand casters, joint angles, silhouettes, fusion) in a headless
// emulated headset, and print per-shape accuracy and negative false triggers at the hold time.
//   node scripts/recognition/lab-run.mjs [--out report.json]     (dev server on :8082)
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
await page.goto('https://localhost:8082/');
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => __sp.get('Stage', 'mode') === 'wall' || __sp.get('Stage', 'mode') === 'screen', null, { timeout: 30000 });
await page.waitForFunction(() => __sp.get('RecognitionLab', 'status') !== undefined, null, { timeout: 30000 });
await page.evaluate(() => __sp.set('RecognitionLab', 'autoRun', true));
await page.waitForFunction(() => (__sp.get('RecognitionLab', 'syntheticReport') ?? '').length > 10, null, { timeout: 900000, polling: 1000 });
const report = JSON.parse(await page.evaluate(() => __sp.get('RecognitionLab', 'syntheticReport')));
await browser.close();
if (out) writeFileSync(out, JSON.stringify(report, null, 2));

const pct = (x) => `${Math.round(x * 100)}%`;
console.log(`hold time ${report.holdSeconds ?? 0.5} s, ${report.trials ?? '?'} trials`);
console.log('per-shape accuracy (fused / joint / silhouette):');
for (const [shape, s] of Object.entries(report.perShape ?? {})) {
  console.log(`  ${shape.padEnd(10)} ${pct(s.accuracy?.fused ?? 0).padStart(5)} ${pct(s.accuracy?.joint ?? 0).padStart(5)} ${pct(s.accuracy?.silhouette ?? 0).padStart(5)}`);
}
const n = report.negative;
if (n) {
  console.log(`negatives: ${n.trials} trials, ${n.frames} frames; false-match rate fused ${n.falseMatchRate?.fused} joint ${n.falseMatchRate?.joint} silhouette ${n.falseMatchRate?.silhouette}`);
  for (const m of ['fused', 'joint', 'silhouette']) {
    const t = n.falseTriggers?.[m] ?? [];
    const by = t.reduce((acc, x) => ((acc[x.shape] = (acc[x.shape] ?? 0) + 1), acc), {});
    console.log(`  false triggers (${m}): ${t.length}${t.length ? ' ' + JSON.stringify(by) : ''}`);
  }
}
