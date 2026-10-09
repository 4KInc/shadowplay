import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { isCode, newCode, normaliseCode } from './codes.ts';
import { attachLive, liveRoomCount } from './live.ts';
import { DiskStore, GcsStore, type StoryStore } from './storage.ts';

/**
 * Shadowplay server: serves the app and a tiny private sharing API for
 * bedtime stories. No accounts and no listing: a story is reachable only by
 * its family code, and expires after STORY_TTL_DAYS.
 *
 *   POST /api/stories        upload a performance -> { code, expiresAt }
 *   GET  /api/stories/:code  fetch a performance by family code
 *   POST /api/stories/:code/replies   a goodnight back from the family (up to MAX_REPLIES)
 *   GET  /api/stories/:code/replies   the replies to a story (for the storyteller)
 *   GET  /api/health
 *   WS   /live                live rooms (see live.ts)
 */
const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = process.env.STATIC_DIR ?? join(process.cwd(), 'dist');
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), '.data/stories');
const MAX_BYTES = Number(process.env.MAX_STORY_BYTES ?? 30 * 1024 * 1024);
const TTL_DAYS = Number(process.env.STORY_TTL_DAYS ?? 30);
const PERFORMANCE_VERSION = 'shadowplay.performance.v1';
const MAX_REPLIES = 5;
/** Replies are short: a goodnight, not a second story. */
const MAX_REPLY_BYTES = Number(process.env.MAX_REPLY_BYTES ?? 6 * 1024 * 1024);

/** STORY_BUCKET (production): a Cloud Storage bucket; otherwise local disk. */
const BUCKET = process.env.STORY_BUCKET ?? '';
const store: StoryStore = BUCKET
  ? new GcsStore(BUCKET, process.env.STORAGE_API ?? undefined, process.env.STORAGE_TOKEN_URL ?? undefined)
  : new DiskStore(DATA_DIR);

// ---------------------------------------------------------------- rate limiting

/** Simple per-IP token buckets: uploads are rare, lookups are a little more frequent. */
const LIMITS = { upload: { per: 3600_000, max: 20 }, lookup: { per: 60_000, max: 30 } } as const;
const buckets = new Map<string, { count: number; reset: number }>();

