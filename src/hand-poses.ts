import { Vector3 } from '@iwsdk/core';
import { JOINT_COUNT } from './stage-runtime.js';

/**
 * Synthetic hand poses for testing recognition without a headset. A simple
 * kinematic hand (realistic bone lengths, per-finger curl and spread, thumb
 * placement) produces the 25 WebXR joints. Testers vary hand size and add
 * per-joint noise, standing in for different people's hands.
 *
 * Hand-local frame (right hand): wrist at the origin, fingers along +Y, palm
 * facing -Z (towards the wall), thumb on the -X side. Left hands mirror X.
 */
type V = [number, number, number];

interface FingerPose {
  /** 0 straight .. 1 fully curled (MCP 80, PIP 100, DIP 70 degrees). */
  curl: number;
}

type ThumbMode = 'out' | 'raised' | 'tucked' | 'across' | 'half' | { touch: number };

export interface HandPose {
  fingers: [FingerPose, FingerPose, FingerPose, FingerPose];
  /** Splay between fingers, degrees. */
  spread: number;
  thumb: ThumbMode;
  /** Rotation of the whole hand about its palm normal (degrees): -90 points fingers right. */
  roll?: number;
}

export interface PoseFixture {
  label: string;
  right: HandPose | null;
  left: HandPose | null;
  /** Wrist offsets (stage right, up) in metres for each hand. */
  rightAt?: [number, number];
  leftAt?: [number, number];
}

const f = (curl: number): FingerPose => ({ curl });
const flat = (thumb: ThumbMode, roll = 0, spread = 0): HandPose => ({
  fingers: [f(0), f(0), f(0), f(0)],
  spread,
  thumb,
  roll,
});

/** One fixture per shape, plus negatives that should match nothing that is requested. */
export const FIXTURES: readonly PoseFixture[] = [
  { label: 'open', right: { fingers: [f(0), f(0), f(0), f(0)], spread: 12, thumb: 'out' }, left: null },
  { label: 'fist', right: { fingers: [f(1), f(1), f(1), f(1)], spread: 0, thumb: 'across' }, left: null },
  { label: 'rabbit', right: { fingers: [f(0), f(0), f(1), f(1)], spread: 10, thumb: { touch: 19 } }, left: null },
  { label: 'ears', right: { fingers: [f(0), f(0), f(1), f(1)], spread: 10, thumb: 'out' }, left: null },
  { label: 'fish', right: flat('tucked', -90), left: null },
  { label: 'dog', right: { ...flat('raised', -90), fingers: [f(0), f(0), f(0), f(0.35)] }, left: null },
  { label: 'snail', right: { fingers: [f(0), f(0), f(1), f(1)], spread: 6, thumb: { touch: 19 }, roll: -90 }, left: null },
  { label: 'swan', right: flat('tucked', 180), left: null },
  { label: 'cup', right: { fingers: [f(0.45), f(0.45), f(0.45), f(0.45)], spread: 0, thumb: 'half' }, left: null },
  {
    label: 'bird',
    right: flat('out', -90, 14),
    left: flat('out', -90, 14),
    rightAt: [0.06, 0],
    leftAt: [-0.06, 0],
  },
  {
    label: 'deer',
    right: { fingers: [f(0), f(0), f(0), f(0)], spread: 25, thumb: 'out' },
    left: { fingers: [f(0), f(0), f(0), f(0)], spread: 25, thumb: 'out' },
    rightAt: [0.13, 0],
    leftAt: [-0.13, 0],
  },
  {
    label: 'crocodile',
    right: flat('tucked', -90),
    left: flat('tucked', -90),
    rightAt: [0, 0.035],
    leftAt: [0, -0.035],
  },
  { label: 'negative', right: { fingers: [f(0.3), f(0.25), f(0.3), f(0.35)], spread: 5, thumb: 'half' }, left: null },
  { label: 'negative', right: { fingers: [f(0), f(1), f(1), f(1)], spread: 0, thumb: 'across' }, left: null },
  { label: 'negative', right: { fingers: [f(0.6), f(0.6), f(0.6), f(0.6)], spread: 15, thumb: 'out' }, left: null },
  { label: 'negative', right: { fingers: [f(0.2), f(0), f(0), f(0)], spread: 8, thumb: { touch: 9 } }, left: null },
];

/** Synthetic testers: hand scale and joint-noise seed. */
export const TESTERS: readonly { name: string; scale: number; seed: number }[] = [
  { name: 'synthetic-small', scale: 0.88, seed: 11 },
  { name: 'synthetic-medium-a', scale: 0.95, seed: 23 },
  { name: 'synthetic-medium-b', scale: 1.0, seed: 37 },
  { name: 'synthetic-large-a', scale: 1.06, seed: 41 },
  { name: 'synthetic-large-b', scale: 1.12, seed: 59 },
];

const DEG = Math.PI / 180;
const NOISE_DEG = 8;

function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

