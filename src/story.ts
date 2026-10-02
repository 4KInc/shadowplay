import { createSystem, Entity, VisibilityState } from '@iwsdk/core';
import { loadProgress, saveProgress } from './journal-store.js';
import {
  HiddenProp,
  Moth,
  PuppetStates,
  Scenery,
  Settings,
  ShadowJournal,
  ShadowPuppet,
  ShapeIds,
  ShapeRecognizer,
  Stage,
  StageActor,
  StoryState,
  StoryStatuses,
} from './shadowplay-components.js';
import { loadStoryScript, readingSeconds, StoryBeat, StoryScript } from './story-script.js';
import { stageRuntime } from './stage-runtime.js';

const CHAPTER_SECONDS = 3.2;
const LAMP_SECONDS = 1.8;
const GROW_HOLD_SECONDS = 0.6;
const CONTINUE_HOLD_SECONDS = 1.0;
const REVEAL_HOLD_SECONDS = 0.8;
const LETGO_HOLD_SECONDS = 0.5;
const PAUSED_CAPTION = 'Paused. Pinch the lamp switch to continue.';
const JOURNAL_CAPTION = 'Your Shadow Journal. Pinch the book to close it.';

/** Lamp flicker envelope for the prologue: stutters, catches, then warms up. */
function flicker(t: number): number {
  if (t < 0.25) return 0;
  if (t < 0.35) return 0.55;
  if (t < 0.6) return 0.05;
  if (t < 0.72) return 0.8;
  if (t < 0.82) return 0.25;
  return Math.min(1, 0.5 + (t - 0.82) / 1.2);
}

/**
 * Plays the beat script: captions, lamp, moth, scenery, actors, shape requests
 * and choices. Waits (never fails) on player beats, pauses while the lamp is
 * off, the headset is removed or the journal is open, and saves progress at
 * each chapter so a returning player resumes where they left off.
 */
