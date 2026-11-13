/**
 * Mo the coach: one short, kind tip in Mo's voice for a player who is stuck on
 * a shape, written by Claude from what the hand tracker noticed. The request
 * carries only a shape name and fact ids from a fixed list (coach-vocab.ts),
 * never free text or anything about the person, so nothing personal reaches
 * the model and nothing can be injected into the prompt. Every reply is
 * checked (length, plain words) and replaced by a fixed line if it fails.
 *
 * On when ANTHROPIC_API_KEY is set. ANTHROPIC_API points it at a test double.
 */
import { FACTS, localLine } from '../src/coach-vocab.ts';

export const COACH_SHAPES = new Set(['rabbit', 'dog', 'fish', 'bird', 'cup', 'snail', 'swan', 'deer', 'crocodile']);
const MAX_WORDS = 20;
const LINE = /^[A-Za-z0-9 ,.!?'’;:-]{8,140}$/;
/** Words Mo never says (a cheap last check after the model's own care). */
const NEVER = /\b(kill|die|dead|blood|hate|stupid|dumb|ugly|scary|monster|password|address|phone|email|http|www)\b/i;

const SYSTEM = [
  'You are Mo, a small, gentle moth in a bedtime shadow-puppet story.',
  'Someone (a child of 10 or older, or a grown-up) is trying to make a hand shadow shape for the story and is stuck.',
  'You are told the shape and what the hand tracker noticed about their hands.',
  'Reply with exactly one short, warm, encouraging tip in your own voice that tells them the one change to make, using the words a child understands (index finger, thumb, wrists).',
  'At most 18 words. Plain words only: no emojis, no quotation marks, no lists, no questions about the person, no names, no brands.',
  'Never mention cameras, tracking, sensors or technology; talk about their hands and the shadow.',
  'Output only the line.',
].join(' ');

export interface CoachRequest {
  shape: string;
  facts: string[];
  /** 0 for the first tip on this request, 1, 2... for later ones (say it differently). */
  attempt: number;
}

/** A coach request from untrusted JSON, or null. */
export function checkCoach(body: unknown): CoachRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.shape !== 'string' || !COACH_SHAPES.has(b.shape)) return null;
  if (!Array.isArray(b.facts) || b.facts.length < 1 || b.facts.length > 2) return null;
  if (!b.facts.every((f) => typeof f === 'string' && Object.hasOwn(FACTS, f))) return null;
  const attempt = typeof b.attempt === 'number' && Number.isInteger(b.attempt) ? Math.min(5, Math.max(0, b.attempt)) : 0;
  return { shape: b.shape, facts: b.facts as string[], attempt };
}

/** The model's reply as a line Mo may say, or null. */
export function cleanLine(text: string): string | null {
  const line = text.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').replace(/\s+/g, ' ');
  if (!LINE.test(line) || NEVER.test(line) || line.split(' ').length > MAX_WORDS) return null;
  return line;
}

export class Coach {
  private cache = new Map<string, string>();
  private key: string;
  private api: string;
  private model: string;

  constructor(key: string, api = 'https://api.anthropic.com', model = 'claude-haiku-4-5-20251001') {
    this.key = key;
    this.api = api;
    this.model = model;
  }

  /** Mo's line and where it came from ('ai', or 'local' when the model failed or said something unusable). */
  async tip(req: CoachRequest): Promise<{ line: string; source: 'ai' | 'local' }> {
    const cacheKey = `${req.shape}|${req.facts.join(',')}|${req.attempt}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return { line: cached, source: 'ai' };
    try {
      const noticed = req.facts.map((f) => `- ${FACTS[f]}`).join('\n');
      const again = req.attempt > 0 ? `\nThis is tip number ${req.attempt + 1} for this shape tonight: say it in a new way.` : '';
      const res = await fetch(`${this.api}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 80,
          system: SYSTEM,
          messages: [{ role: 'user', content: `Shape: ${req.shape}\nWhat the hand tracker noticed:\n${noticed}${again}` }],
        }),
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) throw new Error(`claude ${res.status}`);
      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      const line = cleanLine(body.content?.find((c) => c.type === 'text')?.text ?? '');
      if (!line) return { line: localLine(req.shape, req.facts), source: 'local' };
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(cacheKey, line);
      return { line, source: 'ai' };
    } catch (error) {
      console.warn('[coach]', error instanceof Error ? error.message : error);
      return { line: localLine(req.shape, req.facts), source: 'local' };
    }
  }
}
