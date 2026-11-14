import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMAND_PHRASES, describe, MAX_WORDS, parseCommand } from '../src/voice-commands.ts';

test('shapes by name, with everyday words around them', () => {
  assert.deepEqual(parseCommand('rabbit'), { kind: 'shape', shape: 'rabbit' });
  assert.deepEqual(parseCommand('Make a bunny!'), { kind: 'shape', shape: 'rabbit' });
  assert.deepEqual(parseCommand('the bird please'), { kind: 'shape', shape: 'bird' });
  assert.deepEqual(parseCommand('Croc'), { kind: 'shape', shape: 'crocodile' });
  assert.deepEqual(parseCommand('cupped hands'), { kind: 'shape', shape: 'cup' });
});

test('the longest phrase wins', () => {
  assert.deepEqual(parseCommand('close the journal'), { kind: 'journal', open: false });
  assert.deepEqual(parseCommand('journal'), { kind: 'journal', open: null });
  assert.deepEqual(parseCommand('next story'), { kind: 'press', id: 'story-next' });
  assert.deepEqual(parseCommand('next'), { kind: 'next' });
  assert.deepEqual(parseCommand('one-hand mode off'), { kind: 'setting', which: 'oneHand', on: false });
  assert.deepEqual(parseCommand('One hand mode'), { kind: 'setting', which: 'oneHand', on: null });
});

test('panel buttons, the lamp and movement beats', () => {
  assert.deepEqual(parseCommand('move stage here'), { kind: 'press', id: 'replace-stage-button' });
  assert.deepEqual(parseCommand('Go live'), { kind: 'press', id: 'live-button' });
  assert.deepEqual(parseCommand('pause'), { kind: 'lamp', on: false });
  assert.deepEqual(parseCommand('okay continue'), { kind: 'lamp', on: true });
  assert.deepEqual(parseCommand('keep going'), { kind: 'next' });
});

test('whole words only, and nothing in long speech or narration', () => {
  assert.equal(parseCommand('fisherman'), null);
  assert.equal(parseCommand('dogma'), null);
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand('hello there'), null);
  // A narration line read out loud near the microphone is not a command.
  assert.equal(parseCommand('Make a rabbit with your hand and hold it still'), null);
  assert.ok('make a rabbit with your hand'.split(' ').length <= MAX_WORDS);
});

test('every command can be described, and phrase hints are unique', () => {
  for (const p of COMMAND_PHRASES) {
    const c = parseCommand(p);
    assert.ok(c, p);
    assert.ok(describe(c).length > 0, p);
  }
  assert.equal(new Set(COMMAND_PHRASES).size, COMMAND_PHRASES.length);
});

test('dreaming by voice: the place and shapes named, in the order said', () => {
  assert.deepEqual(parseCommand('Dream a story about the river with a fish and a bird'), { kind: 'dream', theme: 'river', shapes: ['fish', 'bird'] });
  assert.deepEqual(parseCommand("Mo, dream about the stars with a bunny, a dog and a cup please"), { kind: 'dream', theme: 'sky', shapes: ['rabbit', 'dog', 'cup'] });
  assert.deepEqual(parseCommand('dream a new story'), { kind: 'dream', theme: '', shapes: [] });
  assert.deepEqual(parseCommand("let's dream in the forest"), { kind: 'dream', theme: 'forest', shapes: [] });
  // Only shapes a dreamed story can ask for; at most three.
  assert.deepEqual(parseCommand('dream with a swan, a fish, a bird, a dog and a rabbit').shapes, ['fish', 'bird', 'dog']);
  // A story line that says "dream" is not a command.
  assert.notEqual(parseCommand('The fish drifts off to dream')?.kind, 'dream');
  assert.equal(parseCommand('Close your eyes and dream of the sea'), null);
});
