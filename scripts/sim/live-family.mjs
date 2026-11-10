// Simulated family: a parent (headless browser, emulated Quest, demo director performing)
// hosts a live story; a child (second headless browser, phone viewport, family viewer) joins.
// Both get Chrome's fake camera and microphone (files, never real devices). The network
// between them is degraded on purpose. Prints a report and saves screenshots.
//
//   node scripts/sim/live-family.mjs [--seconds-per-phase 30]
// Needs: the dev server (npm run dev) on https://localhost:8082 and port 8787 free
// (the script runs the app server on 8788 behind an impairment relay on 8787).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { beeps, MEDIA_DIR, speech } from './media.mjs';
import { startNetem } from './netem.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const PHASE = Number(process.argv[process.argv.indexOf('--seconds-per-phase') + 1]) || 30;
const OUT = join(MEDIA_DIR, `live-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ server + impaired network
const server = spawn(process.execPath, ['server/main.ts'], {
  env: { ...process.env, PORT: '8788', DATA_DIR: join(OUT, 'stories') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
const netem = startNetem({ from: 8787, to: 8788, ctl: 8797 });
await sleep(800);

// ------------------------------------------------------------ two family members
const fakeMedia = (audio) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${audio}`,
  '--autoplay-policy=no-user-gesture-required',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-certificate-errors',
];
const parentBrowser = await chromium.launch({ args: fakeMedia(beeps()) });
const childBrowser = await chromium.launch({ args: fakeMedia(speech('child', 'Goodnight Daddy. I love you. See you soon.')) });
const parentCtx = await parentBrowser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, permissions: ['microphone', 'camera'] });
const childCtx = await childBrowser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, permissions: ['microphone', 'camera'], isMobile: true, hasTouch: true });
const parent = await parentCtx.newPage();
const child = await childCtx.newPage();
const errors = { parent: [], child: [] };
for (const [name, page] of [['parent', parent], ['child', child]]) {
  page.on('pageerror', (e) => errors[name].push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors[name].push(m.text()));
}
const sp = (page, fn, ...args) => page.evaluate(([f, a]) => window.__sp[f](...a), [fn, args]);
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => undefined);

log('loading parent and child pages');
await parent.goto(APP + '/', { waitUntil: 'load' });
await child.goto(APP + '/?viewer', { waitUntil: 'load' });
await parent.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await child.waitForFunction(() => window.__sp, null, { timeout: 60000 });

// Parent: names, enter the emulated headset, start the story with the demo director's hands.
await parent.getByRole('button', { name: /Who are the stories for|Stories for/ }).click();
await parent.getByLabel('Who are the stories for?').fill('Mia');
await parent.getByLabel('Your name, as they call you').fill('Dad');
await parent.getByRole('button', { name: 'Save' }).click();
await parent.getByRole('button', { name: /Enter XR/i }).click();
await parent.waitForFunction(() => window.__sp.get('Stage', 'mode') !== 'pending', null, { timeout: 30000 }).catch(() => undefined);
await sp(parent, 'set', 'StoryState', 'script', 'story/across-the-sea.story.json');
await sleep(1500);
await parent.waitForFunction(() => window.__sp.get('DemoDirector', 'status') !== undefined, null, { timeout: 30000 });
await sp(parent, 'set', 'DemoDirector', 'playing', true);

// Parent goes live and talks.
await sp(parent, 'set', 'LiveSession', 'role', 'host');
await parent.waitForFunction(() => window.__sp.get('LiveSession', 'code'), null, { timeout: 15000 });
const code = await sp(parent, 'get', 'LiveSession', 'code');
log('parent is live with code', code);
await sp(parent, 'set', 'LiveSession', 'talk', true);

// Child joins from the family viewer, talks, and shows their hands (fake camera).
await child.getByLabel('Family code').fill(code.replace(/-/g, ' '));
await child.getByRole('button', { name: 'Join live' }).click();
await child.waitForFunction(() => window.__sp.get('LiveSession', 'peerPresent'), null, { timeout: 15000 });
log('child joined');
await child.getByRole('button', { name: 'Talk' }).click();
await child.getByRole('button', { name: 'Show my hands' }).click();
const allow = child.getByRole('button', { name: 'Allow camera' });
if (await allow.isVisible().catch(() => false)) await allow.click();

// ------------------------------------------------------------ sampling
const samples = [];
const beats = { parent: [], child: [] };
let sampling = true;
let phase = 'clean';
const sampler = (async () => {
  while (sampling) {
    const at = Date.now();
    try {
      const [p, c] = await Promise.all([
        parent.evaluate(() => ({ beat: __sp.get('StoryState', 'beatId'), live: __sp.dump('LiveSession'), hands: __sp.hands() })),
        child.evaluate(() => ({ beat: __sp.get('StoryState', 'beatId'), live: __sp.dump('LiveSession'), hands: __sp.hands(), cam: __sp.dump('WebcamHands') })),
      ]);
      samples.push({ t: at - t0, phase, p, c });
      for (const [who, s] of [['parent', p], ['child', c]]) {
        const list = beats[who];
        if (s.beat && list[list.length - 1]?.id !== s.beat) list.push({ id: s.beat, t: at });
      }
    } catch {
      // A page navigating or busy: skip this sample.
    }
    await sleep(250);
  }
})();

