/**
 * Voice commands: spoken alternatives for the hand interactions. Pure (no ECS,
 * no DOM) so the phrase list can be unit-tested. Commands are short: anything
 * longer than MAX_WORDS is someone talking (or the narration), not a command.
 */

export type VoiceCommand =
  /** Make this shape (wakes the creature when the story asks for it). */
  | { kind: 'shape'; shape: string }
  /** Open, close or toggle the Shadow Journal. */
  | { kind: 'journal'; open: boolean | null }
  /** The lamp switch: off pauses the story, on carries on. */
  | { kind: 'lamp'; on: boolean }
  /** Finish a beat that asks the hands to move (follow Mo, carry, grow, let go). */
  | { kind: 'next' }
  /** Press a panel button, by its id. */
  | { kind: 'press'; id: string }
  /** Ask Mo for a tip on the shape the story wants. */
  | { kind: 'help' }
  /** Turn a setting on or off (null: toggle). */
  | { kind: 'setting'; which: 'oneHand' | 'highContrast' | 'gazeDwell' | 'forgiving' | 'voiceCommands'; on: boolean | null };

export const MAX_WORDS = 6;

/** Spoken names for each shape (story shapes and the hidden ones). */
const SHAPES: Readonly<Record<string, readonly string[]>> = {
  rabbit: ['rabbit', 'bunny', 'hare'],
  dog: ['dog', 'doggy', 'puppy', 'wolf dog'],
  fish: ['fish', 'fishy'],
  bird: ['bird', 'birdie', 'wings'],
  cup: ['cup', 'cupped hands', 'cup of light'],
  snail: ['snail'],
  swan: ['swan'],
  deer: ['deer', 'reindeer', 'antlers'],
  crocodile: ['crocodile', 'croc', 'alligator'],
};

/** Phrase -> command, checked longest phrase first so "close the journal" beats "journal". */
const PHRASES: readonly [string, VoiceCommand][] = [
  ['open the journal', { kind: 'journal', open: true }],
  ['open journal', { kind: 'journal', open: true }],
  ['open the book', { kind: 'journal', open: true }],
  ['close the journal', { kind: 'journal', open: false }],
  ['close journal', { kind: 'journal', open: false }],
  ['close the book', { kind: 'journal', open: false }],
  ['journal', { kind: 'journal', open: null }],
  ['settings', { kind: 'journal', open: true }],
  ['pause', { kind: 'lamp', on: false }],
  ['lamp off', { kind: 'lamp', on: false }],
  ['stop the story', { kind: 'lamp', on: false }],
  ['lamp on', { kind: 'lamp', on: true }],
  ['continue', { kind: 'lamp', on: true }],
  ['resume', { kind: 'lamp', on: true }],
  ['carry on', { kind: 'lamp', on: true }],
  ['go on', { kind: 'next' }],
  ['keep going', { kind: 'next' }],
  ['next', { kind: 'next' }],
  ['done', { kind: 'next' }],
  ['let go', { kind: 'next' }],
  ['help', { kind: 'help' }],
  ['help me', { kind: 'help' }],
  ['how do i make it', { kind: 'help' }],
  ['mo help', { kind: 'help' }],
  ['move stage here', { kind: 'press', id: 'replace-stage-button' }],
  ['move the stage', { kind: 'press', id: 'replace-stage-button' }],
  ['start again', { kind: 'press', id: 'replay-button' }],
  ['replay the story', { kind: 'press', id: 'replay-button' }],
  ['next story', { kind: 'press', id: 'story-next' }],
  ['previous story', { kind: 'press', id: 'story-prev' }],
  ['tell this story', { kind: 'press', id: 'story-start' }],
  ['record a story', { kind: 'press', id: 'record-button' }],
  ['stop recording', { kind: 'press', id: 'record-button' }],
  ['send to family', { kind: 'press', id: 'send-button' }],
  ['goodnights', { kind: 'press', id: 'inbox-button' }],
  ['go live', { kind: 'press', id: 'live-button' }],
  ['end live story', { kind: 'press', id: 'live-button' }],
  ['take turns', { kind: 'press', id: 'duet-button' }],
  ['one hand mode on', { kind: 'setting', which: 'oneHand', on: true }],
  ['one hand mode off', { kind: 'setting', which: 'oneHand', on: false }],
  ['one hand mode', { kind: 'setting', which: 'oneHand', on: null }],
  ['high contrast on', { kind: 'setting', which: 'highContrast', on: true }],
  ['high contrast off', { kind: 'setting', which: 'highContrast', on: false }],
  ['high contrast', { kind: 'setting', which: 'highContrast', on: null }],
  ['look to press on', { kind: 'setting', which: 'gazeDwell', on: true }],
  ['look to press off', { kind: 'setting', which: 'gazeDwell', on: false }],
  ['look to press', { kind: 'setting', which: 'gazeDwell', on: null }],
  ['forgiving shapes', { kind: 'setting', which: 'forgiving', on: true }],
  ['normal shapes', { kind: 'setting', which: 'forgiving', on: false }],
  ['voice commands off', { kind: 'setting', which: 'voiceCommands', on: false }],
  ['stop listening', { kind: 'setting', which: 'voiceCommands', on: false }],
];

const ORDERED = [
  ...PHRASES,
  ...Object.entries(SHAPES).flatMap(([shape, names]) => names.map((n): [string, VoiceCommand] => [n, { kind: 'shape', shape }])),
].sort((a, b) => b[0].length - a[0].length);

/** Every phrase, for the speech service's phrase hints. */
export const COMMAND_PHRASES: readonly string[] = [...new Set(ORDERED.map(([p]) => p))];

/** Lower case, words only ("One-hand mode!" -> "one hand mode"). */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(please |okay |ok |um |uh )+/, '')
    .replace(/( please)$/, '');
}

/** The command in a short utterance, or null (unknown, or too long to be a command). */
export function parseCommand(text: string): VoiceCommand | null {
  const said = normalise(text);
  if (!said || said.split(' ').length > MAX_WORDS) return null;
  const padded = ` ${said} `;
  // "Make a rabbit", "the bird", "rabbit please": the phrase anywhere, as whole words.
  for (const [phrase, command] of ORDERED) if (padded.includes(` ${phrase} `)) return command;
  return null;
}

/** What was understood, as a short line for the stage ('' to show nothing). */
export function describe(command: VoiceCommand): string {
  switch (command.kind) {
    case 'shape':
      return command.shape;
    case 'journal':
      return command.open === false ? 'close the journal' : command.open ? 'open the journal' : 'journal';
    case 'lamp':
      return command.on ? 'continue' : 'pause';
    case 'next':
      return 'go on';
    case 'help':
      return 'help';
    case 'press':
      return (PHRASES.find(([, c]) => c.kind === 'press' && c.id === command.id)?.[0]) ?? command.id;
    case 'setting':
      return `${command.which === 'oneHand' ? 'one-hand mode' : command.which === 'highContrast' ? 'high contrast' : command.which === 'gazeDwell' ? 'look to press' : command.which === 'forgiving' ? 'forgiving shapes' : 'voice commands'}${command.on === null ? '' : command.on ? ' on' : ' off'}`;
  }
}
