import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

/** The real server in a child process, behind one trusted proxy hop (as on Cloud Run). */
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const data = mkdtempSync(join(tmpdir(), 'shadowplay-api-'));
let server: ChildProcess;

before(async () => {
  server = spawn(process.execPath, ['server/main.ts'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: data, STATIC_DIR: join(process.cwd(), 'public'), TRUSTED_PROXY_HOPS: '1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => {
  server.kill();
  rmSync(data, { recursive: true, force: true });
});

let clients = 0;
/** Each test is its own client address (as the proxy would report it), so rate limits do not leak between tests. */
function as(ip = `10.0.0.${++clients}`) {
  const headers = (extra: Record<string, string> = {}) => ({ 'X-Forwarded-For': `6.6.6.6, ${ip}`, ...extra });
  return {
    get: (path: string) => fetch(BASE + path, { headers: headers() }),
    post: (path: string, body: unknown) =>
      fetch(BASE + path, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }),
  };
}

/** A valid story: 2 frames of hands (151 int16 values each), a beat and a wake. */
function story(extra: Record<string, unknown> = {}) {
  return {
    version: 'shadowplay.performance.v1',
    id: 'perf-test',
    title: 'A story for Mia',
    performer: 'Dad',
    child: 'Mia',
    createdAt: 1,
    durationMs: 2000,
    script: 'story/the-moth.story.json',
    frameHz: 30,
    hands: Buffer.alloc(2 * 151 * 2).toString('base64'),
    frameCount: 2,
    events: [
      { t: 0, type: 'beat', data: { index: 0, id: 'prologue' } },
      { t: 500, type: 'wake', data: { shape: 'rabbit', hand: 'right', twoHanded: false } },
    ],
    audio: null,
    ...extra,
  };
}

test('a valid story round-trips, keeping only known fields', async () => {
  const c = as();
  const up = await c.post('/api/stories', story({ secret: 'x'.repeat(100), shareCode: 'ignored' }));
  assert.equal(up.status, 201);
  const { code } = (await up.json()) as { code: string };
  const got = (await (await c.get(`/api/stories/${code}`)).json()) as { performance: Record<string, unknown> };
  assert.equal(got.performance.title, 'A story for Mia');
  assert.equal(got.performance.secret, undefined);
  assert.equal(got.performance.shareCode, undefined);
});

test('malformed stories are refused', async () => {
  const c = as();
  const bad: Record<string, unknown>[] = [
    story({ hands: 'AAAA' }), // length does not match frameCount
    story({ frameCount: 1e9 }),
    story({ durationMs: 99 * 60_000 }),
    story({ events: [{ t: 0, type: 'explode', data: {} }] }),
    story({ events: [{ t: 0, type: 'beat', data: { nested: { deep: true } } }] }),
    story({ script: '../../secrets.json' }),
    story({ script: 'https://evil.example/x.json' }),
    story({ audio: 'javascript:alert(1)' }),
    story({ title: 'x'.repeat(500) }),
    story({ version: 'other' }),
  ];
  for (const s of bad) assert.equal((await c.post('/api/stories', s)).status, 400, JSON.stringify(s).slice(0, 80));
  assert.equal((await fetch(`${BASE}/api/stories`, { method: 'POST', body: 'not json', headers: { 'X-Forwarded-For': `1.1.1.1, 10.9.9.9` } })).status, 400);
});

test('bad codes are a 404, never a crash', async () => {
  const c = as();
  for (const raw of ['%E0%A4%A', '..%2F..%2Fpackage.json', 'nope-nope-nope-111']) {
    assert.equal((await c.get(`/api/stories/${raw}`)).status, 404, raw);
  }
});

test('rate limits follow the real client address, not what the client claims', async () => {
  // Same real address (last hop), a different spoofed first entry every time: still limited.
  const ip = '10.1.1.1';
  let last = 0;
  for (let i = 0; i < 31; i++) {
    const r = await fetch(`${BASE}/api/stories/nope-nope-nope-111`, { headers: { 'X-Forwarded-For': `9.9.9.${i}, ${ip}` } });
    last = r.status;
  }
  assert.equal(last, 429);
  // A different real client is not affected.
  assert.equal((await as('10.1.1.2').get('/api/stories/nope-nope-nope-111')).status, 404);
});

test('goodnights arriving together each get their own slot, up to five', async () => {
  const c = as();
  const { code } = (await (await c.post('/api/stories', story())).json()) as { code: string };
  const replies = await Promise.all(
    Array.from({ length: 6 }, (_, i) => as().post(`/api/stories/${code}/replies`, story({ id: `reply-${i}`, performer: 'Mia' }))),
  );
  const statuses = replies.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 201, 201, 201, 201, 409]);
  const list = (await (await c.get(`/api/stories/${code}/replies`)).json()) as { replies: { id: string }[] };
  assert.equal(new Set(list.replies.map((r) => r.id)).size, 5);
});

test('static files cannot escape the app folder', async () => {
  for (const path of ['/../package.json', '/%2e%2e/package.json', '/..%2fserver/main.ts']) {
    const text = await (await fetch(BASE + path)).text();
    assert.ok(!text.includes('"dependencies"') && !text.includes('createServer'), path);
  }
});
