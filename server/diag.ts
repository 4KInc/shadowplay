import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Device diagnostics (only from pages opened with ?diag): compact JSON
 * snapshots and events, appended as one line each to
 * diag/<date>/<session>.jsonl (local disk, or Cloud Storage in production).
 *
 * Only numbers, booleans and short identifiers are accepted, plus the text of
 * error messages and stacks. Nothing personal: no audio, video, names or
 * family codes (the client never sends them; anything that does not fit this
 * shape is refused).
 */

const SESSION = /^[a-z0-9]{8,32}$/;
/** Short identifiers: shapes, beat ids, enums, a GPU name. */
const SAFE = /^[\w .:/()+,-]{0,64}$/;
const MAX_ITEMS = 40;
const MAX_KEYS = 48;

/** Fields that may carry longer free text (errors only). */
const TEXT_FIELDS = new Set(['message', 'stack', 'source']);
const MAX_TEXT = 2000;

function cleanValue(key: string, v: unknown, depth: number): unknown {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : undefined;
  if (typeof v === 'string') {
    if (TEXT_FIELDS.has(key)) return v.slice(0, MAX_TEXT).replace(/[^\x20-\x7e\n]/g, '?');
    return SAFE.test(v) ? v : undefined;
  }
  // An item's fields may hold one level of arrays or objects (frame rate lists), no deeper.
  if (depth >= 1) return undefined;
  if (Array.isArray(v)) {
    if (v.length > 16) return undefined;
    const out = v.map((x) => cleanValue('', x, depth + 1));
    return out.every((x) => x !== undefined) ? out : undefined;
  }
  if (typeof v === 'object') return cleanObject(v as Record<string, unknown>, depth + 1);
  return undefined;
}

function cleanObject(o: Record<string, unknown>, depth = 0): Record<string, unknown> | undefined {
  const keys = Object.keys(o);
  if (keys.length > MAX_KEYS) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (!/^[a-zA-Z][\w]{0,31}$/.test(k)) return undefined;
    const v = cleanValue(k, o[k], depth);
    if (v === undefined) return undefined;
    out[k] = v;
  }
  return out;
}

export interface DiagBatch {
  session: string;
  lines: string[];
}

/** Validate a posted batch; null if anything does not fit. */
export function checkDiag(body: unknown, now = Date.now()): DiagBatch | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.v !== 1 || typeof b.session !== 'string' || !SESSION.test(b.session)) return null;
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > MAX_ITEMS) return null;
  const head = cleanObject({ device: b.device ?? '', gpu: b.gpu ?? '', seq: b.seq ?? 0 });
  if (!head) return null;
  const lines: string[] = [];
  for (const item of b.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const clean = cleanObject(item as Record<string, unknown>);
    if (!clean || (clean.k !== 'snap' && clean.k !== 'ev')) return null;
    lines.push(JSON.stringify({ at: now, session: b.session, ...head, ...clean }));
  }
  return { session: b.session, lines };
}

export interface DiagSink {
  append(batch: DiagBatch, date: string): Promise<void>;
}

/** Local development: plain files under DATA_DIR/../diag. */
export class DiskDiagSink implements DiagSink {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async append(batch: DiagBatch, date: string): Promise<void> {
    const dir = join(this.dir, date);
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, `${batch.session}.jsonl`), batch.lines.join('\n') + '\n', 'utf8');
  }
}

/**
 * Cloud Storage objects cannot be appended to, so each session's lines are
 * kept in memory and the whole object is rewritten at most every FLUSH_MS
 * (sessions are small: a line every 5 s). One server instance, so one writer.
 */
export class BucketDiagSink implements DiagSink {
  private sessions = new Map<string, { date: string; lines: string[]; dirty: boolean; touched: number }>();
  private timer: NodeJS.Timeout;
  private put: (name: string, body: string) => Promise<void>;

  constructor(put: (name: string, body: string) => Promise<void>, flushMs = 15_000) {
    this.put = put;
    this.timer = setInterval(() => void this.flush(), flushMs);
    this.timer.unref();
  }

  async append(batch: DiagBatch, date: string): Promise<void> {
    const s = this.sessions.get(batch.session) ?? { date, lines: [], dirty: false, touched: 0 };
    // A session that runs for hours keeps its newest lines.
    s.lines.push(...batch.lines);
    if (s.lines.length > 5000) s.lines.splice(0, s.lines.length - 5000);
    s.dirty = true;
    s.touched = Date.now();
    this.sessions.set(batch.session, s);
  }

  async flush(): Promise<void> {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (s.dirty) {
        s.dirty = false;
        await this.put(`diag/${s.date}/${id}.jsonl`, s.lines.join('\n') + '\n').catch((e) => {
          s.dirty = true;
          console.error('[diag] write failed', (e as Error).message);
        });
      }
      // Quiet for an hour and written: forget it.
      if (!s.dirty && now - s.touched > 3600_000) this.sessions.delete(id);
    }
  }
}
