// Smoke test a deployed Shadowplay: app, assets, samples, narration, sharing, replies,
// security checks and live rooms, plus two pages in a headless browser: the family viewer
// (?viewer) and device diagnostics (?diag), whose beacons the server must accept.
// Cleans nothing up itself: test stories expire with the bucket rule.
//   node scripts/sim/smoke.mjs https://<service-url> [--diag-bucket gs://<bucket>]
// --diag-bucket also waits (up to 40 s; the server writes every 15 s) for the ?diag session's
// file to land in gs://<bucket>/diag/<UTC date>/ (needs gcloud signed in).
import { execFileSync } from 'node:child_process';
import { request } from 'node:https';
import { request as httpRequest } from 'node:http';
import { WebSocket } from 'ws';

const base = process.argv[2].replace(/\/$/, '');
const diagBucket = process.argv.includes('--diag-bucket') ? process.argv[process.argv.indexOf('--diag-bucket') + 1] : '';
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
};
const get = (p, init) => fetch(base + p, init);

const h = await (await get('/api/health')).json();
ok('health', h.ok, JSON.stringify(h));
// /healthz serves locally; Cloud Run reserves paths ending in 'z', so only /api/health counts there.
if (!/\.run\.app$/.test(new URL(base).hostname)) ok('/healthz', (await get('/healthz')).ok);

/** Bytes on the wire for one request with Accept-Encoding: br, gzip (fetch would decode them). */
function wire(path) {
  const url = new URL(base + path);
  const req = url.protocol === 'https:' ? request : httpRequest;
  return new Promise((resolve, reject) => {
    req(url, { headers: { 'Accept-Encoding': 'br, gzip' } }, (res) => {
      let bytes = 0;
      res.on('data', (c) => (bytes += c.length));
      res.on('end', () => resolve({ bytes, headers: res.headers, status: res.statusCode }));
    }).on('error', reject).end();
  });
}

