/**
 * Device-free recognition check (npm run test:recognition). Synthetic hands
 * (varied size, +/-8 deg joint-angle noise) model people; on top of that the
 * sweep adds what Quest hand tracking does to them: +/-5 mm joint jitter, an
 * occluded finger (jittering, or frozen at a resting curl) and 100 ms tracking
 * dropouts. It checks, against the same code the app runs:
 *
 *   1. accuracy per one-hand shape, per condition            target >= 95%
 *   2. negatives (resting, half-closed hands) accepted by a
 *      story request, per story shape                        target <= 10% of frames
 *   3. two-hand shapes (bird, deer, crocodile, cupped hands)  target >= 95%
 *   4. over time at 72 Hz with dropouts: every target shape
 *      triggers within 1.5 s; no negative triggers at all    target 0 false triggers
 *   5. the request gate (only requested shapes count, except in Free Stage)
 *   6. the webcam landmark mapping preserves every shape
 *
 * Synthetic hands are a model, not people: tune on real-hand data (?diag
 * sessions, the recognition lab) and use this to catch regressions.
 */
import { Vector3 } from '@iwsdk/core';
import { acceptScore, classify, computeFeatures } from '../../src/hand-features';
import { FIXTURES, HandPose, localJoints, toWorld } from '../../src/hand-poses';
import { classifyPair, HoldState, isHiddenPair, JointSmoother, requested, stepHold } from '../../src/recognition-rules';
import { ShapeIds } from '../../src/shadowplay-components';
import { Landmark, landmarksToJoints } from '../../src/webcam-landmarks';

const N = 40;
const TOLERANCE = 0.3;
const TARGET_ACCURACY = 0.95;
const MAX_NEGATIVE_RATE = 0.1;
const HZ = 72;
const HOLD = 0.5;
const TRIGGER_WITHIN = 1.5;

let failed = false;
const fail = (msg: string) => {
  failed = true;
  return `${msg}  <-- below target`;
};

// ---------------------------------------------------------------- hands

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const FINGER_JOINTS = [
  [1, 2, 3, 4],
  [6, 7, 8, 9],
  [11, 12, 13, 14],
  [16, 17, 18, 19],
  [21, 22, 23, 24],
];

type Condition = 'clean' | 'jitter 5 mm' | 'occluded finger' | 'jitter + occlusion';
const CONDITIONS: Condition[] = ['clean', 'jitter 5 mm', 'occluded finger', 'jitter + occlusion'];

const R = new Vector3(1, 0, 0);
const U = new Vector3(0, 1, 0);
const NRM = new Vector3(0, 0, 1);

/** A person: a pose rendered at a size with their own joint-angle noise, in world space. */
function person(pose: HandPose, side: 'left' | 'right', s: number, salt: number, at: [number, number] = [0, 0]): Float32Array {
  const local = localJoints(pose, 0.85 + (s % 7) * 0.05, 1000 + s * 13 + salt * 101);
  return toWorld(local, side, new Vector3(at[0], at[1], 0), R, U, NRM, new Float32Array(75));
}

/**
 * What tracking does to that hand this frame. The occluded finger is chosen per
 * person: half the time it jitters (+/-12 mm), half the time it is frozen at a
 * resting curl (Quest's estimate for a finger it cannot see).
 */
function track(base: Float32Array, pose: HandPose, side: 'left' | 'right', cond: Condition, s: number, salt: number, frame: number, at: [number, number] = [0, 0]): Float32Array {
  const out = new Float32Array(base);
  const r = rng(s * 7919 + salt * 104729 + frame * 31 + 17);
  const jitter = cond === 'jitter 5 mm' || cond === 'jitter + occlusion';
  const occlude = cond === 'occluded finger' || cond === 'jitter + occlusion';
  if (occlude) {
    const pick = rng(s * 131 + salt * 7 + 3);
    const finger = 1 + Math.floor(pick() * 4);
    if (pick() < 0.5) {
      for (const j of FINGER_JOINTS[finger]) for (let k = 0; k < 3; k++) out[j * 3 + k] += (r() * 2 - 1) * 0.012;
    } else {
      const fingers = pose.fingers.map((f, i) => (i === finger - 1 ? { curl: 0.25 } : f)) as HandPose['fingers'];
      const rest = person({ ...pose, fingers }, side, s, salt, at);
      for (const j of FINGER_JOINTS[finger]) for (let k = 0; k < 3; k++) out[j * 3 + k] = rest[j * 3 + k];
    }
  }
  if (jitter) for (let i = 0; i < 75; i++) out[i] += (r() * 2 - 1) * 0.005;
  return out;
}

