import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { isCode, newCode, normaliseCode } from './codes.ts';
import { BucketDiagSink, checkDiag, DiskDiagSink, type DiagSink } from './diag.ts';
import { checkPerformance, clientIp, decodeSafe, RateLimiter } from './guard.ts';
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
 *   POST /api/diag           device diagnostics from pages opened with ?diag (numbers and ids only)
 *   GET  /api/health, /healthz
 *   WS   /live                live rooms (see live.ts)
 */
const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = process.env.STATIC_DIR ?? join(process.cwd(), 'dist');
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), '.data/stories');
const MAX_BYTES = Number(process.env.MAX_STORY_BYTES ?? 30 * 1024 * 1024);
const TTL_DAYS = Number(process.env.STORY_TTL_DAYS ?? 30);
const MAX_REPLIES = 5;
/** Replies are short: a goodnight, not a second story. */
const MAX_REPLY_BYTES = Number(process.env.MAX_REPLY_BYTES ?? 6 * 1024 * 1024);

/** STORY_BUCKET (production): a Cloud Storage bucket; otherwise local disk. */
const BUCKET = process.env.STORY_BUCKET ?? '';
const bucket = BUCKET ? new GcsStore(BUCKET, process.env.STORAGE_API ?? undefined, process.env.STORAGE_TOKEN_URL ?? undefined) : null;
const store: StoryStore = bucket ?? new DiskStore(DATA_DIR);
const diagSink: DiagSink = bucket
  ? new BucketDiagSink((name, body) => bucket.putRaw(name, body))
  : new DiskDiagSink(process.env.DIAG_DIR ?? join(process.cwd(), '.data/diag'));
const MAX_DIAG_BYTES = 32 * 1024;

// ---------------------------------------------------------------- rate limiting

/** Per client address: uploads are rare, lookups a little more frequent (this also guards the code space). */
const limits = {
  upload: new RateLimiter(3600_000, 20),
  lookup: new RateLimiter(60_000, 30),
  // Diagnostics: a snapshot every 5 s plus events (batched), from one headset.
  diag: new RateLimiter(60_000, 60),
};

function allowed(kind: keyof typeof limits, req: IncomingMessage): boolean {
  const ip = clientIp(req);
  if (limits[kind].allow(ip)) return true;
  // Masked: enough to see that limits key on real client addresses, not enough to identify anyone.
  const masked = ip.includes(':') ? `${ip.split(':').slice(0, 3).join(':')}::x` : ip.replace(/\.\d+$/, '.x');
  console.warn(`[limit] ${kind} refused for ${masked}`);
  return false;
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

/** Keep only the fields the app records (never store or hand back anything extra). */
const STORY_FIELDS = [
  'version', 'id', 'title', 'performer', 'child', 'createdAt', 'durationMs', 'script', 'frameHz',
  'hands', 'frameCount', 'events', 'audio', 'audioType',
] as const;

function pick(perf: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of STORY_FIELDS) if (perf[k] !== undefined) out[k] = perf[k];
  return out;
}

/** Parse and check a story body; answers the story or sends the error itself. */
async function readStory(req: IncomingMessage, res: ServerResponse, limit: number): Promise<Record<string, unknown> | null> {
  const body = await readBody(req, limit);
  if (body === null) {
    json(res, 413, { error: 'Story too large.' });
    return null;
  }
  let perf: unknown;
  try {
    perf = JSON.parse(body);
  } catch {
    json(res, 400, { error: 'Not a story.' });
    return null;
  }
  // Base64 grows audio by a third; leave room for the rest of the story.
  const problem = checkPerformance(perf, Math.floor(limit * 0.95));
  if (problem) {
    json(res, 400, { error: problem });
    return null;
  }
  return pick(perf as Record<string, unknown>);
}

/** Codes from the URL: decoded, normalised and checked, or null. */
function codeFrom(raw: string): string | null {
  const decoded = decodeSafe(raw);
  const code = decoded === null ? '' : normaliseCode(decoded);
  return isCode(code) ? code : null;
}

