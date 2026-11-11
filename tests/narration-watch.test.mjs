import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STALL_SECONDS, StallWatch } from '../src/narration-watch.ts';

const FRAME = 1 / 72;
/** Run `seconds` of frames; `time(t)` is the clip position at elapsed t. Returns the actions seen. */
function run(w, seconds, time) {
  const actions = [];
  for (let t = 0; t < seconds; t += FRAME) {
    const a = w.step(FRAME, time(t));
    if (a !== 'ok') actions.push([a, +t.toFixed(2)]);
  }
  return actions;
}

test('a clip that plays normally is never interrupted', () => {
  const w = new StallWatch();
  assert.deepEqual(run(w, 30, (t) => t), []);
});

test('a clip that never starts: retry after the stall time, then give up', () => {
  const w = new StallWatch();
  const actions = run(w, 10, () => 0);
  assert.equal(actions.length, 3); // retry, give-up, give-up (the caller stops after the first give-up)
  assert.equal(actions[0][0], 'retry');
  assert.ok(Math.abs(actions[0][1] - STALL_SECONDS) < 0.05);
  assert.equal(actions[1][0], 'give-up');
  assert.ok(Math.abs(actions[1][1] - 2 * STALL_SECONDS) < 0.05);
});

test('a clip that stalls mid-line and recovers after the retry keeps playing', () => {
  const w = new StallWatch();
  // Plays 2 s, freezes 4 s (retry at 3 s of stillness), then plays on.
  const actions = run(w, 20, (t) => (t < 2 ? t : t < 6 ? 2 : t - 4));
  assert.deepEqual(actions.map((a) => a[0]), ['retry']);
});

test('a lost "ended" (position stays at the end) finishes the line', () => {
  const w = new StallWatch();
  const actions = run(w, 12, (t) => Math.min(t, 4));
  assert.deepEqual(actions.map((a) => a[0]).slice(0, 2), ['retry', 'give-up']);
});

test('one long frame (back from a hidden session) is not a stall', () => {
  const w = new StallWatch();
  w.step(FRAME, 1);
  assert.equal(w.step(30, 1), 'ok');
});

test('reset starts afresh for the next clip (it gets its own retry)', () => {
  const w = new StallWatch();
  run(w, 7, () => 0);
  w.reset();
  assert.equal(run(w, 4, () => 0)[0][0], 'retry');
});