// Cold load: index.html, its entry script and the entry's static imports, as transferred.
{
  const index = await wire('/');
  ok('index.html no-cache', index.headers['cache-control'] === 'no-cache', index.headers['cache-control']);
  const page = await (await get('/')).text();
  const entry = page.match(/<script[^>]+src="\.?\/?([^"]+\.js)"/)?.[1];
  const files = new Set([entry]);
  for (const f of files) {
    const code = await (await get('/' + f)).text();
    for (const m of code.matchAll(/(?:^|[;}\s])import\s*(?:[\w*{}\s,$]+from\s*)?["']\.\/([\w.-]+\.js)["']/g)) files.add('assets/' + m[1]);
  }
  let bytes = index.bytes;
  for (const f of files) {
    const r = await wire('/' + f);
    bytes += r.bytes;
    if (f === entry) {
      ok('entry script compressed', ['br', 'gzip'].includes(r.headers['content-encoding']), r.headers['content-encoding']);
      ok('entry script immutable', /immutable/.test(r.headers['cache-control'] ?? ''), r.headers['cache-control']);
    }
  }
  ok('cold-load bytes under 2 MB', bytes < 2 * 1024 * 1024, `${(bytes / 1024).toFixed(0)} KB over ${files.size + 1} files`);
}
const html = await (await get('/')).text();
ok('app page', html.includes('<script'));
const js = html.match(/src="([^"]+\.js)"/)?.[1];
ok('main bundle', js && (await get('/' + js.replace(/^\.?\//, ''), { method: 'HEAD' })).ok, js);
for (const p of ['/story/the-moth.story.json', '/story/across-the-sea.story.json', '/models/hand_landmarker.task', '/narration/manifest.json']) {
  ok(p, (await get(p, { method: 'HEAD' })).ok);
}
const manifest = await (await get('/narration/manifest.json')).json();
const clips = Object.values(manifest.clips ?? {});
ok('narration clips', clips.length > 90 && (await get('/' + clips[0], { method: 'HEAD' })).headers.get('content-type') === 'audio/mpeg', `${clips.length} clips`);
for (const s of ['story-from-dad', 'goodnight-from-mia']) {
  const sample = await (await get(`/samples/${s}.json`)).json().catch(() => null);
  ok(`sample ${s}`, sample?.sample && sample.audio?.startsWith('data:audio/mpeg'), sample?.title);
}

const perf = { version: 'shadowplay.performance.v1', id: 'smoke', title: 'Smoke test', performer: 'Test', hands: '', frameCount: 0, durationMs: 1000, events: [], audio: null };
const post = (p, body) => get(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const up = await post('/api/stories', { ...perf, extra: 'dropped' });
const { code } = await up.json();
ok('upload', up.status === 201, code);
const got = await (await get(`/api/stories/${code}`)).json();
ok('fetch by code, unknown fields dropped', got.performance?.title === 'Smoke test' && got.performance.extra === undefined);
ok('reply', (await post(`/api/stories/${code}/replies`, { ...perf, id: 'smoke-reply' })).status === 201);
ok('list replies', (await (await get(`/api/stories/${code}/replies`)).json()).replies?.length === 1);
ok('malformed story refused', (await post('/api/stories', { ...perf, hands: 'AAAA' })).status === 400);
ok('unknown script refused', (await post('/api/stories', { ...perf, script: '../x.json' })).status === 400);
ok('bad escape is 404', (await get('/api/stories/%E0%A4%A')).status === 404);

// Live: room, join, relay; a guest cannot pose as the server.
const ws = base.replace(/^http/, 'ws') + '/live';
await new Promise((resolve) => {
  const host = new WebSocket(`${ws}?role=host`);
  const seen = [];
  const t = setTimeout(() => { ok('live', false, 'timeout'); resolve(); }, 15000);
  host.on('message', (d, bin) => {
    if (bin) {
      ok('live relay guest->host', d.length === 4);
      setTimeout(() => {
        ok('fake server message from guest dropped', !seen.includes('ended'), seen.join(','));
        host.close(4000);
        clearTimeout(t);
        resolve();
      }, 500);
      return;
    }
    const m = JSON.parse(String(d));
    seen.push(m.type);
    if (m.type === 'room') {
      ok('live room opened', !!m.token, m.code);
      const guest = new WebSocket(`${ws}?role=guest&code=${m.code}`);
      guest.on('message', (g) => {
        if (JSON.parse(String(g)).type !== 'joined') return;
        ok('live guest joined', true);
        guest.send(JSON.stringify({ type: 'ended', reason: 'fake' }));
        setTimeout(() => guest.send(Buffer.from([2, 0, 1, 0])), 200);
      });
    }
  });
});
// In a browser: the family viewer, and ?diag reporting to this server.
{
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const viewer = await (await browser.newContext({ viewport: { width: 400, height: 820 } })).newPage();
    const viewerErrors = [];
    viewer.on('pageerror', (e) => viewerErrors.push(String(e)));
    await viewer.goto(base + '/?viewer', { waitUntil: 'load' });
    const shown = await viewer.waitForSelector('.sp-viewer', { timeout: 60000 }).then(() => true, () => false);
    ok('?viewer loads (family viewer UI)', shown && viewerErrors.length === 0, viewerErrors[0] ?? '');

    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const beacons = [];
    let session = '';
    page.on('response', (r) => {
      if (!r.url().includes('/api/diag')) return;
      beacons.push(r.status());
      try {
        session ||= JSON.parse(r.request().postData() ?? '{}').session ?? '';
      } catch {}
    });
    await page.goto(base + '/?diag', { waitUntil: 'load' });
    for (let i = 0; i < 30 && !beacons.length; i++) await new Promise((r) => setTimeout(r, 500));
    ok('?diag reports a session', /^[a-z0-9]{8,32}$/.test(session), session);
    ok('?diag beacons accepted', beacons.length > 0 && beacons.every((s) => s === 204), beacons.join(','));
    if (diagBucket && session) {
      const object = `${diagBucket.replace(/\/$/, '')}/diag/${new Date().toISOString().slice(0, 10)}/${session}.jsonl`;
      let landed = false;
      for (let i = 0; i < 20 && !landed; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          execFileSync('gcloud', ['storage', 'ls', object], { stdio: 'ignore' });
          landed = true;
        } catch {}
      }
      ok('diag line landed in the bucket', landed, object);
    }
  } finally {
    await browser.close();
  }
}

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
