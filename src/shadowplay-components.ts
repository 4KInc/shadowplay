import { createComponent, Types } from '@iwsdk/core';

/** Where the story is performed. */
export const StageModes = {
  Pending: 'pending',
  Wall: 'wall',
  Screen: 'screen',
} as const;

/** Shapes the recognizer can report. */
export const ShapeIds = {
  None: 'none',
  Open: 'open',
  Rabbit: 'rabbit',
  Dog: 'dog',
  Fist: 'fist',
  /** Easier one-hand rabbit: two fingers up, thumb free. */
  Ears: 'ears',
  /** Flat hand, fingers together, thumb tucked along the side. */
  Fish: 'fish',
  /** Two open hands side by side, thumbs together (wings). */
  Bird: 'bird',
  /** Hidden: fist shell, two fingers pointing forward as eye stalks. */
  Snail: 'snail',
  /** Hidden: flat hand bent down from the wrist, a long neck and beak. */
  Swan: 'swan',
  /** Fingers half-curled, as if holding something small (one or two hands). */
  Cup: 'cup',
  /** Hidden two-hand: both hands up, fingers spread as antlers. */
  Deer: 'deer',
  /** Hidden two-hand: two flat hands stacked as snapping jaws. */
  Crocodile: 'crocodile',
} as const;

export const Hands = { None: 'none', Left: 'left', Right: 'right' } as const;

export const PuppetStates = {
  Hidden: 'hidden',
  Outline: 'outline',
  Alive: 'alive',
  Releasing: 'releasing',
} as const;

/** The stage root: the wall region (or floating paper screen) and room dimming. */
export const Stage = createComponent('Stage', {
  mode: { type: Types.Enum, enum: StageModes, default: StageModes.Pending },
  distance: { type: Types.Float32, default: 2, min: 0, max: 5, label: 'Wall distance (m)' },
  width: { type: Types.Float32, default: 1.2, min: 0.2, max: 3, label: 'Stage width (m)' },
  dim: { type: Types.Float32, default: 0.6, min: 0, max: 0.95, label: 'Room dimming' },
  lampOn: { type: Types.Boolean, default: true },
  /** 0..1 lamp brightness; the story flickers it on. */
  lampLevel: { type: Types.Float32, default: 1, min: 0, max: 1 },
  /** 0..1 finale: the released light floods the whole wall. */
  finale: { type: Types.Float32, default: 0, min: 0, max: 1 },
  /** Set to find the wall and place the stage again (e.g. after the player moves). */
  replaceRequested: { type: Types.Boolean, default: false },
  /** Width of the chosen wall (0 for the floating screen). */
  wallWidth: { type: Types.Float32, default: 0 },
  /** Adaptive quality: 0 full, 1 smaller shadow map, 2 also no room-dimming layer. */
  quality: { type: Types.Int8, default: 0, min: 0, max: 2 },
});

/** The desk lamp; its bulb throws every shadow. */
export const DeskLamp = createComponent('DeskLamp', {
  intensity: { type: Types.Float32, default: 6, min: 0, max: 40, label: 'Candela' },
  angleDeg: { type: Types.Float32, default: 38, min: 10, max: 80 },
  /** Set while a hand pinch-drags the lamp along the desk. */
  heldBy: { type: Types.Enum, enum: { None: 'none', Left: 'left', Right: 'right' }, default: 'none' },
});

/** Joint-angle recognizer state, one per stage. */
export const ShapeRecognizer = createComponent('ShapeRecognizer', {
  target: { type: Types.Enum, enum: ShapeIds, default: ShapeIds.None },
  /** Accessibility alternative that also satisfies the request. */
  altTarget: { type: Types.Enum, enum: ShapeIds, default: ShapeIds.None },
  /** Second requested shape, for story choices. */
  target2: { type: Types.Enum, enum: ShapeIds, default: ShapeIds.None },
  altTarget2: { type: Types.Enum, enum: ShapeIds, default: ShapeIds.None },
  /** Accessibility: two-hand shapes are optional (an open hand is also the bird). */
  oneHand: { type: Types.Boolean, default: false },
  /** Free Stage: accept any performable shape, no request needed. */
  freeMode: { type: Types.Boolean, default: false },
  /** Which requested shape (target or target2) was matched. */
  matchedShape: { type: Types.Enum, enum: ShapeIds, default: ShapeIds.None },
  /** True when the match was a two-hand shape. */
  twoHanded: { type: Types.Boolean, default: false },
  tolerance: {
    type: Types.Float32,
    default: 0.3,
    min: 0.1,
    max: 0.6,
    label: 'Tolerance (strict -> forgiving)',
  },
  holdSeconds: { type: Types.Float32, default: 0.5, min: 0.1, max: 2 },
  leftShape: { type: Types.Enum, enum: ShapeIds, default: ShapeIds.None },
  rightShape: { type: Types.Enum, enum: ShapeIds, default: ShapeIds.None },
  leftScore: { type: Types.Float32, default: 0 },
  rightScore: { type: Types.Float32, default: 0 },
  leftInLight: { type: Types.Boolean, default: false },
  rightInLight: { type: Types.Boolean, default: false },
  heldFor: { type: Types.Float32, default: 0 },
  matchedHand: { type: Types.Enum, enum: Hands, default: Hands.None },
});

