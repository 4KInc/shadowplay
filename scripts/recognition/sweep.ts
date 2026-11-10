/**
 * Device-free recognition check: classifies every single-hand pose fixture on
 * 40 synthetic hands (varied size, +/-8 deg joint noise) and prints a
 * confusion summary, then checks that poses survive the webcam landmark
 * mapping. Synthetic hands are a model, not people: use this to catch
 * regressions, and tune on real-hand data from the recognition lab.
 *
 * Run: npm run test:recognition
 */
import { Vector3 } from '@iwsdk/core';
import { classify, computeFeatures } from '../../src/hand-features';
import { FIXTURES, localJoints } from '../../src/hand-poses';
import { Landmark, landmarksToJoints } from '../../src/webcam-landmarks';

const N = 40;
const TOLERANCE = 0.3;
const MIN_ACCURACY = 0.85;

function features(joints: Float32Array): Float32Array {
  const f = new Float32Array(9);
  computeFeatures(joints, f);
  return f;
}
function predict(f: Float32Array): string {
  const r = classify(f, { id: 'none', score: 0 });
  return r.score >= 1 - TOLERANCE ? r.id : 'none';
}

let failed = false;
console.log(`Confusion over ${N} synthetic hands per shape (tolerance ${TOLERANCE}):`);
for (const fx of FIXTURES) {
  if (!fx.right || fx.left) continue;
  const row: Record<string, number> = {};
  for (let s = 0; s < N; s++) {
    const local = localJoints(fx.right, 0.85 + (s % 7) * 0.05, 1000 + s * 13 + FIXTURES.indexOf(fx) * 101);
    const flat = new Float32Array(75);
    local.forEach((p, i) => flat.set(p, i * 3));
    const p = predict(features(flat));
    row[p] = (row[p] ?? 0) + 1;
  }
  const top = Object.entries(row).sort((a, b) => b[1] - a[1]);
  const acc = (row[fx.label] ?? 0) / N;
  const flag = fx.label !== 'negative' && acc < MIN_ACCURACY ? '  <-- below target' : '';
  if (flag) failed = true;
  console.log(`  ${fx.label.padEnd(9)} ${top.map(([p, c]) => `${p} ${Math.round((100 * c) / N)}%`).join(', ')}${flag}`);
}

// Webcam mapping: hand-local (right, up, normal) -> MediaPipe image axes (-x, -y, z) and back.
const WX_FOR_MP = [0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24];
const R = new Vector3(1, 0, 0);
const U = new Vector3(0, 1, 0);
const NRM = new Vector3(0, 0, 1);
let mapped = 0;
let mappedOk = 0;
for (const fx of FIXTURES) {
  if (!fx.right || fx.left || fx.label === 'negative') continue;
  const local = localJoints(fx.right, 1, 37);
  const flat = new Float32Array(75);
  local.forEach((p, i) => flat.set(p, i * 3));
  const mp: Landmark[] = WX_FOR_MP.map((j) => ({ x: -local[j][0], y: -local[j][1], z: local[j][2] }));
  const joints = landmarksToJoints(mp, new Vector3(), R, U, NRM, new Float32Array(75));
  mapped++;
  if (predict(features(joints)) === predict(features(flat))) mappedOk++;
}
console.log(`Webcam mapping preserves the classification for ${mappedOk}/${mapped} shapes.`);
if (mappedOk !== mapped) failed = true;
process.exit(failed ? 1 : 0);
