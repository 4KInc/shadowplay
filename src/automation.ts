import { createSystem, Entity } from '@iwsdk/core';
import {
  DemoDirector,
  FamilyInbox,
  LiveSession,
  PerformancePlayer,
  PerformanceRecorder,
  Settings,
  ShapeRecognizer,
  Stage,
  StoryState,
  WebcamHands,
} from './shadowplay-components.js';
import { voiceStats } from './live/voice.js';
import { handOverride, handRuntime, secondHands } from './stage-runtime.js';

const COMPONENTS = {
  DemoDirector,
  FamilyInbox,
  LiveSession,
  PerformancePlayer,
  PerformanceRecorder,
  Settings,
  ShapeRecognizer,
  Stage,
  StoryState,
  WebcamHands,
} as const;
type Name = keyof typeof COMPONENTS;

/** On in development, or with ?test: lets simulation scripts read and drive the stage. */
export const automationEnabled =
  import.meta.env.DEV || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('test'));

/**
 * window.__sp for simulation scripts (two-browser Live tests, bot
 * playtesters): read and write component fields by name, and peek at hand
 * state. Same powers as the browser console; never enabled for normal users.
 */
export class AutomationSystem extends createSystem({
  DemoDirector: { required: [DemoDirector] },
  FamilyInbox: { required: [FamilyInbox] },
  LiveSession: { required: [LiveSession] },
  PerformancePlayer: { required: [PerformancePlayer] },
  PerformanceRecorder: { required: [PerformanceRecorder] },
  Settings: { required: [Settings] },
  ShapeRecognizer: { required: [ShapeRecognizer] },
  Stage: { required: [Stage] },
  StoryState: { required: [StoryState] },
  WebcamHands: { required: [WebcamHands] },
}) {
  private frames = 0;
  private lastBeat = '';
  /** Every beat this stage entered, with time (ms since epoch): exact sync checks across pages. */
  private beatLog: { id: string; t: number }[] = [];

  update(): void {
    this.frames++;
    const beat = this.queries.StoryState.entities.values().next().value?.getValue(StoryState, 'beatId') ?? '';
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      if (beat) this.beatLog.push({ id: beat, t: Date.now() });
      if (this.beatLog.length > 2000) this.beatLog.shift();
    }
  }

  init(): void {
    const entity = (name: Name): Entity | undefined => this.queries[name].entities.values().next().value;
    const api = {
      get: (name: Name, field: string) => entity(name)?.getValue(COMPONENTS[name] as never, field as never),
      set: (name: Name, field: string, value: unknown) =>
        entity(name)?.setValue(COMPONENTS[name] as never, field as never, value as never),
      /** All fields of a component, for logging. */
      dump: (name: Name) => {
        const e = entity(name);
        if (!e) return null;
        const out: Record<string, unknown> = {};
        for (const field of Object.keys((COMPONENTS[name] as unknown as { schema: object }).schema ?? {})) {
          out[field] = e.getValue(COMPONENTS[name] as never, field as never);
        }
        return out;
      },
      frames: () => this.frames,
      beats: () => [...this.beatLog],
      voice: () => ({ ...voiceStats, sentEdges: [...voiceStats.sentEdges], heardEdges: [...voiceStats.heardEdges] }),
      hands: () => ({
        left: handRuntime.left.tracked,
        right: handRuntime.right.tracked,
        override: handOverride.active ? handOverride.source : '',
        second: [secondHands.left !== null, secondHands.right !== null],
      }),
    };
    (window as unknown as { __sp: typeof api }).__sp = api;
    this.cleanupFuncs.push(() => delete (window as unknown as { __sp?: unknown }).__sp);
  }
}
