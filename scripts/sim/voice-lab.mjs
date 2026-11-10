// Pure voice-path delay: two headless pages (no 3D), fake mics, through the impairment relay.
// Reports mouth-to-ear delay per network condition. Needs the dev server on :8082 and :8787 free.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { beeps } from './media.mjs';
import { startNetem } from './netem.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, PORT: '8788', DATA_DIR: 'node_modules/.cache/shadowplay-sim/voice-stories' }, stdio: 'ignore' });
const netem = startNetem({ from: 8787, to: 8788, ctl: 8797 });
await sleep(800);
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${beeps()}`, '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'];
const [a, b] = await Promise.all([chromium.launch({ args }), chromium.launch({ args })]);
const host = await (await a.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'] })).newPage();
const guest = await (await b.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'] })).newPage();
await host.goto(`${APP}/scripts/sim/voice.html?role=host`);
await host.waitForFunction(() => window.lab?.state.code);
const code = await host.evaluate(() => lab.state.code);
await guest.goto(`${APP}/scripts/sim/voice.html?role=guest&code=${code}`);
await guest.waitForFunction(() => window.lab?.state.joined);
await host.evaluate(() => lab.talk());

const conditions = [
  ['same city (clean)', 0, 0],
  ['abroad (120 ms, jitter 30)', 120, 30],
  ['deployed / satellite (300 ms, jitter 100)', 300, 100],
  ['back to clean after a bad patch', 0, 0],
];
const results = [];
for (const [name, delay, jitter] of conditions) {
  netem.set(delay, jitter);
  const start = Date.now();
  await sleep(20000);
  const end = Date.now();
  const [hs, gs] = await Promise.all([host.evaluate(() => lab.stats()), guest.evaluate(() => lab.stats())]);
  const sent = hs.sentEdges.filter((t) => t > start + 3000 && t < end);
  const d = sent.map((s) => gs.heardEdges.find((h) => h > s && h - s < 3000)).map((h, i) => (h ? h - sent[i] : null)).filter((x) => x !== null).sort((x, y) => x - y);
  results.push({ condition: name, oneWayNetworkMs: delay, beeps: sent.length, heard: d.length, medianMs: d[Math.floor(d.length / 2)] ?? null, maxMs: d[d.length - 1] ?? null });
}
console.table(results);
await a.close(); await b.close(); netem.close(); server.kill();
process.exit(0);
