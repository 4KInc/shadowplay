/**
 * "Dream up a new story": Claude writes the words of a new short bedtime story
 * for the shapes and theme the app picks; the server builds the story itself
 * (the same pattern as Counting Stars: Mo follows a finger, then for each shape
 * a request, a ride across the stage and a bow, then the finale), so the model
 * only ever supplies lines of narration. The request carries only a theme id
 * and shape ids from fixed lists. Every line is checked (length, plain words,
 * the shape's name in its request, a never-say list); a story that fails is
 * refused rather than shown.
 *
 * On when ANTHROPIC_API_KEY is set (DREAM_MODEL picks the model).
 */

export const DREAM_SHAPES = ['rabbit', 'fish', 'dog', 'bird', 'cup'] as const;
export const THEMES: Readonly<Record<string, { words: string; scenery: string }>> = {
  sea: { words: 'by the quiet sea at night', scenery: 'sea' },
  forest: { words: 'in a sleepy forest', scenery: 'forest' },
  meadow: { words: 'in a meadow under the stars', scenery: 'field' },
  river: { words: 'along a slow, silver river', scenery: 'river' },
  rain: { words: 'on a night of soft, passing rain', scenery: 'storm' },
  sky: { words: 'high in the night sky among the clouds', scenery: 'none' },
};

const LINE = /^[A-Za-z0-9 ,.!?'’;:-]{2,160}$/;
const MAX_LINE_WORDS = 24;
const NEVER = /\b(kill|killed|die|dies|dead|death|blood|hate|stupid|dumb|ugly|monster|gun|knife|scream|screams|nightmare|lost forever|http|www)\b/i;
/** The shape's name (or how a child would say it) must appear in its request. */
const SHAPE_WORDS: Readonly<Record<string, RegExp>> = {
  rabbit: /\b(rabbit|bunny)\b/i,
  fish: /\bfish\b/i,
  dog: /\b(dog|puppy)\b/i,
  bird: /\bbird\b/i,
  cup: /\bcup/i,
};

export interface DreamRequest {
  theme: string;
  shapes: string[];
}

/** A dream request from untrusted JSON, or null. */
export function checkDream(body: unknown): DreamRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.theme !== 'string' || !Object.hasOwn(THEMES, b.theme)) return null;
  if (!Array.isArray(b.shapes) || b.shapes.length < 2 || b.shapes.length > 3) return null;
  if (new Set(b.shapes).size !== b.shapes.length) return null;
  if (!b.shapes.every((s) => typeof s === 'string' && (DREAM_SHAPES as readonly string[]).includes(s))) return null;
  return { theme: b.theme, shapes: b.shapes as string[] };
}

/** What the model is asked to write (and must return, exactly this shape). */
interface DreamWords {
  title: string;
  opening: [string, string];
  scenes: { shape: string; setup: string; ask: string; ride: string; after: string; bow: string }[];
  ending: [string, string];
}

const SYSTEM = [
  'You write the words of very short, gentle bedtime stories for a hand shadow-puppet game.',
  'The listener is a child of 10 or younger at bedtime, with a grown-up. The hero is Mo, a small moth who rides each shadow creature the child makes with their hands.',
  'Tone: calm, warm, sleepy, a little wonder. Mild peril at most, always resolved kindly. No other named characters, no brands, no real places, nothing scary.',
  'Every line is one or two short sentences, at most 22 words, plain words, no quotation marks, no emojis.',
  'Reply with JSON only, exactly in the shape asked for.',
].join(' ');

function prompt(req: DreamRequest): string {
  const scenes = req.shapes.map((s) => `{"shape":"${s}","setup":"...","ask":"...","ride":"...","after":"...","bow":"..."}`).join(',');
  return [
    `Write a new story set ${THEMES[req.theme].words}. In order, the child makes these shadow shapes: ${req.shapes.join(', ')}.`,
    'For each scene: setup = why Mo needs that creature now; ask = tells the child to make it with their hands, naming the shape (for the bird: two hands side by side; for the cup: cupped hands; for the fish: a flat hand, fingers together); ride = 2 to 6 words while Mo rides it across the stage; after = what they find; bow = the creature settles down to sleep.',
    'opening = two lines that begin the story; ending = two lines that say goodnight. title = 2 to 5 words.',
    `JSON: {"title":"...","opening":["...","..."],"scenes":[${scenes}],"ending":["...","..."]}`,
  ].join('\n');
}

function line(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().replace(/\s+/g, ' ');
  if (!LINE.test(t) || NEVER.test(t) || t.split(' ').length > MAX_LINE_WORDS) return null;
  return t;
}