function allowed(kind: keyof typeof LIMITS, ip: string): boolean {
  const key = `${kind}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + LIMITS[kind].per });
    return true;
  }
  b.count++;
  return b.count <= LIMITS[kind].max;
}

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() || req.socket.remoteAddress || '?';
}

// ---------------------------------------------------------------- helpers

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

async function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Minimal shape check so the store only ever holds performance streams. */
function validPerformance(p: unknown): p is Record<string, unknown> {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    o.version === PERFORMANCE_VERSION &&
    typeof o.hands === 'string' &&
    typeof o.frameCount === 'number' &&
    typeof o.durationMs === 'number' &&
    Array.isArray(o.events) &&
    (o.audio === undefined || o.audio === null || (typeof o.audio === 'string' && o.audio.startsWith('data:audio/')))
  );
}

// ---------------------------------------------------------------- API

async function uploadStory(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!allowed('upload', clientIp(req))) return json(res, 429, { error: 'Too many uploads. Try again later.' });
  const body = await readBody(req, MAX_BYTES);
  if (body === null) return json(res, 413, { error: 'Story too large.' });
  let perf: unknown;
  try {
    perf = JSON.parse(body);
  } catch {
    return json(res, 400, { error: 'Not a story.' });
  }
  if (!validPerformance(perf)) return json(res, 400, { error: 'Not a Shadowplay story.' });
  const code = newCode();
  const expiresAt = Date.now() + TTL_DAYS * 86_400_000;
  await store.put(code, JSON.stringify({ storedAt: Date.now(), expiresAt, performance: perf }));
  json(res, 201, { code, expiresAt });
}

async function fetchStory(req: IncomingMessage, res: ServerResponse, raw: string): Promise<void> {
  if (!allowed('lookup', clientIp(req))) return json(res, 429, { error: 'Too many tries. Wait a minute.' });
  const code = normaliseCode(decodeURIComponent(raw));
  if (!isCode(code)) return json(res, 404, { error: 'No story with that code.' });
  const text = await store.get(code);
  if (!text) return json(res, 404, { error: 'No story with that code.' });
  const record = JSON.parse(text) as { expiresAt: number; performance: unknown };
  if (Date.now() > record.expiresAt) {
    await store.remove(code);
    return json(res, 404, { error: 'That story has expired.' });
  }
  json(res, 200, { code, expiresAt: record.expiresAt, performance: record.performance });
}

/** Replies live beside their story (same code, same expiry) as `${code}.reply-N`. */
async function loadRecord(code: string): Promise<{ expiresAt: number; performance: unknown } | null> {
  const text = await store.get(code);
  if (!text) return null;
  const record = JSON.parse(text) as { expiresAt: number; performance: unknown };
  return Date.now() > record.expiresAt ? null : record;
}

async function replyToStory(req: IncomingMessage, res: ServerResponse, raw: string): Promise<void> {
  if (!allowed('upload', clientIp(req))) return json(res, 429, { error: 'Too many uploads. Try again later.' });
  const code = normaliseCode(decodeURIComponent(raw));
  const record = isCode(code) ? await loadRecord(code) : null;
  if (!record) return json(res, 404, { error: 'No story with that code.' });
  let slot = -1;
  for (let i = 0; i < MAX_REPLIES; i++) {
    if (!(await store.get(`${code}.reply-${i}`))) {
      slot = i;
      break;
    }
  }
  if (slot < 0) return json(res, 409, { error: 'This story already has all its goodnights.' });
  const body = await readBody(req, MAX_REPLY_BYTES);
  if (body === null) return json(res, 413, { error: 'That goodnight is too long.' });
  let perf: unknown;
  try {
    perf = JSON.parse(body);
  } catch {
    return json(res, 400, { error: 'Not a goodnight.' });
  }
  if (!validPerformance(perf)) return json(res, 400, { error: 'Not a Shadowplay goodnight.' });
  await store.put(`${code}.reply-${slot}`, JSON.stringify({ storedAt: Date.now(), expiresAt: record.expiresAt, performance: perf }));
  json(res, 201, { ok: true });
}

async function listReplies(req: IncomingMessage, res: ServerResponse, raw: string): Promise<void> {
  if (!allowed('lookup', clientIp(req))) return json(res, 429, { error: 'Too many tries. Wait a minute.' });
  const code = normaliseCode(decodeURIComponent(raw));
  if (!isCode(code) || !(await loadRecord(code))) return json(res, 404, { error: 'No story with that code.' });
  const replies: unknown[] = [];
  for (let i = 0; i < MAX_REPLIES; i++) {
    const text = await store.get(`${code}.reply-${i}`);
    if (text) replies.push((JSON.parse(text) as { performance: unknown }).performance);
  }
  json(res, 200, { code, replies });
}

// ---------------------------------------------------------------- static app

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.uikitml': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
  let file = join(STATIC_DIR, safe);
  if (!file.startsWith(STATIC_DIR)) return json(res, 404, { error: 'Not found' });
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(STATIC_DIR, 'index.html'); // app routes fall back to the app
  }
  try {
    const info = await stat(file);
    const hashed = /\/assets\//.test(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    createReadStream(file).pipe(res);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

// ---------------------------------------------------------------- server

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.pathname;
  const route = async () => {
    if (path === '/api/health') return json(res, 200, { ok: true, liveRooms: liveRoomCount() });
    if (path === '/api/stories' && req.method === 'POST') return uploadStory(req, res);
    const m = /^\/api\/stories\/([^/]+)$/.exec(path);
    if (m && req.method === 'GET') return fetchStory(req, res, m[1]);
    const r = /^\/api\/stories\/([^/]+)\/replies$/.exec(path);
    if (r && req.method === 'POST') return replyToStory(req, res, r[1]);
    if (r && req.method === 'GET') return listReplies(req, res, r[1]);
    if (path.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    return serveStatic(req, res, path);
  };
  route().catch((error: unknown) => {
    console.error('[server]', error);
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong.' });
  });
});

/** Expired stories are removed hourly (files older than the TTL). */
async function sweep(): Promise<void> {
  const cutoff = Date.now() - TTL_DAYS * 86_400_000;
  for (const code of await store.olderThan(cutoff)) await store.remove(code);
}
setInterval(() => void sweep(), 3600_000).unref();
void sweep();

attachLive(server);
server.listen(PORT, () => console.log(`[server] Shadowplay on :${PORT} (stories in ${BUCKET ? `gs://${BUCKET}` : DATA_DIR})`));
