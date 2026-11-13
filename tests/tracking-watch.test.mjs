import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DropoutWatch } from '../src/tracking-watch.ts';

const FRAME = 1 / 72;
/** Run `seconds`; `tracked(t)` gives [left, right]. Returns when it first said struggling (or -1) and the watch. */
function run(seconds, tracked, w = new DropoutWatch()) {
  let first = -1;
  for (let t = 0; t < seconds; t += FRAME) {
    const [l, r] = tracked(t);
    if (w.step(FRAME, l, r) && first < 0) first = t;
  }
  return { first, w };
}

test('steady tracking is never struggling', () => {
  assert.equal(run(30, () => [true, true]).first, -1);
});

test('hands taken out of view on purpose (long gaps) do not count', () => {
  // Gone 3 s, back 4 s, repeatedly.
  const { first, w } = run(40, (t) => [t % 7 > 3, t % 7 > 3]);
  assert.equal(first, -1);
  assert.equal(w.flickers, 0);
});

test('a flickering hand (dim room) is struggling within a few seconds', () => {
  // Right hand lost for 0.25 s every second.
  const { first, w } = run(10, (t) => [false, t % 1 > 0.25]);
  assert.ok(first > 0 && first < 4, `first ${first}`);
  assert.ok(w.flickers >= 8);
});

test('two flickers are not enough; a calm spell clears it', () => {
  const twice = run(10, (t) => [true, !((t > 2 && t < 2.2) || (t > 5 && t < 5.2))]);
  assert.equal(twice.first, -1);
  const w = new DropoutWatch();
  run(5, (t) => [true, t % 1 > 0.25], w);
  assert.equal(w.struggling(), true);
  run(11, () => [true, true], w);
  assert.equal(w.struggling(), false);
});

test('reset clears the per-beat count', () => {
  const { w } = run(5, (t) => [true, t % 1 > 0.25]);
  w.reset();
  assert.equal(w.flickers, 0);
  assert.equal(w.struggling(), false);
});
