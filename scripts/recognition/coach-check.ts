/**
 * Device-free check of what Mo the coach is told (npm run test:coach): the
 * synthetic hands from the recognition sweep, posed right and wrong, give the
 * facts a person would point out, and every fact has words.
 */
import { Vector3 } from '@iwsdk/core';
import { coachFacts, type CoachHand } from '../../src/coach-facts';
import { FACTS, localLine } from '../../src/coach-vocab';
import { computeFeatures } from '../../src/hand-features';
import { FIXTURES, localJoints, toWorld } from '../../src/hand-poses';

let failed = 0;
const check = (name: string, ok: boolean, detail: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

const right = new Vector3(1, 0, 0);
const up = new Vector3(0, 1, 0);
const normal = new Vector3(0, 0, 1);
function hand(label: string, side: 'left' | 'right', at: [number, number] = [0, 0]): CoachHand {
  const fixture = FIXTURES.find((f) => f.label === label)!;
  const pose = side === 'right' ? fixture.right : fixture.left ?? fixture.right;
  const joints = toWorld(localJoints(pose!, 1, 37), side, new Vector3(at[0], 1.2 + at[1], -0.5), right, up, normal, new Float32Array(75));
  const features = new Float32Array(9);
  computeFeatures(joints, features);
  return { tracked: true, joints, features };
}
const none: CoachHand = { tracked: false, joints: new Float32Array(75), features: new Float32Array(9) };

// The right shape: nothing to fix.
for (const s of ['rabbit', 'fish', 'dog', 'snail', 'swan', 'cup']) {
  const facts = coachFacts(s, none, hand(s, 'right'));
  check(`${s} made right: "almost"`, facts.length === 1 && facts[0] === 'almost', facts);
}
// Wrong shapes: the facts name what differs.
const rabbitFromOpen = coachFacts('rabbit', none, hand('open', 'right'));
check('asked for a rabbit, open hand: curl ring/pinky or thumb to touch', rabbitFromOpen.some((f) => ['ring-curl', 'pinky-curl', 'thumb-touch'].includes(f)), rabbitFromOpen);
const fishFromOpen = coachFacts('fish', none, hand('open', 'right'));
check('asked for a fish, open hand: tuck the thumb / fingers together / level', fishFromOpen.some((f) => ['thumb-tuck', 'fingers-together', 'point-level'].includes(f)), fishFromOpen);
const rabbitFromFist = coachFacts('rabbit', none, hand('fist', 'right'));
check('asked for a rabbit, fist: straighten index/middle', rabbitFromFist.some((f) => ['index-straighten', 'middle-straighten'].includes(f)), rabbitFromFist);
// Two-hand bird.
check('bird with one hand: needs both', coachFacts('bird', none, hand('bird', 'right'))[0] === 'one-hand-seen', null);
check('bird, both hands right: almost', coachFacts('bird', hand('bird', 'left', [-0.06, 0]), hand('bird', 'right', [0.06, 0]))[0] === 'almost', null);
const apart = coachFacts('bird', hand('bird', 'left', [-0.3, 0]), hand('bird', 'right', [0.3, 0]));
check('bird, hands far apart: bring them together', apart.includes('hands-apart'), apart);
check('one-hand mode: the bird is an open hand', coachFacts('bird', none, hand('open', 'right'), true)[0] === 'almost', null);
check('no hands: say so', coachFacts('rabbit', none, none)[0] === 'no-hands', null);
// Words for every fact.
const missing = Object.keys(FACTS).filter((f) => !localLine('rabbit', [f]) || localLine('rabbit', [f]).length > 110);
check('every fact has a short local line', missing.length === 0, missing);

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
if (failed) process.exitCode = 1;