function shapeOf(joints: Float32Array, tolerance = TOLERANCE): { shape: string; best: string; curl: number; features: Float32Array } {
  const f = new Float32Array(9);
  computeFeatures(joints, f);
  const r = classify(f, { id: ShapeIds.None, score: 0 });
  const shape = r.score >= acceptScore(r.id, tolerance) ? r.id : ShapeIds.None;
  return { shape, best: r.id, curl: (f[1] + f[2] + f[3] + f[4]) / 4, features: f };
}

/** The app's per-hand pipeline: smooth the tracked joints, then classify (null while untracked). */
class HandPipeline {
  private smoother = new JointSmoother();
  step(raw: Float32Array | null): { shape: string; best: string; curl: number; features: Float32Array; joints: Float32Array } | null {
    const joints = this.smoother.update(raw);
    if (!joints) return null;
    return { ...shapeOf(joints), joints: new Float32Array(joints) };
  }
}

/**
 * What a request sees from two hands, as in the app: the pair's shape if they
 * make one, otherwise each hand's own shape (a single cupped hand also answers
 * "cup your hands").
 */
function twoHands(l: { shape: string; best: string; curl: number; features: Float32Array; joints: Float32Array }, r: typeof l, hidden: boolean, target: string): string {
  const pair = classifyPair(l, r, hidden);
  if (pair) return pair;
  return r.shape === target || l.shape === target ? target : ShapeIds.None;
}

/** One second of one person holding a pose through the pipeline; the shape at the end. */
function settle(base: Float32Array, pose: HandPose, side: 'left' | 'right', cond: Condition, s: number, salt: number, at: [number, number] = [0, 0], frames = HZ) {
  const p = new HandPipeline();
  let out = p.step(track(base, pose, side, cond, s, salt, 0, at))!;
  for (let i = 1; i < frames; i++) out = p.step(track(base, pose, side, cond, s, salt, i, at))!;
  return out;
}

const oneHand = FIXTURES.filter((fx) => fx.right && !fx.left && fx.label !== 'negative');
const negatives = FIXTURES.filter((fx) => fx.label === 'negative');
const pairs = FIXTURES.filter((fx) => fx.right && fx.left);
// Cupped hands as a pair: two cups side by side.
const cupPose = FIXTURES.find((fx) => fx.label === 'cup')!.right!;
const pairFixtures = [
  ...pairs.map((fx) => ({ label: fx.label, right: fx.right!, left: fx.left!, rightAt: fx.rightAt ?? [0.06, 0], leftAt: fx.leftAt ?? [-0.06, 0] })),
  { label: 'cup', right: cupPose, left: cupPose, rightAt: [0.05, 0] as [number, number], leftAt: [-0.05, 0] as [number, number] },
];
/** Shapes a story can ask for (one-hand ones are judged per hand; the rest as pairs). */
const STORY_SHAPES = ['rabbit', 'fish', 'dog', 'snail', 'swan', 'cup', 'bird', 'deer', 'crocodile'];

// ---------------------------------------------------------------- 1. accuracy

