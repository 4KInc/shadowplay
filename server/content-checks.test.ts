import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanLine } from './coach.ts';
import { contentProblems } from './content-checks.ts';
import { assembleStory } from './dream.ts';
import { cannedWords } from '../tests/fixtures/dream-words.mjs';

// Real slips from the provider trial (13 Nov), and lines that must still pass.
test('slips from the trial are caught', () => {
  assert.ok(contentProblems('Cross your wrists and open your fingers to make a friendly shadow dog.', 'dog').length);
  assert.ok(contentProblems('Shape your fingers into a snoopy, happy shadow dog.', 'dog').length);
  assert.ok(contentProblems('Mo folds his tiny wings and tucks his head under a soft clover leaf.').length);
  assert.ok(contentProblems('Please make a dog with cupped hands for Mo.', 'dog').length);
  assert.ok(contentProblems('Make a fish with two hands side by side.', 'fish').length);
  assert.equal(cleanLine('Bring your other hand up to cross your wrists and make flapping wings.', 'bird'), null);
});

test('good lines still pass', () => {
  for (const [line, shape] of [
    ['Put two hands side by side with thumbs hooked to make a flying bird.', 'bird'],
    ['Hold your cupped hands together to make a warm shadow cup.', 'cup'],
    ['Make a dog with your hand, lifting your thumb to be an ear.', 'dog'],
    ['Mo flutters across the meadow, and her wings shine.', undefined],
    ['An apple tree hums on a quiet quest across the river.', undefined],
  ] as const) {
    assert.deepEqual(contentProblems(line, shape), [], line);
  }
  assert.ok(cleanLine('Bring your wrists close together so they nearly touch to make the wings fly.', 'bird'));
});

test('a story whose request gives another shape\'s hands is refused; the canned story passes', () => {
  const req = { theme: 'meadow', shapes: ['dog', 'fish'] };
  assert.ok(assembleStory(req, cannedWords(req.shapes)));
  const bad = JSON.parse(cannedWords(req.shapes));
  bad.scenes[0].ask = 'Make a dog with cupped hands, side by side.';
  assert.equal(assembleStory(req, JSON.stringify(bad)), null);
  const he = JSON.parse(cannedWords(req.shapes));
  he.ending[1] = 'Goodnight, Mo. He is sleepy too.';
  assert.ok(assembleStory(req, JSON.stringify(he)), '"He" in a separate sentence from Mo is not caught (accepted limit)');
  he.ending[1] = 'Mo folds his wings. Goodnight.';
  assert.equal(assembleStory(req, JSON.stringify(he)), null);
});
