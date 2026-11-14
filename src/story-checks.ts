/**
 * Content checks shared by Mo's tips, dreamed stories (server) and shared dreamed
 * stories (server on upload, the app before playing). No imports, so both can use it.
 * On top of each one's own checks:
 * no well-known characters or brands (the competition's no-brands rule), Mo is
 * "she" (as in the library stories), and no hand position that belongs to a
 * different shape (a model sometimes tells a child to cross their wrists, or to
 * cup their hands for a dog).
 */

/** Well-known characters and brands a model might reach for in a bedtime story. */
const BRANDS =
  /\b(snoopy|mickey|minnie|disney|pixar|pokemon|pikachu|elsa|frozen|peppa|bluey|spongebob|barbie|lego|minecraft|marvel|batman|superman|spider-?man|elmo|sesame|winnie|pooh|tigger|dumbo|bambi|nemo|simba|paw patrol|cocomelon|hello kitty|garfield|scooby|looney|bugs bunny|peter rabbit|clifford|paddington|gruffalo|meta|google)\b/i;

/** Mo called "he": the stories say "she". */
const MO_HE = /\bMo\b[^.!?]*\b(he|his|him|himself)\b/i;

/** Hand positions no shape here uses, and ones that belong only to two-hand or cupped shapes. */
const NEVER_POSE = /\bcross(ed|ing)? (your |the |their )?(wrists|hands|arms|fingers)\b/i;
const TWO_HAND_POSE = /\b(both hands|two hands|side by side|thumbs? (hooked|linked|together)|hook(ed)? (your )?thumbs|link(ed)? (your )?thumbs)\b/i;
const CUPPED_POSE = /\bcupp?(ed)?\b/i;

/** Problems with a line (empty when it is fine). `shape` is the shape the line is about, if any. */
export function contentProblems(line: string, shape?: string): string[] {
  const problems: string[] = [];
  if (BRANDS.test(line)) problems.push('brand or character');
  if (MO_HE.test(line)) problems.push('Mo is "she"');
  if (NEVER_POSE.test(line)) problems.push('crossed hands');
  if (shape && shape !== 'bird' && shape !== 'cup' && TWO_HAND_POSE.test(line)) problems.push(`two-hand pose for a ${shape}`);
  if (shape && shape !== 'cup' && CUPPED_POSE.test(line)) problems.push(`cupped hands for a ${shape}`);
  return problems;
}

// ------------------------------------------------------------------ shared dreamed stories

/** A dreamed story travels inside a recording or a live story: every line is plain words... */
const PLAIN = /^[A-Za-z0-9 ,.!?'’;:-]{1,200}$/;
const BEAT_ID = /^[a-z0-9-]{1,40}$/;
/** ...and it can only be made of what Mo's dreams are made of (server/dream.ts). */
const SHAPES = new Set(['rabbit', 'fish', 'dog', 'bird', 'cup', 'snail', 'swan', 'deer', 'crocodile']);
const SCENERY = new Set(['none', 'field', 'river', 'forest', 'storm', 'sea']);
const MOTH = new Set(['hidden', 'arriving', 'hovering', 'following', 'riding', 'resting']);
const MAX_BEATS = 80;

type Beat = Record<string, unknown>;

const num = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const line = (v: unknown, shape?: string): v is string => typeof v === 'string' && PLAIN.test(v) && contentProblems(v, shape).length === 0;

/**
 * A dreamed story received from another device (a recording or a live story),
 * checked again and rebuilt from known fields only: a clean copy, or null when
 * anything is off. Used by the server on upload and by the app before playing.
 */
export function checkSharedStory(input: unknown): { version: 'shadowplay.story.v1'; title: string; dreamed: true; beats: Beat[] } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const s = input as Record<string, unknown>;
  if (s.version !== 'shadowplay.story.v1' || !line(s.title) || (s.title as string).length > 80) return null;
  if (!Array.isArray(s.beats) || s.beats.length < 1 || s.beats.length > MAX_BEATS) return null;
  const ids = new Set<string>();
  const beats: Beat[] = [];
  for (const raw of s.beats) {
    if (!raw || typeof raw !== 'object') return null;
    const b = raw as Beat;
    if (typeof b.id !== 'string' || !BEAT_ID.test(b.id) || ids.has(b.id)) return null;
    ids.add(b.id);
    const out: Beat = { id: b.id, type: b.type };
    switch (b.type) {
      case 'chapter':
        if (!line(b.chapter) || !line(b.text)) return null;
        Object.assign(out, { chapter: b.chapter, text: b.text });
        break;
      case 'narrate': case 'release': case 'letgo': case 'end':
        if (!line(b.text)) return null;
        out.text = b.text;
        break;
      case 'lamp':
        if (!num(b.level, 0, 1)) return null;
        out.level = b.level;
        break;
      case 'scenery':
        if (typeof b.set !== 'string' || !SCENERY.has(b.set)) return null;
        out.set = b.set;
        break;
      case 'moth':
        if (typeof b.mode !== 'string' || !MOTH.has(b.mode)) return null;
        out.mode = b.mode;
        for (const k of ['restU', 'restV'] as const) {
          if (b[k] === undefined) continue;
          if (!num(b[k], -1, 1)) return null;
          out[k] = b[k];
        }
        break;
      case 'follow':
        if (!num(b.seconds, 0, 10) || !line(b.text)) return null;
        Object.assign(out, { seconds: b.seconds, text: b.text });
        break;
      case 'request':
        if (typeof b.shape !== 'string' || !SHAPES.has(b.shape) || !line(b.text, b.shape)) return null;
        if (b.alt !== undefined && (typeof b.alt !== 'string' || !SHAPES.has(b.alt))) return null;
        Object.assign(out, { shape: b.shape, text: b.text }, b.alt !== undefined ? { alt: b.alt } : {});
        break;
      case 'carry':
        if (!num(b.toU, -1, 1) || !line(b.text) || (b.minV !== undefined && !num(b.minV, -1, 1))) return null;
        Object.assign(out, { toU: b.toU, text: b.text }, b.minV !== undefined ? { minV: b.minV } : {});
        break;
      case 'finale':
        if (!num(b.seconds, 0, 10)) return null;
        out.seconds = b.seconds;
        break;
      default:
        return null;
    }
    beats.push(out);
  }
  if (beats[beats.length - 1]?.type !== 'end') return null;
  return { version: 'shadowplay.story.v1', title: s.title as string, dreamed: true, beats };
}
