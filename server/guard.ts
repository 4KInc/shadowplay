import type { IncomingMessage } from 'node:http';

/**
 * Trust boundaries for the public server: who a request comes from, how often
 * they may ask, and what a shared story may contain.
 */

/**
 * The client's address. Behind Google's front end (Cloud Run) X-Forwarded-For
 * is "<whatever the client sent>, <real client address>": the client controls
 * every entry but the last one the platform appended, so only the entry
 * TRUSTED_HOPS from the right is believed. Without a proxy, the socket address.
 */
export function clientIp(req: IncomingMessage, trustedHops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0)): string {
  if (trustedHops > 0) {
    const header = req.headers['x-forwarded-for'];
    const list = (Array.isArray(header) ? header.join(',') : header ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const ip = list[list.length - trustedHops];
    if (ip) return ip;
  }
  return req.socket.remoteAddress ?? '?';
}

/** Fixed-window counters per key, pruned so the map cannot grow without bound. */
export class RateLimiter {
  private windows = new Map<string, { count: number; reset: number }>();
  private per: number;
  private max: number;

  constructor(per: number, max: number) {
    this.per = per;
    this.max = max;
  }

  allow(key: string, now = Date.now()): boolean {
    const w = this.windows.get(key);
    if (!w || now > w.reset) {
      if (this.windows.size > 50_000) this.prune(now);
      this.windows.set(key, { count: 1, reset: now + this.per });
      return true;
    }
    w.count++;
    return w.count <= this.max;
  }

  prune(now = Date.now()): void {
    for (const [key, w] of this.windows) if (now > w.reset) this.windows.delete(key);
  }

  get size(): number {
    return this.windows.size;
  }
}

/** A token bucket for message streams (per socket): steady `rate` per second, bursts up to `burst`. */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  private rate: number;
  private burst: number;

  constructor(rate: number, burst: number) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
  }

  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}

// ---------------------------------------------------------------- shared stories

export const PERFORMANCE_VERSION = 'shadowplay.performance.v1';
/** int16 values per hand frame: presence flags + 25 joints x 3 x 2 hands (src/performance/format.ts). */
const FRAME_STRIDE = 151;
const MAX_MINUTES = 16;
const EVENT_TYPES = new Set(['snapshot', 'beat', 'wake', 'release', 'lamp', 'stage']);
const SCRIPT_PATH = /^story\/[a-z0-9-]{1,40}\.story\.json$/;

function shortString(v: unknown, max: number): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.length <= max);
}

/**
 * A story is accepted only if it looks exactly like one the app records: a
 * hand stream whose length matches its frame count, a bounded list of small
 * events, short names, a known story script and an audio data URL. Anything
 * else is refused before it reaches storage or a family's device.
 * Returns an error message, or null when valid.
 */
export function checkPerformance(p: unknown, maxAudioChars: number): string | null {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'Not a story.';
  const o = p as Record<string, unknown>;
  if (o.version !== PERFORMANCE_VERSION) return 'Not a Shadowplay story.';
  const durationMs = o.durationMs;
  const frameCount = o.frameCount;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_MINUTES * 60_000) {
    return 'Story too long.';
  }
  if (!Number.isInteger(frameCount) || (frameCount as number) < 0 || (frameCount as number) > MAX_MINUTES * 60 * 30) {
    return 'Bad hand recording.';
  }
  // Base64 of frameCount frames of FRAME_STRIDE int16 values.
  const expected = Math.ceil(((frameCount as number) * FRAME_STRIDE * 2) / 3) * 4;
  if (typeof o.hands !== 'string' || o.hands.length !== expected || !/^[A-Za-z0-9+/]*={0,2}$/.test(o.hands)) {
    return 'Bad hand recording.';
  }
  if (!Array.isArray(o.events) || o.events.length > 20_000) return 'Bad story events.';
  for (const e of o.events) {
    if (!e || typeof e !== 'object') return 'Bad story events.';
    const ev = e as Record<string, unknown>;
    if (typeof ev.t !== 'number' || ev.t < 0 || ev.t > durationMs + 60_000) return 'Bad story events.';
    if (typeof ev.type !== 'string' || !EVENT_TYPES.has(ev.type)) return 'Bad story events.';
    if (!ev.data || typeof ev.data !== 'object' || Array.isArray(ev.data)) return 'Bad story events.';
    const entries = Object.entries(ev.data as Record<string, unknown>);
    if (entries.length > 24) return 'Bad story events.';
    for (const [k, v] of entries) {
      if (k.length > 32) return 'Bad story events.';
      const t = typeof v;
      if (!(t === 'number' || t === 'boolean' || (t === 'string' && (v as string).length <= 64))) return 'Bad story events.';
    }
  }
  for (const [field, max] of [['id', 64], ['title', 80], ['performer', 40], ['child', 40], ['audioType', 64], ['shareCode', 40], ['replyTo', 40]] as const) {
    if (!shortString(o[field], max)) return 'Bad story details.';
  }
  if (!(o.script === undefined || o.script === '' || (typeof o.script === 'string' && SCRIPT_PATH.test(o.script)))) {
    return 'Unknown story.';
  }
  if (!(o.audio === undefined || o.audio === null)) {
    if (typeof o.audio !== 'string' || !/^data:audio\/[a-z0-9.+-]+(;[a-z0-9=.+-]+)*;base64,/i.test(o.audio)) return 'Bad voice recording.';
    if (o.audio.length > maxAudioChars) return 'Voice recording too long.';
  }
  return null;
}

/** decodeURIComponent that answers null instead of throwing on a malformed escape. */
export function decodeSafe(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