const marks = {};
async function runPhase(name, seconds, setup) {
  phase = name;
  marks[name] = { start: Date.now() };
  log(`phase: ${name}`);
  await setup?.();
  await sleep(seconds * 1000 * 0.5);
  await shot(parent, `${name}-parent`);
  await shot(child, `${name}-child`);
  await sleep(seconds * 1000 * 0.5);
  marks[name].end = Date.now();
}

await runPhase('clean', PHASE);
await runPhase('bad-network', PHASE, () => netem.set(150, 60));
await runPhase('dropout', PHASE, async () => {
  netem.set(60, 20);
  marks.dropAt = Date.now();
  netem.drop();
});
await runPhase('duet', PHASE + 15, async () => {
  // From the top of the story, so shape requests come up while taking turns.
  await sp(parent, 'set', 'LiveSession', 'duet', true);
  await sp(parent, 'set', 'Settings', 'replayRequested', true);
});
phase = 'end';
marks.endAt = Date.now();
await sp(parent, 'set', 'LiveSession', 'role', 'off');
await child.waitForFunction(() => window.__sp.get('LiveSession', 'role') === 'off', null, { timeout: 60000 }).catch(() => undefined);
marks.childEndedAt = Date.now();
await shot(child, 'end-child');
sampling = false;
await sampler;

// ------------------------------------------------------------ report
const voice = { parent: await sp(parent, 'voice'), child: await sp(child, 'voice') };
// Exact per-frame logs from inside each page.
const pageBeats = { parent: await sp(parent, 'beats'), child: await sp(child, 'beats') };
const fps = {
  parent: (await sp(parent, 'frames')) / ((Date.now() - t0) / 1000),
  child: (await sp(child, 'frames')) / ((Date.now() - t0) / 1000),
};
function delays(sent, heard) {
  const out = [];
  for (const s of sent) {
    const h = heard.find((x) => x > s && x - s < 3000);
    if (h) out.push(h - s);
  }
  return out;
}
const stat = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, median: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
};
const inPhase = (xs, name) => xs.filter((x) => x >= marks[name].start && x <= marks[name].end);
const parentToChild = delays(voice.parent.sentEdges, voice.child.heardEdges);
// Match the parent's beats (after the child joined) to the child's, in order.
const joined = marks.clean.start;
// Beats the parent entered while disconnected (the dropout) reach the child as the
// snapshot sent on reconnect, not one by one, so they are not counted as missed.
const offline = (t) => t >= marks.dropAt && t <= marks.dropAt + 4000;
const pb = pageBeats.parent.filter((b) => b.t >= joined && b.t <= marks.endAt && !offline(b.t));
let ci = 0;
const beatLag = [];
const missed = [];
for (const b of pb) {
  const k = pageBeats.child.findIndex((c, i) => i >= ci && c.id === b.id && c.t >= b.t - 50);
  if (k < 0) { missed.push(b.id); continue; }
  beatLag.push(pageBeats.child[k].t - b.t);
  ci = k + 1;
}
const reconnect = samples.find((s) => s.t + t0 > marks.dropAt + 200 && s.p.live?.peerPresent && s.c.live?.peerPresent && s.c.live?.connected);
const turns = samples.filter((s) => s.phase === 'duet').map((s) => s.p.live?.turn);
const report = {
  code,
  phaseSeconds: PHASE,
  voice: {
    packets: { parentSent: voice.parent.sent, childReceived: voice.child.received, childSent: voice.child.sent, parentReceived: voice.parent.received },
    parentToChildDelayMs: stat(parentToChild),
    cleanDelayMs: stat(delays(inPhase(voice.parent.sentEdges, 'clean'), voice.child.heardEdges)),
    badNetworkDelayMs: stat(delays(inPhase(voice.parent.sentEdges, 'bad-network'), voice.child.heardEdges)),
    childHeardByParent: voice.parent.heardEdges.length > 0,
  },
  story: {
    parentBeats: pb.length,
    beatsMissedOnChild: missed,
    beatLagMs: stat(beatLag),
  },
  hands: {
    parentHandsSeenOnChild: samples.some((s) => s.c.hands.override === 'live' && (s.c.hands.left || s.c.hands.right)),
    childCamera: samples[samples.length - 1]?.c.cam,
  },
  dropout: { recoveredAfterMs: reconnect ? reconnect.t + t0 - marks.dropAt : null },
  duet: { turnWentToChild: turns.includes('guest'), turnCameBack: turns.lastIndexOf('host') > turns.indexOf('guest') && turns.includes('guest') },
  end: { childEndedAfterMs: marks.childEndedAt - marks.endAt, childStatus: samples[samples.length - 1]?.c.live?.status },
  framesPerSecond: { parent: +fps.parent.toFixed(1), child: +fps.child.toFixed(1) },
  errors,
  screenshots: OUT,
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ report, samples, pageBeats, voice, marks }, null, 2));
console.log(JSON.stringify(report, null, 2));

await parentBrowser.close();
await childBrowser.close();
netem.close();
server.kill();
process.exit(0);
