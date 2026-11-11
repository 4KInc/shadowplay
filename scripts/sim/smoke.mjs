// Smoke test a deployed Shadowplay: app, assets, samples, narration, sharing, replies,
// security checks and live rooms. Cleans nothing up itself: test stories expire with the bucket rule.
//   node scripts/sim/smoke.mjs https://<service-url>
import { request } from 'node:https';
import { request as httpRequest } from 'node:http';
import { WebSocket } from 'ws';

const base = process.argv[2].replace(/\/$/, '');
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
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
