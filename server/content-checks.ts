/**
 * Checks shared by Mo's tips and dreamed stories on top of each one's own:
 * no well-known characters or brands (the competition's no-brands rule), Mo is
 * "she" (as in the library stories), and no hand position that belongs to a
 * different shape (a model sometimes tells a child to cross their wrists, or to
 * cup their hands for a dog).
 */

/** Well-known characters and brands a model might reach for in a bedtime story. */
const BRANDS =
  /\b(snoopy|mickey|minnie|disney|pixar|pokemon|pikachu|elsa|frozen|peppa|bluey|spongebob|barbie|lego|minecraft|marvel|batman|superman|spider-?man|elmo|sesame|winnie|pooh|tigger|dumbo|bambi|nemo|simba|paw patrol|cocomelon|hello kitty|garfield|scooby|looney|bugs bunny|peter rabbit|clifford|paddington|gruffalo|meta|google)\b/i;

/** Mo called "he": the stories say "she". */
const MO_HE = /\bMo\b[^.!?]*\b(he|his|him|himself)\b/i;

/** Hand positions no shape here uses, and ones that belong only to two-hand or cupped shapes. */
const NEVER_POSE = /\bcross(ed|ing)? (your |the |their )?(wrists|hands|arms|fingers)\b/i;
const TWO_HAND_POSE = /\b(both hands|two hands|side by side|thumbs? (hooked|linked|together)|hook(ed)? (your )?thumbs|link(ed)? (your )?thumbs)\b/i;
const CUPPED_POSE = /\bcupp?(ed)?\b/i;

/** Problems with a line (empty when it is fine). `shape` is the shape the line is about, if any. */
export function contentProblems(line: string, shape?: string): string[] {
  const problems: string[] = [];
  if (BRANDS.test(line)) problems.push('brand or character');
  if (MO_HE.test(line)) problems.push('Mo is "she"');
  if (NEVER_POSE.test(line)) problems.push('crossed hands');
  if (shape && shape !== 'bird' && shape !== 'cup' && TWO_HAND_POSE.test(line)) problems.push(`two-hand pose for a ${shape}`);
  if (shape && shape !== 'cup' && CUPPED_POSE.test(line)) problems.push(`cupped hands for a ${shape}`);
  return problems;
}