/** A silhouette character that comes alive when its shape is cast. */
export const ShadowPuppet = createComponent('ShadowPuppet', {
  shape: { type: Types.Enum, enum: ShapeIds, default: ShapeIds.Rabbit },
  state: { type: Types.Enum, enum: PuppetStates, default: PuppetStates.Hidden },
  hand: { type: Types.Enum, enum: Hands, default: Hands.None },
  /** Where the waiting outline sits, as fractions of stage width/height. */
  outlineU: { type: Types.Float32, default: 0 },
  outlineV: { type: Types.Float32, default: 0 },
  /** Current silhouette length as a fraction of stage width (set while alive). */
  size: { type: Types.Float32, default: 0 },
});

export const StoryStatuses = {
  Loading: 'loading',
  Waiting: 'waiting',
  Playing: 'playing',
  Paused: 'paused',
  Ended: 'ended',
} as const;

/** Story engine progress; the beat script lives in public/story/*.story.json. */
export const StoryState = createComponent('StoryState', {
  script: { type: Types.String, default: 'story/the-moth.story.json' },
  /** Resume from the last chapter reached (saved in IndexedDB). */
  resume: { type: Types.Boolean, default: true },
  status: { type: Types.Enum, enum: StoryStatuses, default: StoryStatuses.Loading },
  chapter: { type: Types.String, default: '' },
  beatIndex: { type: Types.Int16, default: -1 },
  beatId: { type: Types.String, default: '' },
  caption: { type: Types.String, default: '' },
  /** Seconds a request waits before the 'show me' ghost hand appears (0 = always, -1 = never). */
  hintAfterSeconds: { type: Types.Float32, default: 15, min: -1, max: 120 },
  hintVisible: { type: Types.Boolean, default: false },
  /** Shape the 'show me' ghost hand demonstrates. */
  hintShape: { type: Types.String, default: 'rabbit' },
  /** After the story: Free Stage, where any discovered creature can be performed. */
  freeStage: { type: Types.Boolean, default: false },
  /** Branch taken at the last choice (for encore endings). */
  branch: { type: Types.String, default: '' },
  /** True while the Shadow Journal is open; the story waits. */
  journalOpen: { type: Types.Boolean, default: false },
  /** Chapter beat ids the player has reached (comma-separated; persisted). */
  unlocked: { type: Types.String, default: '' },
  /** Chapter Three endings seen (comma-separated branch ids; persisted). */
  endings: { type: Types.String, default: '' },
  /** Set to a chapter beat id to jump straight to that chapter. */
  jumpTo: { type: Types.String, default: '' },
  /** Beat whose narration line is playing (or last played). */
  voiceBeat: { type: Types.String, default: '' },
  /** True once the line for voiceBeat has finished (or there is none). */
  voiceDone: { type: Types.Boolean, default: true },
  /** Replaying a performance: beats are entered by the player, not decided by the story. */
  followMode: { type: Types.Boolean, default: false },
  /** Join-in moment inside a replay: the story runs live (the viewer's own hands) without saving progress. */
  joinIn: { type: Types.Boolean, default: false },
  /** Set by the performance player to enter a beat (index) in follow mode; -1 when idle. */
  enterBeat: { type: Types.Int16, default: -1 },
  /** 'Never stuck' assist level for the waiting beat: 0 none, 1-2 looser recognition, 3 any still hand counts. */
  assist: { type: Types.Int8, default: 0, min: 0, max: 3 },
  /** Where the current line comes from: 'clip', 'placeholder' or '' (captions only). */
  voiceSource: { type: Types.String, default: '' },
});

