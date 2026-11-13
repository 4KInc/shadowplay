/**
 * The one model call Mo's tips and dreamed stories make: a single-turn
 * Messages request (system + one user message) that returns text. Two
 * providers speak this format:
 *
 *   anthropic  Claude, api.anthropic.com: x-api-key and anthropic-version headers.
 *   meta       Muse Spark on Meta Model API, api.meta.ai: its Messages-compatible
 *              endpoint takes a Bearer token and refuses the anthropic-version
 *              header (dev.meta.ai/docs/protocols/messages). Muse Spark is a
 *              reasoning model: effort is set per call and its reasoning counts
 *              against max_tokens, so each call gets room for both.
 */

export type Provider = 'anthropic' | 'meta';

export interface LlmCall {
  model: string;
  system: string;
  user: string;
  /** Room for the answer itself (reasoning room is added for Muse Spark). */
  maxTokens: number;
  /** Muse Spark reasoning effort: 'low' for a quick tip, 'medium' for a story. */
  effort: 'low' | 'medium' | 'high';
  timeoutMs: number;
}

/** Reasoning room per effort level (Muse Spark only). */
const REASONING_TOKENS = { low: 1024, medium: 3072, high: 6144 } as const;

export const DEFAULTS: Readonly<Record<Provider, { api: string; coachModel: string; dreamModel: string; label: string }>> = {
  anthropic: { api: 'https://api.anthropic.com', coachModel: 'claude-haiku-4-5-20251001', dreamModel: 'claude-sonnet-5-5', label: 'claude' },
  meta: { api: 'https://api.meta.ai', coachModel: 'muse-spark-1.3', dreamModel: 'muse-spark-1.3', label: 'muse-spark' },
};

export class Llm {
  readonly provider: Provider;
  private key: string;
  private api: string;

  constructor(provider: Provider, key: string, api?: string) {
    this.provider = provider;
    this.key = key;
    this.api = api ?? DEFAULTS[provider].api;
  }

  /** What answers, for /api/coach and /api/dream ('claude' or 'muse-spark'). */
  get label(): string {
    return DEFAULTS[this.provider].label;
  }

  /** The reply's text (every text block, in order); throws on an HTTP error. */
  async text(call: LlmCall): Promise<string> {
    const meta = this.provider === 'meta';
    const headers: Record<string, string> = meta
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` }
      : { 'Content-Type': 'application/json', 'x-api-key': this.key, 'anthropic-version': '2023-06-01' };
    const body: Record<string, unknown> = {
      model: call.model,
      max_tokens: meta ? call.maxTokens + REASONING_TOKENS[call.effort] : call.maxTokens,
      system: call.system,
      messages: [{ role: 'user', content: call.user }],
    };
    if (meta) {
      body.thinking = { type: 'adaptive' };
      body.output_config = { effort: call.effort };
    }
    const res = await fetch(`${this.api}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(call.timeoutMs),
    });
    if (!res.ok) throw new Error(`${this.label} ${res.status}`);
    const reply = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (reply.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
  }
}
