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
  /** Milliseconds of app work (all systems) per frame, last 600 frames. */
  private costs: number[] = [];
  /** Worst draw calls / triangles seen (the renderer resets its counters every frame). */
  private peak = { calls: 0, triangles: 0, programs: 0, textures: 0, geometries: 0 };
  private lastBeat = '';
  /** Every beat this stage entered, with time (ms since epoch): exact sync checks across pages. */
  private beatLog: { id: string; t: number }[] = [];

  update(): void {
    this.frames++;
    const info = this.world.renderer.info;
    const p = this.peak;
    p.calls = Math.max(p.calls, info.render.calls);
    p.triangles = Math.max(p.triangles, info.render.triangles);
    p.programs = Math.max(p.programs, info.programs?.length ?? 0);
    p.textures = Math.max(p.textures, info.memory.textures);
    p.geometries = Math.max(p.geometries, info.memory.geometries);
    const beat = this.queries.StoryState.entities.values().next().value?.getValue(StoryState, 'beatId') ?? '';
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      if (beat) this.beatLog.push({ id: beat, t: Date.now() });
      if (this.beatLog.length > 2000) this.beatLog.shift();
    }
  }

  init(): void {
    // Time the whole ECS update each frame (every system), for CPU budget checks.
    const world = this.world as unknown as { update: (...a: unknown[]) => unknown };
    const original = world.update.bind(world);
    world.update = (...a: unknown[]) => {
      const start = performance.now();
      const out = original(...a);
      this.costs.push(performance.now() - start);
      if (this.costs.length > 600) this.costs.shift();
      return out;
    };
    this.cleanupFuncs.push(() => (world.update = original));
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
      /** Peak renderer counts since the last call (then reset), and app ms per frame. */
      perf: () => {
        const peak = { ...this.peak };
        Object.keys(this.peak).forEach((k) => ((this.peak as Record<string, number>)[k] = 0));
        const c = [...this.costs].sort((a, b) => a - b);
        return { peak, appMs: c.length ? { median: c[c.length >> 1], p95: c[Math.floor(c.length * 0.95)], max: c[c.length - 1] } : null };
      },
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