export const MothModes = {
  Hidden: 'hidden',
  Arriving: 'arriving',
  Hovering: 'hovering',
  Following: 'following',
  Riding: 'riding',
  Resting: 'resting',
  /** Tossed about by the storm around her rest point. */
  Buffeted: 'buffeted',
} as const;

/** Mo, the moth who lost her glow. */
export const Moth = createComponent('Moth', {
  mode: { type: Types.Enum, enum: MothModes, default: MothModes.Hidden },
  /** Seconds spent close to a fingertip shadow while Following. */
  followedSeconds: { type: Types.Float32, default: 0 },
  /** Stage-local rest point (fractions of stage width/height, -0.5..0.5). */
  restU: { type: Types.Float32, default: 0 },
  restV: { type: Types.Float32, default: 0.25 },
  /** 0..1 how much of her glow Mo has back (the finale). */
  glow: { type: Types.Float32, default: 0, min: 0, max: 1 },
});

export const ScenerySets = {
  None: 'none',
  Field: 'field',
  River: 'river',
  Forest: 'forest',
  Storm: 'storm',
  Sea: 'sea',
} as const;

/** Background silhouette set drawn behind the characters. */
export const Scenery = createComponent('Scenery', {
  set: { type: Types.Enum, enum: ScenerySets, default: ScenerySets.None },
});

export const ActorStates = {
  Hidden: 'hidden',
  Blocking: 'blocking',
  Fleeing: 'fleeing',
  Dozing: 'dozing',
} as const;

/** Story-controlled shadow characters that are not puppets (the wolf). */
export const StageActor = createComponent('StageActor', {
  actor: { type: Types.Enum, enum: { Wolf: 'wolf' }, default: 'wolf' },
  state: { type: Types.Enum, enum: ActorStates, default: ActorStates.Hidden },
  u: { type: Types.Float32, default: 0.3 },
  v: { type: Types.Float32, default: -0.12 },
});

/** The desk book that collects every creature discovered (IndexedDB-backed). */
export const ShadowJournal = createComponent('ShadowJournal', {
  open: { type: Types.Boolean, default: false },
  count: { type: Types.Int16, default: 0 },
  /** Set by the story to record a creature; the journal system consumes it. */
  pendingAdd: { type: Types.String, default: '' },
  lastAdded: { type: Types.String, default: '' },
  /** Comma-separated discovered creature ids (mirror of the IndexedDB store). */
  discovered: { type: Types.String, default: '' },
});

/** Something hidden in the dark that only shows where the lamp's light falls. */
export const HiddenProp = createComponent('HiddenProp', {
  prop: { type: Types.Enum, enum: { Hollow: 'hollow' }, default: 'hollow' },
  active: { type: Types.Boolean, default: false },
  /** Horizontal position as a fraction of stage width; it stands on the stage floor. */
  u: { type: Types.Float32, default: -0.34 },
  /** 0..1 how brightly the light pool currently reveals it. */
  revealed: { type: Types.Float32, default: 0 },
});

/** Shape of the Day: a daily riddle whose answer is a shape. */
export const DailyShape = createComponent('DailyShape', {
  date: { type: Types.String, default: '' },
  shape: { type: Types.String, default: '' },
  riddle: { type: Types.String, default: '' },
  solved: { type: Types.Boolean, default: false },
});

export const ToleranceLevels = {
  Strict: 'strict',
  Normal: 'normal',
  Forgiving: 'forgiving',
  VeryForgiving: 'very-forgiving',
} as const;

export const HintModes = { Off: 'off', Delayed: 'delayed', Always: 'always' } as const;

/** Player accessibility options (persisted in IndexedDB), shown beside the open journal. */
export const Settings = createComponent('Settings', {
  tolerance: { type: Types.Enum, enum: ToleranceLevels, default: ToleranceLevels.Normal },
  hints: { type: Types.Enum, enum: HintModes, default: HintModes.Delayed },
  /** Two-hand shapes become optional: their one-hand alternative works everywhere. */
  oneHand: { type: Types.Boolean, default: false },
  /** Test-only: speak captions with an on-device synthetic voice until real narration exists. */
  placeholderVoice: { type: Types.Boolean, default: false },
  /** Set by the panel; the story system restarts from the Prologue and clears it. */
  replayRequested: { type: Types.Boolean, default: false },
});

/**
 * Recognition method 2: silhouette matching. Each hand's shadow is rendered
 * from the lamp into a tiny buffer a few times per second and compared with
 * stored silhouette templates (intersection over union).
 */
