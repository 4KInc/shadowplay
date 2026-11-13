/**
 * What Mo the coach knows about a struggling player: which shape the story is
 * asking for, and what about the tracked hands is furthest from it, as a few
 * fixed fact ids. Pure (no ECS, no DOM): the server builds Mo's words only from
 * these ids, never from free text, and the app can phrase them itself when no
 * AI is available.
 */
import { BIRD_MAX_CURL, BIRD_WRIST_GAP } from './recognition-rules.js';
import { TEMPLATES } from './hand-features.js';

export { COACHED_SHAPES, FACTS, localLine } from './coach-vocab.js';

export interface CoachHand {
  tracked: boolean;
  /** 25 joints x (x, y, z), world space (only the wrists are read). */
  joints: Float32Array;
  /** The 9 joint-angle features (hand-features.ts). */
  features: Float32Array;
}

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

/** A weighted miss smaller than this is not worth mentioning. */
const MIN_MISS = 0.18;

function featureFact(i: number, have: number, want: number): string {
  const more = want > have;
  if (i < 5) return `${FINGERS[i]}-${more ? 'curl' : 'straighten'}`;
  if (i === 5) return more ? 'fingers-apart' : 'fingers-together';
  if (i === 6) return more ? 'thumb-touch' : 'thumb-off';
  if (i === 7) return more ? 'thumb-out' : 'thumb-tuck';
  return want > 0.75 ? 'point-up' : want < 0.25 ? 'point-down' : 'point-level';
}

/** The (up to) two biggest weighted misses of one hand against a shape's template, biggest first. */
export function handFacts(features: Float32Array, shape: string): string[] {
  const t = TEMPLATES.find((x) => x.id === shape);
  if (!t) return [];
  const misses: [number, string][] = [];
  for (let i = 0; i < t.value.length; i++) {
    const miss = t.weight[i] * Math.abs(features[i] - t.value[i]);
    if (miss >= MIN_MISS) misses.push([miss, featureFact(i, features[i], t.value[i])]);
  }
  misses.sort((a, b) => b[0] - a[0]);
  return misses.length ? misses.slice(0, 2).map(([, f]) => f) : ['almost'];
}

function templateMiss(features: Float32Array, shape: string): number {
  const t = TEMPLATES.find((x) => x.id === shape);
  if (!t) return Infinity;
  let err = 0;
  for (let i = 0; i < t.value.length; i++) err += t.weight[i] * Math.abs(features[i] - t.value[i]);
  return err;
}

const meanCurl = (f: Float32Array) => (f[1] + f[2] + f[3] + f[4]) / 4;

/** What Mo should know about the player's hands, for the shape asked for. */
export function coachFacts(shape: string, left: CoachHand, right: CoachHand, oneHand = false): string[] {
  const hands = [left, right].filter((h) => h.tracked);
  if (!hands.length) return ['no-hands'];
  if (shape === 'bird' && !oneHand) {
    if (hands.length < 2) return ['one-hand-seen'];
    const dx = left.joints[0] - right.joints[0];
    const dy = left.joints[1] - right.joints[1];
    const dz = left.joints[2] - right.joints[2];
    const facts: string[] = [];
    if (Math.max(meanCurl(left.features), meanCurl(right.features)) > BIRD_MAX_CURL) facts.push('fingers-curled');
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) >= BIRD_WRIST_GAP) facts.push('hands-apart');
    else if (Math.abs(dy) > Math.sqrt(dx * dx + dz * dz)) facts.push('hands-stacked');
    return facts.length ? facts.slice(0, 2) : ['almost'];
  }
  // One-hand bird: an open hand. Otherwise the hand nearest the shape.
  const target = shape === 'bird' ? 'open' : shape;
  const best = hands.reduce((a, b) => (templateMiss(b.features, target) < templateMiss(a.features, target) ? b : a));
  return handFacts(best.features, target);
}
