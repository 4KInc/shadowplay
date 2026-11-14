import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanLine } from '../server/coach.ts';
import { contentProblems } from '../src/story-checks.ts';
import { assembleStory } from '../server/dream.ts';
import { cannedWords } from './fixtures/dream-words.mjs';

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

test('a dreamed story shared on: the server-built story passes, and comes back as a clean copy', async () => {
  const { checkSharedStory } = await import('../src/story-checks.ts');
  const req = { theme: 'sea', shapes: ['rabbit', 'bird', 'cup'] };
  const built = assembleStory(req, cannedWords(req.shapes))!;
  const checked = checkSharedStory(built)!;
  assert.ok(checked);
  assert.equal(checked.beats.length, (built.beats as unknown[]).length);
  // Anything extra is dropped, at the top and in a beat.
  const extra = JSON.parse(JSON.stringify(built));
  extra.payload = '<script>';
  extra.beats[3].onclick = 'x';
  const clean = checkSharedStory(extra)!;
  assert.equal('payload' in clean, false);
  assert.equal('onclick' in clean.beats[3], false);
});

test('a shared story is refused when anything is off', async () => {
  const { checkSharedStory } = await import('../src/story-checks.ts');
  const req = { theme: 'forest', shapes: ['dog', 'fish'] };
  const good = () => JSON.parse(JSON.stringify(assembleStory(req, cannedWords(req.shapes))));
  const cases: [string, (s: { title: string; beats: Record<string, unknown>[] }) => void][] = [
    ['unknown beat type', (s) => (s.beats[2].type = 'goto')],
    ['a brand in a line', (s) => (s.beats.find((b) => b.type === 'narrate')!.text = 'Mo meets Mickey by the sea.')],
    ['wrong hands for the dog', (s) => (s.beats.find((b) => b.type === 'request')!.text = 'Make a dog with cupped hands.')],
    ['an unknown shape', (s) => (s.beats.find((b) => b.type === 'request')!.shape = 'dragon')],
    ['markup in a line', (s) => (s.beats.find((b) => b.type === 'narrate')!.text = 'Hello <b>there</b>')],
    ['no end', (s) => s.beats.pop()],
    ['a repeated id', (s) => (s.beats[1].id = s.beats[0].id)],
    ['a lamp out of range', (s) => (s.beats.find((b) => b.type === 'lamp')!.level = 7)],
  ];
  for (const [name, spoil] of cases) {
    const s = good();
    spoil(s);
    assert.equal(checkSharedStory(s), null, name);
  }
  assert.equal(checkSharedStory({ ...good(), beats: new Array(81).fill({ id: 'a', type: 'end', text: 'x' }) }), null, 'too many beats');
});