export const SilhouetteMatcher = createComponent('SilhouetteMatcher', {
  enabled: { type: Types.Boolean, default: true },
  /** Overlap needed to count as a match (the brief starts around 55%). */
  threshold: { type: Types.Float32, default: 0.55, min: 0.3, max: 0.9 },
  /** Readbacks per second. */
  rateHz: { type: Types.Float32, default: 5, min: 1, max: 15 },
  leftShape: { type: Types.String, default: '' },
  leftOverlap: { type: Types.Float32, default: 0 },
  rightShape: { type: Types.String, default: '' },
  rightOverlap: { type: Types.Float32, default: 0 },
  templateCount: { type: Types.Int16, default: 0 },
  /** Dev recorder: a shape id captures the next in-light hand shadow as a template; '!clear' wipes recordings. */
  recordShape: { type: Types.String, default: '' },
  lastRecorded: { type: Types.String, default: '' },
});

/**
 * Recognition lab for the week-1 device gate. Set `label` (a shape id, or
 * 'negative' for hands moving or resting in the light) and `recording`; each
 * trial logs both recognition methods per frame for `trialSeconds`. Set
 * `exportRequested` to get a confusion matrix and false-match rates in
 * `report` (and the console). Trials persist so several testers can be pooled.
 */
export const RecognitionLab = createComponent('RecognitionLab', {
  tester: { type: Types.String, default: 'tester-1' },
  label: { type: Types.String, default: '' },
  trialSeconds: { type: Types.Float32, default: 5, min: 1, max: 30 },
  recording: { type: Types.Boolean, default: false },
  trials: { type: Types.Int16, default: 0 },
  status: { type: Types.String, default: '' },
  exportRequested: { type: Types.Boolean, default: false },
  clearRequested: { type: Types.Boolean, default: false },
  report: { type: Types.String, default: '' },
  /** Run every synthetic pose fixture for every synthetic tester (no headset needed). */
  autoRun: { type: Types.Boolean, default: false },
  syntheticReport: { type: Types.String, default: '' },
});

/**
 * Development: drive the hands from a webcam (MediaPipe hand landmarks mapped
 * to WebXR joints) so real people's hands can test recognition and record
 * silhouette templates without a headset. Toggle with the W key in dev builds.
 */
export const WebcamHands = createComponent('WebcamHands', {
  enabled: { type: Types.Boolean, default: false },
  status: { type: Types.String, default: '' },
  handsSeen: { type: Types.Int8, default: 0 },
});

/**
 * Development: performs the story with synthetic hands (pose fixtures) so a
 * run can be screen-recorded from the emulator without a headset. Toggle with
 * the D key in dev builds.
 */
export const DemoDirector = createComponent('DemoDirector', {
  playing: { type: Types.Boolean, default: false },
  /** Which Chapter Three ending to perform. */
  branch: { type: Types.Enum, enum: { Dog: 'dog', Bird: 'bird' }, default: 'dog' },
  /** Show the capsule hands (dark) so viewers can see what casts the shadows. */
  showHands: { type: Types.Boolean, default: false },
  status: { type: Types.String, default: '' },
});

/** Records a performance (hands, story beats, voice) on this stage. */
export const PerformanceRecorder = createComponent('PerformanceRecorder', {
  recording: { type: Types.Boolean, default: false },
  title: { type: Types.String, default: 'A bedtime story' },
  performer: { type: Types.String, default: '' },
  /** Record the performer's voice (asks for the microphone). */
  withVoice: { type: Types.Boolean, default: true },
  status: { type: Types.String, default: '' },
  /** Id of the last saved recording. */
  lastId: { type: Types.String, default: '' },
  seconds: { type: Types.Float32, default: 0 },
});

/** Replays a recorded performance on this stage (any device, in or out of XR). */
export const PerformancePlayer = createComponent('PerformancePlayer', {
  recordingId: { type: Types.String, default: '' },
  playing: { type: Types.Boolean, default: false },
  paused: { type: Types.Boolean, default: false },
  /** Let the viewer join in: at each shape request the replay waits for their own hands. */
  joinIn: { type: Types.Boolean, default: false },
  /** True while a join-in moment is waiting for (or being performed by) the viewer. */
  inJoinIn: { type: Types.Boolean, default: false },
  /** Seconds into the performance. */
  position: { type: Types.Float32, default: 0 },
  duration: { type: Types.Float32, default: 0 },
  status: { type: Types.String, default: '' },
});