const confusions: string[] = [];
console.log(`1. One-hand accuracy over ${N} synthetic people per shape (tolerance ${TOLERANCE}):`);
console.log(`   ${'shape'.padEnd(10)}${CONDITIONS.map((c) => c.padStart(20)).join('')}`);
for (const fx of oneHand) {
  const cells = CONDITIONS.map((cond) => {
    let ok = 0;
    const seen: Record<string, number> = {};
    for (let s = 0; s < N; s++) {
      const base = person(fx.right!, 'right', s, FIXTURES.indexOf(fx));
      const got = settle(base, fx.right!, 'right', cond, s, FIXTURES.indexOf(fx)).shape;
      if (got === fx.label) ok++;
      else seen[got] = (seen[got] ?? 0) + 1;
    }
    const acc = ok / N;
    if (acc < TARGET_ACCURACY) confusions.push(`${fx.label} (${cond}) read as ${Object.entries(seen).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    return acc < TARGET_ACCURACY ? `${fail('')}`.replace('  <-- below target', '').concat(`${Math.round(acc * 100)}% !`).padStart(20) : `${Math.round(acc * 100)}%`.padStart(20);
  });
  console.log(`   ${fx.label.padEnd(10)}${cells.join('')}`);
}
for (const c of confusions) console.log(`   ${c}`);

// ---------------------------------------------------------------- 2. negatives

console.log(`\n2. Negative hands (resting, half-closed) accepted when a story asks for a shape (share of frames, all conditions):`);
const negHits: Record<string, number> = {};
let negFrames = 0;
const negShapes: Record<string, number> = {};
for (const fx of negatives) {
  for (const cond of CONDITIONS) {
    for (let s = 0; s < N; s++) {
      const base = person(fx.right!, 'right', s, FIXTURES.indexOf(fx));
      const p = new HandPipeline();
      for (let i = 0; i < HZ; i++) {
        const { shape } = p.step(track(base, fx.right!, 'right', cond, s, FIXTURES.indexOf(fx), i))!;
        if (i < HZ / 5) continue;
        negFrames++;
        negShapes[shape] = (negShapes[shape] ?? 0) + 1;
        for (const target of STORY_SHAPES) {
          if (requested(shape, target, ShapeIds.None, ShapeIds.None, ShapeIds.None, false, false) !== ShapeIds.None) {
            negHits[target] = (negHits[target] ?? 0) + 1;
          }
        }
      }
    }
  }
}
console.log(`   read as: ${Object.entries(negShapes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((100 * v) / negFrames)}%`).join(', ')}`);
for (const target of STORY_SHAPES) {
  const rate = (negHits[target] ?? 0) / negFrames;
  const line = `   ${target.padEnd(10)} ${(100 * rate).toFixed(1)}%`;
  console.log(rate > MAX_NEGATIVE_RATE ? fail(line) : line);
}

// ---------------------------------------------------------------- 3. pairs


console.log(`\n3. Two-hand accuracy (${N} people per shape):`);
console.log(`   ${'shape'.padEnd(10)}${CONDITIONS.map((c) => c.padStart(20)).join('')}`);
for (const fx of pairFixtures) {
  const hidden = isHiddenPair(fx.label);
  const cells = CONDITIONS.map((cond) => {
    let ok = 0;
    for (let s = 0; s < N; s++) {
      const salt = 50 + pairFixtures.indexOf(fx);
      const rb = person(fx.right, 'right', s, salt, fx.rightAt);
      const lb = person(fx.left, 'left', s, salt + 9, fx.leftAt);
      const r = settle(rb, fx.right, 'right', cond, s, salt, fx.rightAt);
      const l = settle(lb, fx.left, 'left', cond, s, salt + 9, fx.leftAt);
      if (twoHands(l, r, hidden, fx.label) === fx.label) ok++;
      else if (process.env.SWEEP_DEBUG && fx.label === process.env.SWEEP_DEBUG)
        console.log(`     miss ${cond} #${s}: L ${l.shape}/${l.best} curl ${l.curl.toFixed(2)} thumb ${l.features[0].toFixed(2)} touch ${l.features[6].toFixed(2)} f ${Array.from(l.features.slice(1,5)).map((x) => x.toFixed(2)).join(",")} | R ${r.shape}/${r.best} curl ${r.curl.toFixed(2)} thumb ${r.features[0].toFixed(2)}`);
    }
    const acc = ok / N;
    return acc < TARGET_ACCURACY ? `${fail('')}`.replace('  <-- below target', '').concat(`${Math.round(acc * 100)}% !`).padStart(20) : `${Math.round(acc * 100)}%`.padStart(20);
  });
  console.log(`   ${fx.label.padEnd(10)}${cells.join('')}`);
}

// ---------------------------------------------------------------- 4. over time

/** Tracking drops the hand for 100 ms about every second. */
const dropped = (i: number) => {
  const t = (i / HZ) % 1;
  return t > 0.85 && t < 0.95;
};

/** When the request first triggers in a 3 s sequence of accepted-shape frames (null if never). */
function triggerTime(shapes: string[], target: string): number | null {
  const state: HoldState = { candidate: ShapeIds.None, sinceMatch: 0 };
  let held = 0;
  const dt = 1 / HZ;
  for (let i = 0; i < shapes.length; i++) {
    const accepted = requested(shapes[i], target, ShapeIds.None, ShapeIds.None, ShapeIds.None, false, false);
    held = stepHold(state, held, accepted, dt);
    if (held >= HOLD) return i * dt;
  }
  return null;
}

/** 3 s of one hand through the pipeline, with dropouts. */
function oneHandFrames(base: Float32Array, pose: HandPose, cond: Condition, s: number, salt: number): string[] {
  const p = new HandPipeline();
  return Array.from({ length: HZ * 3 }, (_, i) => (dropped(i) ? (p.step(null), ShapeIds.None) : p.step(track(base, pose, 'right', cond, s, salt, i))!.shape));
}

/** 3 s of two hands through the pipeline, with dropouts (both hands drop together). */
function pairFrames(
  rb: Float32Array, rPose: HandPose, rAt: [number, number],
  lb: Float32Array, lPose: HandPose, lAt: [number, number],
  cond: Condition, s: number, salt: number, hidden: boolean, target: string,
): string[] {
  const pr = new HandPipeline();
  const pl = new HandPipeline();
  return Array.from({ length: HZ * 3 }, (_, i) => {
    if (dropped(i)) {
      pr.step(null);
      pl.step(null);
      return ShapeIds.None;
    }
    const r = pr.step(track(rb, rPose, 'right', cond, s, salt, i, rAt))!;
    const l = pl.step(track(lb, lPose, 'left', cond, s, salt + 9, i, lAt))!;
    return twoHands(l, r, hidden, target);
  });
}

console.log(`\n4. Over time (3 s at ${HZ} Hz, jitter + occlusion, 100 ms dropouts, hold ${HOLD} s):`);
const cond: Condition = 'jitter + occlusion';
for (const fx of oneHand.filter((f) => STORY_SHAPES.includes(f.label))) {
  const salt = FIXTURES.indexOf(fx);
  let ok = 0;
  let total = 0;
  for (let s = 0; s < N; s++) {
    const t = triggerTime(oneHandFrames(person(fx.right!, 'right', s, salt), fx.right!, cond, s, salt), fx.label);
    if (t !== null && t <= TRIGGER_WITHIN) {
      ok++;
      total += t;
    }
  }
  const line = `   ${fx.label.padEnd(10)} triggers ${ok}/${N}, mean ${(total / Math.max(1, ok)).toFixed(2)} s`;
  console.log(ok / N < TARGET_ACCURACY ? fail(line) : line);
}
for (const fx of pairFixtures) {
  const salt = 50 + pairFixtures.indexOf(fx);
  let ok = 0;
  for (let s = 0; s < N; s++) {
    const frames = pairFrames(
      person(fx.right, 'right', s, salt, fx.rightAt), fx.right, fx.rightAt,
      person(fx.left, 'left', s, salt + 9, fx.leftAt), fx.left, fx.leftAt,
      cond, s, salt, isHiddenPair(fx.label), fx.label,
    );
    const t = triggerTime(frames, fx.label);
    if (t !== null && t <= TRIGGER_WITHIN) ok++;
  }
  const line = `   ${fx.label.padEnd(10)} triggers ${ok}/${N} (pair)`;
  console.log(ok / N < TARGET_ACCURACY ? fail(line) : line);
}
let falseTriggers = 0;
const falseBy: Record<string, number> = {};
for (const fx of negatives) {
  const salt = FIXTURES.indexOf(fx);
  for (let s = 0; s < N; s++) {
    const frames = oneHandFrames(person(fx.right!, 'right', s, salt), fx.right!, cond, s, salt);
    for (const target of STORY_SHAPES) {
      if (triggerTime(frames, target) !== null) {
        falseTriggers++;
        falseBy[target] = (falseBy[target] ?? 0) + 1;
      }
    }
  }
}
// Two resting hands side by side, both in the light, when a story asks for a two-hand shape.
for (const fx of negatives) {
  const salt = 70 + FIXTURES.indexOf(fx);
  for (let s = 0; s < N; s++) {
    for (const target of ['cup', 'bird', 'deer', 'crocodile']) {
      const frames = pairFrames(
        person(fx.right!, 'right', s, salt, [0.05, 0]), fx.right!, [0.05, 0],
        person(fx.right!, 'left', s, salt + 9, [-0.05, 0]), fx.right!, [-0.05, 0],
        cond, s, salt, true, target,
      );
      if (triggerTime(frames, target) !== null) {
        falseTriggers++;
        falseBy[`${target} (pair)`] = (falseBy[`${target} (pair)`] ?? 0) + 1;
      }
    }
  }
}
const ftLine = `   negatives: ${falseTriggers} false triggers over ${negatives.length * N * 2} sequences x their requests${falseTriggers ? ' ' + JSON.stringify(falseBy) : ''}`;
console.log(falseTriggers ? fail(ftLine) : ftLine);

// ---------------------------------------------------------------- 5. the gate

const gate: [string, boolean][] = [
  ['requested shape is accepted', requested('rabbit', 'rabbit', 'none', 'none', 'none', false, false) === 'rabbit'],
  ['its alternative is accepted', requested('ears', 'rabbit', 'ears', 'none', 'none', false, false) === 'rabbit'],
  ['another shape is ignored in the story', requested('dog', 'rabbit', 'ears', 'none', 'none', false, false) === 'none'],
  ['nothing counts when nothing is asked', requested('fish', 'none', 'none', 'none', 'none', false, false) === 'none'],
  ['Free Stage accepts any creature', requested('swan', 'none', 'none', 'none', 'none', true, false) === 'swan'],
  ['Free Stage never accepts cup or fist', requested('cup', 'none', 'none', 'none', 'none', true, false) === 'none' && requested('fist', 'none', 'none', 'none', 'none', true, false) === 'none'],
  ['one-hand mode: an open hand is a bird in Free Stage', requested('open', 'none', 'none', 'none', 'none', true, true) === 'bird'],
];
console.log('\n5. Request gate:');
for (const [name, ok] of gate) console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ((failed = true), '')}`);

// ---------------------------------------------------------------- 6. webcam mapping

// Hand-local (right, up, normal) -> MediaPipe image axes (-x, -y, z) and back.
const WX_FOR_MP = [0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24];
let mapped = 0;
let mappedOk = 0;
for (const fx of oneHand) {
  const local = localJoints(fx.right!, 1, 37);
  const flat = new Float32Array(75);
  local.forEach((p, i) => flat.set(p, i * 3));
  const mp: Landmark[] = WX_FOR_MP.map((j) => ({ x: -local[j][0], y: -local[j][1], z: local[j][2] }));
  const joints = landmarksToJoints(mp, new Vector3(), R, U, NRM, new Float32Array(75));
  mapped++;
  if (shapeOf(joints).shape === shapeOf(flat).shape) mappedOk++;
}
console.log(`\n6. Webcam mapping preserves the classification for ${mappedOk}/${mapped} shapes.`);
if (mappedOk !== mapped) failed = true;

console.log(failed ? '\nRECOGNITION TARGETS NOT MET' : '\nAll recognition targets met.');
process.exit(failed ? 1 : 0);
