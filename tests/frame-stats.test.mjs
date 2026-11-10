import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameStats } from '../src/diag/frame-stats.ts';

const out = () => ({ avg: 0, p95: 0, worst: 0, fps: 0, frames: 0 });

test('steady 72 Hz', () => {
  const s = new FrameStats(5000);
  for (let i = 0; i < 1000; i++) s.push(1000 / 72);
  const r = s.read(out());
  assert.ok(Math.abs(r.fps - 72) < 0.01);
  assert.ok(Math.abs(r.worst - 13.89) < 0.01);
  assert.ok(Math.abs(r.frames - 360) <= 1); // only the last 5 s
});

test('a hitch shows in p95 and worst, not much in the average', () => {
  const s = new FrameStats(5000);
  for (let i = 0; i < 340; i++) s.push(13.9);
  for (let i = 0; i < 20; i++) s.push(40);
  const r = s.read(out());
  assert.equal(Math.round(r.worst), 40);
  assert.equal(Math.round(r.p95), 40);
  assert.ok(r.avg < 16);
});

test('ignores nonsense and starts empty', () => {
  const s = new FrameStats();
  s.push(-1);
  s.push(0);
  s.push(5000);
  assert.equal(s.read(out()).frames, 0);
});
