import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDiag } from '../server/diag.ts';

test('diagnostics accept the raw plane labels (up to 16 kinds, as the client sends)', () => {
  const labels = Array.from({ length: 16 }, (_, i) => `v invisible wall face ${i}`);
  labels[0] = 'h table 2';
  labels[1] = 'v - 1';
  const batch = checkDiag({ v: 1, session: 'abcdefghjk', items: [{ k: 'ev', e: 'placed', labels }] });
  assert.ok(batch);
  assert.deepEqual(JSON.parse(batch.lines[0]).labels, labels);
});
