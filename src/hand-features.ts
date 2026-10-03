import { ShapeIds } from './shadowplay-components.js';

/**
 * Joint-angle hand-shape features (recognition method 1 in the brief).
 * Pure functions over a 25-joint WebXR position array; no allocation.
 *
 * Feature vector:
 *   0-4 curl of thumb, index, middle, ring, pinky (0 = straight, 1 = curled)
 *   5   spread between index/middle/ring (0 = together, 1 = splayed)
 *   6   thumb tip touching middle or ring tip (1 = touching)
 *   7   thumb held out from the palm (0 = tucked along the index, 1 = out)
 *   8   index finger direction (1 = pointing up, 0.5 = level, 0 = down)
 */
export const FEATURE_COUNT = 9;

type ShapeId = (typeof ShapeIds)[keyof typeof ShapeIds];

export interface ShapeTemplate {
  id: ShapeId;
  /** Target value per feature. */
  value: readonly number[];
  /** Weight per feature; 0 means "don't care". */
  weight: readonly number[];
}

// Spread is calibrated: fingers held together still measure ~0.4 (knuckles fan
// slightly), a natural open hand ~0.7, deliberately splayed 1.
//                   thumb idx mid ring pinky spread touch thumbOut up
export const TEMPLATES: readonly ShapeTemplate[] = [
  {
    // Shadow rabbit: index + middle up as ears, thumb meets ring/middle tip.
    id: ShapeIds.Rabbit,
    value: [0.5, 0, 0, 1, 1, 0.5, 1, 0.5, 1],
    weight: [0, 1.6, 1.6, 1, 0.7, 0, 1.2, 0, 0.6],
  },
  {
    // Easier rabbit (accessibility alternative): two fingers up, thumb free.
    id: ShapeIds.Ears,
    value: [0.5, 0, 0, 1, 1, 0.5, 0, 0.5, 1],
    weight: [0, 1.6, 1.6, 1, 0.7, 0, 1.2, 0, 0.6],
  },
  {
    id: ShapeIds.Open,
    value: [0, 0, 0, 0, 0, 0.7, 0, 1, 0.5],
    weight: [0.4, 1, 1, 1, 1, 1, 0.6, 0.3, 0],
  },
  {
    // Shadow dog: flat fingers together as the snout, thumb up as the ear.
    id: ShapeIds.Dog,
    value: [0, 0, 0, 0, 0.4, 0.4, 0, 1, 0.5],
    weight: [0.6, 1, 1, 1, 0.4, 1.2, 0.8, 1.2, 1.0],
  },
  {
    // Shadow fish: flat hand, fingers together, thumb tucked along the side.
    id: ShapeIds.Fish,
    value: [0.3, 0, 0, 0, 0, 0.4, 0, 0, 0.5],
    weight: [0, 1, 1, 1, 0.8, 1.2, 0.5, 1.2, 0.6],
  },
  {
    // Hidden swan: the fish's flat hand, bent down from the wrist (neck and beak).
    id: ShapeIds.Swan,
    value: [0.3, 0, 0, 0, 0, 0.4, 0, 0, 0],
    weight: [0, 1, 1, 1, 0.8, 1, 0.4, 0.8, 1.4],
  },
  {
    // Hidden snail: fist shell, index + middle pointing forward as eye stalks.
    id: ShapeIds.Snail,
    value: [0.5, 0, 0, 1, 1, 0.5, 0.5, 0.5, 0.5],
    weight: [0, 1.6, 1.6, 1, 0.7, 0, 0, 0, 1.4],
  },
  {
    // Cupped hand holding something small.
    id: ShapeIds.Cup,
    value: [0.3, 0.5, 0.5, 0.5, 0.5, 0, 0, 0.5, 0.5],
    weight: [0.3, 1, 1, 1, 1, 0.6, 0.4, 0, 0],
  },
  {
    id: ShapeIds.Fist,
    value: [0.5, 1, 1, 1, 1, 0, 0.5, 0.5, 0.5],
    weight: [0, 1, 1, 1, 1, 0, 0, 0, 0],
  },
];