// Knuckle x-offset, metacarpal length, phalanx lengths (m) for index..pinky.
const FINGERS: readonly { x: number; meta: number; len: V; spreadSign: number }[] = [
  { x: -0.024, meta: 0.075, len: [0.04, 0.024, 0.02], spreadSign: 1 },
  { x: -0.004, meta: 0.073, len: [0.045, 0.028, 0.021], spreadSign: 0 },
  { x: 0.016, meta: 0.068, len: [0.042, 0.027, 0.021], spreadSign: -0.5 },
  { x: 0.034, meta: 0.063, len: [0.033, 0.019, 0.019], spreadSign: -1 },
];

function rotZ(v: V, a: number): V {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

/** Rotate v about a unit axis by angle (Rodrigues). */
function rotAxis(v: V, k: V, a: number): V {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dot = v[0] * k[0] + v[1] * k[1] + v[2] * k[2];
  const cross: V = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [
    v[0] * c + cross[0] * s + k[0] * dot * (1 - c),
    v[1] * c + cross[1] * s + k[1] * dot * (1 - c),
    v[2] * c + cross[2] * s + k[2] * dot * (1 - c),
  ];
}

const add = (a: V, b: V, s = 1): V => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const norm = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The 25 WebXR joints of a right hand in hand-local coordinates. */
export function localJoints(pose: HandPose, scale: number, seed: number): V[] {
  const rand = makeRandom(seed);
  const noise = () => rand() * 2 * NOISE_DEG * DEG;
  const j: V[] = new Array(JOINT_COUNT);
  j[0] = [0, 0, 0];
  const spread = pose.spread * DEG + rand() * 8 * DEG;

  FINGERS.forEach((finger, i) => {
    const base = 5 + i * 5;
    const knuckle: V = [finger.x * scale, finger.meta * scale, 0];
    j[base] = lerp(j[0], knuckle, 0.25); // metacarpal joint, near the wrist
    j[base + 1] = knuckle; // proximal joint at the knuckle
    const yaw = spread * finger.spreadSign;
    const d0 = rotZ([0, 1, 0], yaw);
    const axis = rotZ([1, 0, 0], yaw);
    const c = Math.max(0, Math.min(1, pose.fingers[i].curl));
    const flex = [80 * DEG * c + noise(), 100 * DEG * c + noise(), 70 * DEG * c + noise()];
    let p = knuckle;
    let total = 0;
    for (let k = 0; k < 3; k++) {
      total += flex[k];
      // Curling turns the finger towards the palm (-Z).
      const dir = rotAxis(d0, axis, -total);
      p = add(p, dir, finger.len[k] * scale);
      j[base + 2 + k] = p;
    }
  });

  // Thumb: carpometacarpal base, MCP, IP, tip.
  const cmc: V = [-0.02 * scale, 0.025 * scale, -0.01 * scale];
  j[1] = cmc;
  const lens = [0.045 * scale, 0.032 * scale, 0.026 * scale];
  const chain = (dir: V, bend: number) => {
    let d = norm(dir);
    let p = cmc;
    for (let k = 0; k < 3; k++) {
      p = add(p, d, lens[k]);
      j[2 + k] = p;
      d = norm(rotAxis(d, [0, 0, 1], -bend - noise() * 0.5));
    }
  };
  const mode = pose.thumb;
  if (mode === 'out') chain([-0.75, 0.6, -0.25], 8 * DEG);
  else if (mode === 'raised') chain([-1, 0.25, 0.05], 4 * DEG);
  else if (mode === 'half') chain([-0.45, 0.7, -0.45], 25 * DEG);
  else if (mode === 'tucked') {
    j[2] = [-0.03 * scale, 0.06 * scale, -0.006 * scale];
    j[3] = [-0.032 * scale, 0.088 * scale, -0.006 * scale];
    j[4] = [-0.03 * scale, 0.112 * scale, -0.006 * scale];
  } else {
    // Reach across to a fingertip (touch) or the middle finger (across/fist).
    const target = mode === 'across' ? j[12] : j[mode.touch];
    const mcp = add(cmc, norm([-0.5, 0.75, -0.45]), lens[0]);
    const tip = add(target, [0, 0, -0.008 * scale]);
    j[2] = mcp;
    j[3] = add(lerp(mcp, tip, 0.55), [-0.006 * scale, 0, -0.01 * scale]);
    j[4] = tip;
  }

  const roll = (pose.roll ?? 0) * DEG;
  if (roll) for (let i = 0; i < JOINT_COUNT; i++) j[i] = rotZ(j[i], roll);
  return j;
}

/**
 * Place a hand in the world: wrist at `wrist`, hand-local X/Y/Z along the
 * given basis (stage right, up, normal towards the player). Left hands mirror
 * local X so the thumb sits on the correct side.
 */
export function toWorld(
  local: V[],
  side: 'left' | 'right',
  wrist: Vector3,
  right: Vector3,
  up: Vector3,
  normal: Vector3,
  out: Float32Array,
): Float32Array {
  const mx = side === 'left' ? -1 : 1;
  for (let i = 0; i < JOINT_COUNT; i++) {
    const [x, y, z] = local[i];
    out[i * 3] = wrist.x + right.x * x * mx + up.x * y + normal.x * z;
    out[i * 3 + 1] = wrist.y + right.y * x * mx + up.y * y + normal.y * z;
    out[i * 3 + 2] = wrist.z + right.z * x * mx + up.z * y + normal.z * z;
  }
  return out;
}
