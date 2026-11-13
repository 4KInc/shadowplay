/**
 * The words Mo the coach can use: every fact id the app may send, in plain
 * English, and a kind line built from them when no AI is available. No
 * imports, so the server shares it (prompt building, validation) with the app.
 */
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

/** Every fact Mo can be told, and the plain words for it (used by the server's prompt and the local fallback). */
export const FACTS: Readonly<Record<string, string>> = {
  'no-hands': 'no hands are in view of the headset',
  'one-hand-seen': 'only one hand is in view, and this shape needs both',
  'hands-apart': 'the two hands are too far apart; the wrists should nearly touch',
  'hands-stacked': 'the hands are stacked one above the other instead of side by side',
  'fingers-curled': 'the fingers are curled; they should be straight like wings',
  ...Object.fromEntries(FINGERS.flatMap((f) => [
    [`${f}-straighten`, `the ${f === 'thumb' ? 'thumb' : `${f} finger`} should be straighter`],
    [`${f}-curl`, `the ${f === 'thumb' ? 'thumb' : `${f} finger`} should be curled down`],
  ])),
  'fingers-together': 'the fingers should be held together',
  'fingers-apart': 'the fingers should be spread apart',
  'thumb-touch': 'the thumb tip should touch the middle or ring finger tip',
  'thumb-off': 'the thumb should not touch the other fingertips',
  'thumb-out': 'the thumb should stick out from the hand',
  'thumb-tuck': 'the thumb should be tucked along the side of the hand',
  'point-up': 'the fingers should point up',
  'point-level': 'the hand should be level, fingers pointing forward',
  'point-down': 'the fingers should point down',
  almost: 'the shape is very nearly right; it just needs holding still',
};

/** Shapes Mo can coach (the rest get a general line). */
export const COACHED_SHAPES = ['rabbit', 'dog', 'fish', 'bird', 'cup', 'snail', 'swan'] as const;

/** Mo's words without AI: a short, kind line from the facts (the fallback, and the line when offline). */
/** Mo's own words for each fact: one plain instruction (used when no AI words the tip). */
const LOCAL_TIPS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(FINGERS.flatMap((f) => {
    const name = f === 'thumb' ? 'thumb' : f === 'pinky' ? 'little finger' : `${f} finger`;
    return [
      [`${f}-straighten`, `straighten your ${name}.`],
      [`${f}-curl`, `curl your ${name} down.`],
    ];
  })),
  'fingers-together': 'hold your fingers together.',
  'fingers-apart': 'spread your fingers apart.',
  'thumb-touch': 'touch your thumb tip to your middle or ring finger.',
  'thumb-off': 'keep your thumb away from your fingertips.',
  'thumb-out': 'let your thumb stick out.',
  'thumb-tuck': 'tuck your thumb along the side of your hand.',
  'point-up': 'point your fingers up.',
  'point-level': 'keep your hand level, fingers pointing forward.',
  'point-down': 'point your fingers down.',
  'one-hand-seen': 'it needs both hands. Bring the other one in!',
  'hands-apart': 'bring your wrists close, almost touching.',
  'hands-stacked': 'put your hands side by side, not one on top.',
  'fingers-curled': 'straighten your fingers, like wings.',
};

/** Mo's words without AI: a short, kind line from the facts (the fallback, and the line when offline). */
export function localLine(shape: string, facts: readonly string[]): string {
  const first = facts[0];
  if (!first || first === 'almost') return `So close! Hold your ${shape} very still for me.`;
  if (first === 'no-hands') return 'I cannot see your hands. Lift them into the lamplight!';
  const tip = LOCAL_TIPS[first];
  return tip ? `Psst! For the ${shape}, ${tip}` : `Let's try the ${shape} together. Watch the ghost hand.`;
}