export class StorySystem extends createSystem({
  stories: { required: [StoryState] },
  stages: { required: [Stage, ShapeRecognizer] },
  puppets: { required: [ShadowPuppet] },
  moths: { required: [Moth] },
  scenery: { required: [Scenery] },
  actors: { required: [StageActor] },
  journals: { required: [ShadowJournal] },
  props: { required: [HiddenProp] },
  settings: { required: [Settings] },
}) {
  private script: StoryScript | null = null;
  private beatTime = 0;
  /** Time the current player condition (grow/continue) has been held. */
  private holdTime = 0;
  private beatCaption = '';
  private blurred = false;
  private loading = false;
  private resumeAt = -1;
  private lastAliveShape: string = ShapeIds.None;
  /** Puppet size when the current grow beat began. */
  private growFrom = 0;

  init(): void {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        this.blurred = state === VisibilityState.VisibleBlurred;
      }),
    );
  }

  /** Story entities may exist before this system registers, so load lazily. */
  private load(story: Entity): void {
    this.loading = true;
    const resume = Boolean(story.getValue(StoryState, 'resume'));
    Promise.all([loadStoryScript(story.getValue(StoryState, 'script') ?? ''), resume ? loadProgress() : null])
      .then(([script, progress]) => {
        this.script = script;
        if (progress && progress.beatIndex > 0 && progress.beatIndex < script.beats.length) {
          this.resumeAt = progress.beatIndex;
          story.setValue(StoryState, 'branch', progress.branch ?? '');
        }
        story.setValue(StoryState, 'status', StoryStatuses.Waiting);
      })
      .catch((error: unknown) => console.error('[shadowplay] story load failed', error));
  }

  update(delta: number): void {
    const story = first(this.queries.stories.entities);
    const stage = first(this.queries.stages.entities);
    if (story && !this.script && !this.loading) this.load(story);
    if (!story || !stage || !this.script) return;
    const settings = first(this.queries.settings.entities);
    if (settings?.getValue(Settings, 'replayRequested')) {
      settings.setValue(Settings, 'replayRequested', false);
      this.restart(story, stage);
    }
    const status = story.getValue(StoryState, 'status');
    if (status === StoryStatuses.Ended) return;
    if (!stageRuntime.ready) {
      setIfChanged(story, 'status', StoryStatuses.Waiting);
      return;
    }

    const journalOpen = Boolean(first(this.queries.journals.entities)?.getValue(ShadowJournal, 'open'));
    if (story.getValue(StoryState, 'journalOpen') !== journalOpen) story.setValue(StoryState, 'journalOpen', journalOpen);
    const paused = !stage.getValue(Stage, 'lampOn') || this.blurred || journalOpen;
    if (paused) {
      setIfChanged(story, 'status', StoryStatuses.Paused);
      setIfChanged(story, 'caption', journalOpen ? JOURNAL_CAPTION : PAUSED_CAPTION);
      return;
    }
    if (status === StoryStatuses.Paused) story.setValue(StoryState, 'caption', this.beatCaption);
    setIfChanged(story, 'status', StoryStatuses.Playing);

    let index = story.getValue(StoryState, 'beatIndex') ?? -1;
    if (index < 0) {
      if (this.resumeAt > 0) {
        // Returning player: the lamp is already lit; start at their chapter.
        stage.setValue(Stage, 'lampLevel', 1);
        index = this.enter(story, stage, this.resumeAt);
        this.resumeAt = -1;
      } else {
        index = this.enter(story, stage, 0);
      }
    }
    const beat = this.script.beats[index];
    if (!beat) return;
    this.beatTime += delta;
    const next = this.run(beat, story, stage, delta);
    if (next !== null) {
      this.exit(beat, story);
      if (next < this.script.beats.length) this.enter(story, stage, next);
      else story.setValue(StoryState, 'status', StoryStatuses.Ended);
    }
  }

  /** Replay from the Prologue: reset every story-driven actor; keep the journal. */
  private restart(story: Entity, stage: Entity): void {
    this.resumeAt = -1;
    this.beatTime = 0;
    this.holdTime = 0;
    this.growFrom = 0;
    this.lastAliveShape = ShapeIds.None;
    story.setValue(StoryState, 'beatIndex', -1);
    story.setValue(StoryState, 'status', StoryStatuses.Waiting);
    story.setValue(StoryState, 'freeStage', false);
    story.setValue(StoryState, 'branch', '');
    story.setValue(StoryState, 'chapter', '');
    story.setValue(StoryState, 'hintVisible', false);
    this.setCaption(story, '');
    stage.setValue(Stage, 'lampOn', true);
    stage.setValue(Stage, 'lampLevel', 0);
    stage.setValue(Stage, 'finale', 0);
    this.setTargets(stage, ShapeIds.None, ShapeIds.None, ShapeIds.None, ShapeIds.None);
    stage.setValue(ShapeRecognizer, 'freeMode', false);
    for (const p of this.queries.puppets.entities) {
      const alive = p.getValue(ShadowPuppet, 'state') === PuppetStates.Alive;
      p.setValue(ShadowPuppet, 'state', alive ? PuppetStates.Releasing : PuppetStates.Hidden);
    }
    for (const m of this.queries.moths.entities) {
      m.setValue(Moth, 'mode', 'hidden');
      m.setValue(Moth, 'glow', 0);
      m.setValue(Moth, 'followedSeconds', 0);
    }
    for (const e of this.queries.scenery.entities) e.setValue(Scenery, 'set', 'none');
    for (const a of this.queries.actors.entities) a.setValue(StageActor, 'state', 'hidden');
    for (const p of this.queries.props.entities) p.setValue(HiddenProp, 'active', false);
    for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'open', false);
    void saveProgress({ beatIndex: 0, chapter: 'Prologue', branch: '', savedAt: Date.now() });
  }

  private indexOf(id: string): number {
    return this.script!.beats.findIndex((b) => b.id === id);
  }

  private setCaption(story: Entity, text: string): void {
    this.beatCaption = text;
    story.setValue(StoryState, 'caption', text);
  }

  private setTargets(stage: Entity, t1: string, a1: string, t2: string, a2: string): void {
    stage.setValue(ShapeRecognizer, 'target', t1 as never);
    stage.setValue(ShapeRecognizer, 'altTarget', a1 as never);
    stage.setValue(ShapeRecognizer, 'target2', t2 as never);
    stage.setValue(ShapeRecognizer, 'altTarget2', a2 as never);
    stage.setValue(ShapeRecognizer, 'heldFor', 0);
  }

  private showOutline(shape: string, u = 0, v = 0): void {
    const p = this.puppetFor(shape);
    if (!p) return;
    p.setValue(ShadowPuppet, 'outlineU', u);
    p.setValue(ShadowPuppet, 'outlineV', v);
    if (p.getValue(ShadowPuppet, 'state') !== PuppetStates.Alive) {
      p.setValue(ShadowPuppet, 'state', PuppetStates.Outline);
    }
  }

  private enter(story: Entity, stage: Entity, index: number): number {
    const beat = this.script!.beats[index];
    this.beatTime = 0;
    this.holdTime = 0;
    this.growFrom = 0;
    story.setValue(StoryState, 'beatIndex', index);
    story.setValue(StoryState, 'beatId', beat.id);
    if ('text' in beat) this.setCaption(story, beat.text);
    switch (beat.type) {
      case 'chapter':
        story.setValue(StoryState, 'chapter', beat.chapter);
        void saveProgress({
          beatIndex: index,
          chapter: beat.chapter,
          branch: story.getValue(StoryState, 'branch') ?? '',
          savedAt: Date.now(),
        });
        break;
      case 'moth':
        for (const moth of this.queries.moths.entities) {
          moth.setValue(Moth, 'mode', beat.mode as never);
          if (beat.restU !== undefined) moth.setValue(Moth, 'restU', beat.restU);
          if (beat.restV !== undefined) moth.setValue(Moth, 'restV', beat.restV);
        }
        break;
      case 'scenery':
        for (const e of this.queries.scenery.entities) e.setValue(Scenery, 'set', beat.set as never);
        break;
      case 'actor':
        for (const a of this.queries.actors.entities) {
          if (beat.u !== undefined) a.setValue(StageActor, 'u', beat.u);
          if (beat.v !== undefined) a.setValue(StageActor, 'v', beat.v);
          a.setValue(StageActor, 'state', beat.state as never);
        }
        break;
      case 'follow':
        for (const moth of this.queries.moths.entities) {
          moth.setValue(Moth, 'mode', 'following');
          moth.setValue(Moth, 'followedSeconds', 0);
        }
        break;
      case 'request':
        story.setValue(StoryState, 'hintShape', beat.shape);
        this.setTargets(stage, beat.shape, beat.alt ?? ShapeIds.None, ShapeIds.None, ShapeIds.None);
        this.showOutline(beat.shape, beat.outlineU, beat.outlineV);
        break;
      case 'choice': {
        const [a, b] = beat.options;
        story.setValue(StoryState, 'hintShape', a.shape);
        this.setTargets(stage, a.shape, a.alt ?? ShapeIds.None, b?.shape ?? ShapeIds.None, b?.alt ?? ShapeIds.None);
        for (const o of beat.options) this.showOutline(o.shape, o.outlineU, o.outlineV);
        break;
      }
      case 'release':
        this.setTargets(stage, ShapeIds.None, ShapeIds.None, ShapeIds.None, ShapeIds.None);
        for (const p of this.queries.puppets.entities) {
          const state = p.getValue(ShadowPuppet, 'state');
          if (state === PuppetStates.Alive) p.setValue(ShadowPuppet, 'state', PuppetStates.Releasing);
          else if (state === PuppetStates.Outline) p.setValue(ShadowPuppet, 'state', PuppetStates.Hidden);
        }
        break;
      case 'journal': {
        const creature = beat.creature === '$last' ? this.lastAliveShape : beat.creature;
        const text = beat.text.replace('$name', creature.charAt(0).toUpperCase() + creature.slice(1));
        this.setCaption(story, text);
        for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'pendingAdd', creature);
        break;
      }
      case 'end':
        this.setTargets(stage, ShapeIds.None, ShapeIds.None, ShapeIds.None, ShapeIds.None);
        break;
      case 'prop':
        for (const p of this.queries.props.entities) {
          if (beat.u !== undefined) p.setValue(HiddenProp, 'u', beat.u);
          p.setValue(HiddenProp, 'active', beat.active);
        }
        break;
      case 'freestage':
        // The story is over: Mo keeps her glow and every creature is free to play.
        stage.setValue(Stage, 'lampLevel', 1);
        stage.setValue(Stage, 'finale', 0);
        this.setTargets(stage, ShapeIds.None, ShapeIds.None, ShapeIds.None, ShapeIds.None);
        stage.setValue(ShapeRecognizer, 'freeMode', true);
        story.setValue(StoryState, 'freeStage', true);
        for (const m of this.queries.moths.entities) {
          m.setValue(Moth, 'glow', 1);
          if (m.getValue(Moth, 'mode') === 'hidden') m.setValue(Moth, 'mode', 'hovering');
        }
        void saveProgress({ beatIndex: index, chapter: 'Free Stage', branch: story.getValue(StoryState, 'branch') ?? '', savedAt: Date.now() });
        break;
      default:
        break;
    }
    return index;
  }

  /** Returns the next beat index when the beat is complete, otherwise null. */
  private run(beat: StoryBeat, story: Entity, stage: Entity, delta: number): number | null {
    const t = this.beatTime;
    const index = story.getValue(StoryState, 'beatIndex') ?? 0;
    const done = index + 1;
    switch (beat.type) {
      case 'chapter':
        return t >= CHAPTER_SECONDS ? done : null;
      case 'narrate':
        return t >= (beat.seconds ?? readingSeconds(beat.text)) ? done : null;
      case 'release':
      case 'journal':
        return t >= readingSeconds(this.beatCaption) ? done : null;
      case 'lamp':
        stage.setValue(Stage, 'lampLevel', beat.level * flicker(t));
        return t >= LAMP_SECONDS ? done : null;
      case 'moth':
      case 'scenery':
      case 'actor':
        return done;
      case 'goto':
        return this.indexOf(beat.to);
      case 'follow': {
        let followed = 0;
        for (const m of this.queries.moths.entities) followed = Math.max(followed, m.getValue(Moth, 'followedSeconds') ?? 0);
        return followed >= beat.seconds ? done : null;
      }
      case 'request':
        return this.awaitAlive(story, [beat.shape], t) !== null ? done : null;
      case 'choice': {
        const chosen = this.awaitAlive(story, beat.options.map((o) => o.shape), t);
        if (chosen === null) return null;
        const option = beat.options.find((o) => o.shape === chosen)!;
        story.setValue(StoryState, 'branch', option.goto);
        // Keep only the chosen shape requested, so a slipped hand re-forms it.
        this.setTargets(stage, option.shape, option.alt ?? ShapeIds.None, ShapeIds.None, ShapeIds.None);
        for (const o of beat.options) {
          const p = this.puppetFor(o.shape);
          if (o.shape !== chosen && p?.getValue(ShadowPuppet, 'state') === PuppetStates.Outline) {
            p.setValue(ShadowPuppet, 'state', PuppetStates.Hidden);
          }
        }
        return this.indexOf(option.goto);
      }
      case 'grow': {
        const alive = this.alivePuppet();
        const size = alive?.getValue(ShadowPuppet, 'size') ?? 0;
        if (this.growFrom <= 0) this.growFrom = size;
        const need = Math.max(beat.minSize ?? 0, this.growFrom * beat.factor);
        const big = alive !== undefined && size >= need;
        this.holdTime = big ? this.holdTime + delta : 0;
        return this.holdTime >= (beat.holdSeconds ?? GROW_HOLD_SECONDS) ? done : null;
      }
      case 'carry': {
        const obj = this.alivePuppet()?.object3D;
        if (!obj) return null;
        const c = stageRuntime.center;
        const dx = obj.position.x - c.x;
        const dy = obj.position.y - c.y;
        const dz = obj.position.z - c.z;
        const u = (dx * stageRuntime.right.x + dz * stageRuntime.right.z) / stageRuntime.width;
        const v = dy / stageRuntime.height;
        return u >= beat.toU && (beat.minV === undefined || v >= beat.minV) ? done : null;
      }
      case 'continue': {
        const open = openInLight(stage, 'left') || openInLight(stage, 'right');
        this.holdTime = open ? this.holdTime + delta : 0;
        return this.holdTime >= CONTINUE_HOLD_SECONDS ? done : null;
      }
      case 'reveal': {
        let revealed = 0;
        for (const p of this.queries.props.entities) revealed = Math.max(revealed, p.getValue(HiddenProp, 'revealed') ?? 0);
        this.holdTime = revealed >= 0.8 ? this.holdTime + delta : 0;
        return this.holdTime >= REVEAL_HOLD_SECONDS ? done : null;
      }
      case 'letgo': {
        const open = handOpened(stage, 'left') || handOpened(stage, 'right');
        this.holdTime = open ? this.holdTime + delta : 0;
        return this.holdTime >= LETGO_HOLD_SECONDS ? done : null;
      }
      case 'finale': {
        const f = Math.min(1, t / beat.seconds);
        const eased = f * f * (3 - 2 * f);
        stage.setValue(Stage, 'finale', eased);
        for (const m of this.queries.moths.entities) m.setValue(Moth, 'glow', eased);
        return f >= 1 ? done : null;
      }
      case 'end':
      case 'freestage':
        return null;
      default:
        return done;
    }
  }

  /** Waits for one of the shapes to come alive; shows the hint when stuck. */
  private awaitAlive(story: Entity, shapes: string[], t: number): string | null {
    const alive = shapes.find((s) => this.puppetFor(s)?.getValue(ShadowPuppet, 'state') === PuppetStates.Alive);
    const hintAfter = story.getValue(StoryState, 'hintAfterSeconds') ?? 15;
    story.setValue(StoryState, 'hintVisible', alive === undefined && hintAfter >= 0 && t >= hintAfter);
    if (alive === undefined || t <= 0.3) return null;
    this.lastAliveShape = alive;
    return alive;
  }

  private exit(beat: StoryBeat, story: Entity): void {
    if (beat.type === 'request' || beat.type === 'choice') story.setValue(StoryState, 'hintVisible', false);
  }

  private alivePuppet(): Entity | undefined {
    for (const p of this.queries.puppets.entities) {
      if (p.getValue(ShadowPuppet, 'state') === PuppetStates.Alive) return p;
    }
    return undefined;
  }

  private puppetFor(shape: string): Entity | undefined {
    for (const p of this.queries.puppets.entities) {
      if (p.getValue(ShadowPuppet, 'shape') === shape) return p;
    }
    return undefined;
  }
}

/** Write a StoryState string/enum field only when it changes. */
function setIfChanged(story: Entity, field: 'status' | 'caption', value: string): void {
  if (story.getValue(StoryState, field) !== value) story.setValue(StoryState, field, value as never);
}

/** An open hand held in the lamp light (to continue to the next chapter). */
function openInLight(stage: Entity, side: 'left' | 'right'): boolean {
  const shape = stage.getValue(ShapeRecognizer, side === 'left' ? 'leftShape' : 'rightShape');
  return shape === ShapeIds.Open && Boolean(stage.getValue(ShapeRecognizer, side === 'left' ? 'leftInLight' : 'rightInLight'));
}

/** Hands opened (one open hand, or both as the open-winged pair). */
function handOpened(stage: Entity, side: 'left' | 'right'): boolean {
  const shape = stage.getValue(ShapeRecognizer, side === 'left' ? 'leftShape' : 'rightShape');
  return shape === ShapeIds.Open || shape === ShapeIds.Bird;
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
