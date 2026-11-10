import { createSystem, Entity, Vector3 } from '@iwsdk/core';
import {
  DeskLamp,
  HiddenProp,
  Moth,
  PuppetStates,
  Scenery,
  ShadowPuppet,
  ShapeRecognizer,
  Stage,
  StageActor,
  StoryState,
} from '../shadowplay-components.js';
import { stageRuntime } from '../stage-runtime.js';
import { PerformanceEvent, pointToStage } from './format.js';

/** Lamp moves smaller than this (m) are ignored. */
const LAMP_EPSILON = 0.005;
/** Staging values (lamp level, finale, glow): changes larger than this, at most 20 times a second. */
const STAGE_EPSILON = 0.02;
const STAGE_INTERVAL_MS = 50;

/** An event without its time; listeners stamp it on their own clock. */
export type TapEvent = Omit<PerformanceEvent, 't'>;
type Listener = (e: TapEvent) => void;

const listeners = new Set<Listener>();
let tapSystem: StoryTapSystem | null = null;

/**
 * The story tap: watches the live story and publishes what a remote or later
 * viewer needs to see the same show (beats entered, creatures waking and
 * releasing, lamp moves, animated staging). The recorder and Live hosting
 * both listen to it.
 */
export const storyTap = {
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Everything needed to start a viewer mid-story: staging snapshot, current beat, lamp. */
  current(): TapEvent[] {
    return tapSystem ? tapSystem.currentState() : [];
  },
};

function emit(e: TapEvent): void {
  for (const fn of listeners) fn(e);
}

export class StoryTapSystem extends createSystem({
  stories: { required: [StoryState] },
  recognizers: { required: [ShapeRecognizer] },
  puppets: { required: [ShadowPuppet] },
  lamps: { required: [DeskLamp] },
  moths: { required: [Moth] },
  scenery: { required: [Scenery] },
  actors: { required: [StageActor] },
  stages: { required: [Stage] },
  props: { required: [HiddenProp] },
}) {
  private lastBeat = -1;
  private puppetStates = new Map<Entity, string>();
  private lastLamp = new Vector3(Infinity, 0, 0);
  private lastStage = { lampLevel: -1, finale: -1, glow: -1, at: -1000 };

  init(): void {
    tapSystem = this;
    this.cleanupFuncs.push(() => {
      if (tapSystem === this) tapSystem = null;
    });
  }

  update(): void {
    if (!stageRuntime.ready) return;
    const story = first(this.queries.stories.entities);
    if (!story) return;
    const beat = story.getValue(StoryState, 'beatIndex') ?? -1;
    if (beat !== this.lastBeat && beat >= 0) {
      this.lastBeat = beat;
      emit({ type: 'beat', data: { index: beat, id: story.getValue(StoryState, 'beatId') ?? '' } });
    }
    const rec = first(this.queries.recognizers.entities);
    for (const p of this.queries.puppets.entities) {
      const state = p.getValue(ShadowPuppet, 'state') ?? '';
      const before = this.puppetStates.get(p);
      if (state === before) continue;
      this.puppetStates.set(p, state);
      const shape = p.getValue(ShadowPuppet, 'shape') ?? '';
      if (state === PuppetStates.Alive) {
        emit({
          type: 'wake',
          data: {
            shape,
            hand: p.getValue(ShadowPuppet, 'hand') ?? 'right',
            twoHanded: Boolean(rec?.getValue(ShapeRecognizer, 'twoHanded')),
          },
        });
      } else if (before === PuppetStates.Alive) {
        emit({ type: 'release', data: { shape } });
      }
    }
    const lamp = first(this.queries.lamps.entities)?.object3D;
    if (lamp && lamp.position.distanceTo(this.lastLamp) > LAMP_EPSILON) {
      this.lastLamp.copy(lamp.position);
      emit({ type: 'lamp', data: pointToStage(lamp.position) });
    }
    this.tapStage();
  }

  private tapStage(): void {
    const now = performance.now();
    if (now - this.lastStage.at < STAGE_INTERVAL_MS) return;
    const s = this.stagingValues();
    const l = this.lastStage;
    if (
      Math.abs(s.lampLevel - l.lampLevel) < STAGE_EPSILON &&
      Math.abs(s.finale - l.finale) < STAGE_EPSILON &&
      Math.abs(s.glow - l.glow) < STAGE_EPSILON
    ) {
      return;
    }
    this.lastStage = { ...s, at: now };
    emit({ type: 'stage', data: { lampLevel: +s.lampLevel.toFixed(3), finale: +s.finale.toFixed(3), glow: +s.glow.toFixed(3) } });
  }

  private stagingValues(): { lampLevel: number; finale: number; glow: number } {
    const stage = first(this.queries.stages.entities);
    const moth = first(this.queries.moths.entities);
    return {
      lampLevel: stage?.getValue(Stage, 'lampLevel') ?? 1,
      finale: stage?.getValue(Stage, 'finale') ?? 0,
      glow: moth?.getValue(Moth, 'glow') ?? 0,
    };
  }

  currentState(): TapEvent[] {
    const out: TapEvent[] = [{ type: 'snapshot', data: this.snapshot() }];
    const story = first(this.queries.stories.entities);
    const beat = story?.getValue(StoryState, 'beatIndex') ?? -1;
    if (beat >= 0) out.push({ type: 'beat', data: { index: beat, id: story?.getValue(StoryState, 'beatId') ?? '' } });
    const lamp = first(this.queries.lamps.entities)?.object3D;
    if (lamp) out.push({ type: 'lamp', data: pointToStage(lamp.position) });
    const s = this.stagingValues();
    out.push({ type: 'stage', data: { lampLevel: s.lampLevel, finale: s.finale, glow: s.glow } });
    for (const p of this.queries.puppets.entities) {
      if (p.getValue(ShadowPuppet, 'state') !== PuppetStates.Alive) continue;
      out.push({
        type: 'wake',
        data: { shape: p.getValue(ShadowPuppet, 'shape') ?? '', hand: p.getValue(ShadowPuppet, 'hand') ?? 'right', twoHanded: false },
      });
    }
    return out;
  }

  /** Story-driven stage state that later beats may not re-establish. */
  private snapshot(): Record<string, string | number | boolean> {
    const moth = first(this.queries.moths.entities);
    const scenery = first(this.queries.scenery.entities);
    const actor = first(this.queries.actors.entities);
    const prop = first(this.queries.props.entities);
    const s = this.stagingValues();
    return {
      scenery: scenery?.getValue(Scenery, 'set') ?? 'none',
      mothMode: moth?.getValue(Moth, 'mode') ?? 'hidden',
      mothRestU: moth?.getValue(Moth, 'restU') ?? 0,
      mothRestV: moth?.getValue(Moth, 'restV') ?? 0,
      mothGlow: s.glow,
      actorState: actor?.getValue(StageActor, 'state') ?? 'hidden',
      actorU: actor?.getValue(StageActor, 'u') ?? 0.3,
      actorV: actor?.getValue(StageActor, 'v') ?? -0.26,
      lampLevel: s.lampLevel,
      finale: s.finale,
      propActive: Boolean(prop?.getValue(HiddenProp, 'active')),
      propU: prop?.getValue(HiddenProp, 'u') ?? -0.34,
    };
  }
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