/** One reply write at a time per story, so two goodnights never take the same slot. */
const replyLocks = new Map<string, Promise<unknown>>();
function withReplyLock<T>(code: string, fn: () => Promise<T>): Promise<T> {
  const run = (replyLocks.get(code) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  replyLocks.set(code, tail);
  void tail.then(() => replyLocks.get(code) === tail && replyLocks.delete(code));
  return run;
}

// ---------------------------------------------------------------- API

async function uploadStory(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!allowed('upload', req)) return json(res, 429, { error: 'Too many uploads. Try again later.' });
  const perf = await readStory(req, res, MAX_BYTES);
  if (!perf) return;
  let code = newCode();
  while (await store.get(code)) code = newCode();
  const expiresAt = Date.now() + TTL_DAYS * 86_400_000;
  await store.put(code, JSON.stringify({ storedAt: Date.now(), expiresAt, performance: perf }));
  json(res, 201, { code, expiresAt });
}

async function fetchStory(req: IncomingMessage, res: ServerResponse, raw: string): Promise<void> {
  if (!allowed('lookup', req)) return json(res, 429, { error: 'Too many tries. Wait a minute.' });
  const code = codeFrom(raw);
  if (!code) return json(res, 404, { error: 'No story with that code.' });
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
  if (!allowed('upload', req)) return json(res, 429, { error: 'Too many uploads. Try again later.' });
  const code = codeFrom(raw);
  const record = code ? await loadRecord(code) : null;
  if (!code || !record) return json(res, 404, { error: 'No story with that code.' });
  const perf = await readStory(req, res, MAX_REPLY_BYTES);
  if (!perf) return;
  await withReplyLock(code, async () => {
    for (let i = 0; i < MAX_REPLIES; i++) {
      if (await store.get(`${code}.reply-${i}`)) continue;
      await store.put(`${code}.reply-${i}`, JSON.stringify({ storedAt: Date.now(), expiresAt: record.expiresAt, performance: perf }));
      return json(res, 201, { ok: true });
    }
    json(res, 409, { error: 'This story already has all its goodnights.' });
  });
}

async function listReplies(req: IncomingMessage, res: ServerResponse, raw: string): Promise<void> {
  if (!allowed('lookup', req)) return json(res, 429, { error: 'Too many tries. Wait a minute.' });
  const code = codeFrom(raw);
  if (!code || !(await loadRecord(code))) return json(res, 404, { error: 'No story with that code.' });
  const replies: unknown[] = [];
  for (let i = 0; i < MAX_REPLIES; i++) {
    const text = await store.get(`${code}.reply-${i}`);
    if (text) replies.push((JSON.parse(text) as { performance: unknown }).performance);
  }
  json(res, 200, { code, replies });
}

async function postDiag(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!allowed('diag', req)) return json(res, 429, { error: 'Too many diagnostics.' });
  const body = await readBody(req, MAX_DIAG_BYTES);
  if (body === null) return json(res, 413, { error: 'Too large.' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(res, 400, { error: 'Not diagnostics.' });
  }
  const batch = checkDiag(parsed);
  if (!batch) return json(res, 400, { error: 'Not diagnostics.' });
  await diagSink.append(batch, new Date().toISOString().slice(0, 10));
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
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
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + sep)) return json(res, 404, { error: 'Not found' });
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
    if (path === '/api/health' || path === '/healthz') return json(res, 200, { ok: true, liveRooms: liveRoomCount() });
    if (path === '/api/diag' && req.method === 'POST') return postDiag(req, res);
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
  limits.upload.prune();
  limits.lookup.prune();
  limits.diag.prune();
}
setInterval(() => void sweep(), 3600_000).unref();
void sweep();

attachLive(server);
server.listen(PORT, () => console.log(`[server] Shadowplay on :${PORT} (stories in ${BUCKET ? `gs://${BUCKET}` : DATA_DIR})`));
