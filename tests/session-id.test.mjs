import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatSessionId, newSessionId, SESSION_ALPHABET } from '../src/diag/session-id.ts';
import { checkDiag } from '../server/diag.ts';

test('session ids avoid look-alike characters', () => {
  for (const c of '01oil') assert.ok(!SESSION_ALPHABET.includes(c), c);
  for (let i = 0; i < 500; i++) assert.match(newSessionId(), /^[a-hj-km-np-z2-9]{10}$/);
});

test('every session id passes the server check', () => {
  for (let i = 0; i < 200; i++) {
    const session = newSessionId();
    assert.ok(checkDiag({ v: 1, session, items: [{ k: 'ev', e: 'start', t: 0 }] }), session);
  }
});

test('shown in two groups of five', () => {
  assert.equal(formatSessionId('k3x9qm2p7a'), 'k3x9q m2p7a');
});