/**
 * The model's reply (text) as a playable story for this request, or null when
 * anything about it is off. Pure, so tests and the sims can build stories from
 * canned replies.
 */
export function assembleStory(req: DreamRequest, reply: string): Record<string, unknown> | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let words: DreamWords;
  try {
    words = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  const title = line(words.title);
  const opening = Array.isArray(words.opening) ? words.opening.map(line) : [];
  const ending = Array.isArray(words.ending) ? words.ending.map(line) : [];
  if (!title || title.split(' ').length > 6 || opening.length !== 2 || ending.length !== 2 || [...opening, ...ending].includes(null)) return null;
  if (!Array.isArray(words.scenes) || words.scenes.length !== req.shapes.length) return null;

  const beats: Record<string, unknown>[] = [
    { id: 'dream-title', type: 'chapter', chapter: title, text: title },
    { id: 'dream-lamp', type: 'lamp', level: 1 },
    { id: 'dream-scenery', type: 'scenery', set: THEMES[req.theme].scenery },
    { id: 'dream-open-1', type: 'narrate', text: opening[0] },
    { id: 'dream-mo', type: 'moth', mode: 'arriving' },
    { id: 'dream-follow', type: 'follow', seconds: 3, text: 'Hold up your hand. Mo will follow your finger, slowly, slowly.' },
    { id: 'dream-open-2', type: 'narrate', text: opening[1] },
  ];
  for (let i = 0; i < req.shapes.length; i++) {
    const shape = req.shapes[i];
    const s = words.scenes[i] as Record<string, unknown>;
    const [setup, ask, ride, after, bow] = ['setup', 'ask', 'ride', 'after', 'bow'].map((k) => line(s?.[k]));
    if (s?.shape !== shape || !setup || !ask || !ride || !after || !bow) return null;
    if (!SHAPE_WORDS[shape].test(ask) || ride.split(' ').length > 8) return null;
    const n = i + 1;
    beats.push({ id: `dream-${n}-setup`, type: 'narrate', text: setup });
    beats.push({ id: `dream-${n}-want`, type: 'request', shape, ...(shape === 'fish' ? { alt: 'dog' } : {}), text: ask });
    if (shape === 'cup') {
      // Cupped hands hold something; they open to let it go (as in Counting Stars).
      beats.push({ id: `dream-${n}-after`, type: 'narrate', text: after });
      beats.push({ id: `dream-${n}-letgo`, type: 'letgo', text: bow });
      beats.push({ id: `dream-${n}-free`, type: 'release', text: ride });
    } else {
      beats.push({ id: `dream-${n}-ride`, type: 'moth', mode: 'riding' });
      beats.push({ id: `dream-${n}-carry`, type: 'carry', toU: 0.3, ...(shape === 'bird' ? { minV: 0.12 } : {}), text: ride });
      beats.push({ id: `dream-${n}-after`, type: 'narrate', text: after });
      beats.push({ id: `dream-${n}-bow`, type: 'release', text: bow });
    }
    beats.push({ id: `dream-${n}-dim`, type: 'lamp', level: Math.max(0.5, 0.9 - 0.15 * n) });
  }
  beats.push(
    { id: 'dream-rest', type: 'moth', mode: 'resting', restU: 0, restV: 0.1 },
    { id: 'dream-finale', type: 'finale', seconds: 4 },
    { id: 'dream-end-1', type: 'narrate', text: ending[0] },
    { id: 'dream-dim-last', type: 'lamp', level: 0.35 },
    { id: 'dream-end-2', type: 'narrate', text: ending[1] },
    { id: 'dream-mo-sleep', type: 'moth', mode: 'resting', restU: 0.1, restV: 0.15 },
    { id: 'dream-the-end', type: 'chapter', chapter: 'The End', text: 'The End' },
    { id: 'dream-end', type: 'end', text: 'The End' },
  );
  return { version: 'shadowplay.story.v1', title, dreamed: true, theme: req.theme, beats };
}

export class Dreamer {
  private key: string;
  private api: string;
  private model: string;

  constructor(key: string, api = 'https://api.anthropic.com', model = 'claude-sonnet-5-5') {
    this.key = key;
    this.api = api;
    this.model = model;
  }

  /** A new story, or null if the model's words did not pass (one retry). */
  async dream(req: DreamRequest): Promise<Record<string, unknown> | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${this.api}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: this.model, max_tokens: 1500, system: SYSTEM, messages: [{ role: 'user', content: prompt(req) }] }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`claude ${res.status}`);
      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      const story = assembleStory(req, body.content?.find((c) => c.type === 'text')?.text ?? '');
      if (story) return story;
    }
    return null;
  }
}