const FINGERS: readonly (readonly number[])[] = [
  [1, 2, 3, 4],
  [6, 7, 8, 9],
  [11, 12, 13, 14],
  [16, 17, 18, 19],
  [21, 22, 23, 24],
];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampCos = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);
/** Total bend (radians) of a fully closed finger, and of the thumb's two joints. */
const FINGER_FULL_BEND = (250 * Math.PI) / 180;
const THUMB_FULL_BEND = (120 * Math.PI) / 180;

function dist(j: Float32Array, a: number, b: number): number {
  const dx = j[a * 3] - j[b * 3];
  const dy = j[a * 3 + 1] - j[b * 3 + 1];
  const dz = j[a * 3 + 2] - j[b * 3 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Bend (radians) at joint b between bones a->b and b->c. */
function bendAt(j: Float32Array, a: number, b: number, c: number): number {
  return Math.acos(clampCos(cosBetween(j, a, b, b, c)));
}

/** Cosine of the angle between bones a->b and c->d. */
function cosBetween(j: Float32Array, a: number, b: number, c: number, d: number): number {
  const ux = j[b * 3] - j[a * 3];
  const uy = j[b * 3 + 1] - j[a * 3 + 1];
  const uz = j[b * 3 + 2] - j[a * 3 + 2];
  const vx = j[d * 3] - j[c * 3];
  const vy = j[d * 3 + 1] - j[c * 3 + 1];
  const vz = j[d * 3 + 2] - j[c * 3 + 2];
  const l = Math.sqrt((ux * ux + uy * uy + uz * uz) * (vx * vx + vy * vy + vz * vz));
  return l > 1e-9 ? (ux * vx + uy * vy + uz * vz) / l : 1;
}

export function computeFeatures(joints: Float32Array, out: Float32Array): void {
  for (let f = 0; f < 5; f++) {
    const c = FINGERS[f];
    // Curl = total bend along the finger (the angle between consecutive bones),
    // which is linear in how far the finger is closed, unlike tip-to-knuckle
    // distance. Fingers: knuckle (MCP), middle (PIP) and end (DIP) joints, the
    // first measured against the metacarpal bone. Thumb: its MCP and IP joints.
    let bend = 0;
    if (f > 0) bend += bendAt(joints, c[0] - 1, c[0], c[1]);
    bend += bendAt(joints, c[0], c[1], c[2]);
    bend += bendAt(joints, c[1], c[2], c[3]);
    out[f] = clamp01(bend / (f === 0 ? THUMB_FULL_BEND : FINGER_FULL_BEND));
  }
  const im = Math.acos(Math.min(1, cosBetween(joints, 6, 9, 11, 14)));
  const mr = Math.acos(Math.min(1, cosBetween(joints, 11, 14, 16, 19)));
  out[5] = clamp01((im + mr) / ((30 * Math.PI) / 180));
  const palm = Math.max(0.04, dist(joints, 0, 11));
  const touch = Math.min(dist(joints, 4, 14), dist(joints, 4, 19)) / palm;
  out[6] = clamp01(1 - (touch - 0.25) / 0.45);
  // Thumb tip to index knuckle: ~0.35 palm lengths tucked, ~0.9 held out.
  out[7] = clamp01((dist(joints, 4, 6) / palm - 0.4) / 0.45);
  // Index knuckle -> tip against world up.
  const dy = joints[9 * 3 + 1] - joints[6 * 3 + 1];
  const len = dist(joints, 6, 9);
  out[8] = len > 1e-6 ? clamp01((dy / len + 1) / 2) : 0.5;
}

export interface MatchResult {
  id: ShapeId;
  score: number;
}

/** Best-scoring template (score in 0..1). */
export function classify(features: Float32Array, out: MatchResult): MatchResult {
  out.id = ShapeIds.None;
  out.score = 0;
  for (const t of TEMPLATES) {
    let err = 0;
    let wsum = 0;
    for (let i = 0; i < FEATURE_COUNT; i++) {
      err += t.weight[i] * Math.abs(features[i] - t.value[i]);
      wsum += t.weight[i];
    }
    const score = 1 - err / wsum;
    if (score > out.score) {
      out.score = score;
      out.id = t.id;
    }
  }
  return out;
}
