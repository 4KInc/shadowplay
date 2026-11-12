import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shadowMapSize } from '../src/quality-levels.ts';

test('shadow map size per quality level (what the stage uses and diagnostics report)', () => {
  assert.deepEqual([0, 1, 2, 3].map(shadowMapSize), [1024, 512, 512, 256]);
});
