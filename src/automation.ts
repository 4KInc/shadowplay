import { Box3, createSystem, Entity, Object3D, Vector3 } from '@iwsdk/core';
import {
  DemoDirector,
  DeskLamp,
  FamilyInbox,
  LiveSession,
  PerformancePlayer,
  PerformanceRecorder,
  RecognitionLab,
  Settings,
  ShadowJournal,
  ShapeRecognizer,
  Stage,
  StoryState,
  WebcamHands,
} from './shadowplay-components.js';
import { loadRecording } from './journal-store.js';
import { voiceStats } from './live/voice.js';
import type { Performance } from './performance/format.js';
import { toWire } from './performance/sharing.js';
import { handOverride, handRuntime, secondHands, stageRuntime, trackingRuntime, uiPresses } from './stage-runtime.js';
import type { RoomPlane } from './wall-choice.js';

const COMPONENTS = {
  DemoDirector,
  DeskLamp,
  FamilyInbox,
  LiveSession,
  PerformancePlayer,
  PerformanceRecorder,
  RecognitionLab,
  Settings,
  ShadowJournal,
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
  DeskLamp: { required: [DeskLamp] },
  FamilyInbox: { required: [FamilyInbox] },
  LiveSession: { required: [LiveSession] },
  PerformancePlayer: { required: [PerformancePlayer] },
  PerformanceRecorder: { required: [PerformanceRecorder] },
  RecognitionLab: { required: [RecognitionLab] },
  Settings: { required: [Settings] },
  ShadowJournal: { required: [ShadowJournal] },
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
      /** World position of a named object (UI elements are named by their id), or null. */
      where: (name: string) => {
        const o = this.world.scene.getObjectByName(name);
        return o ? o.getWorldPosition(new Vector3()).toArray() : null;
      },
      /** Room tests: stage placement sees these planes instead of the headset's (null restores them). */
      room: (planes: RoomPlane[] | null) => {
        stageRuntime.testPlanes = planes;
      },
      /**
       * Where the stage is and how far its essential UI sits from straight ahead:
       * degrees left/right of the horizontal view direction and up/down from eye level.
       */
      view: () => {
        const head = new Vector3();
        const fwd = new Vector3();
        const cam = this.player.head;
        cam.updateWorldMatrix(true, false);
        head.setFromMatrixPosition(cam.matrixWorld);
        cam.getWorldDirection(fwd).negate();
        fwd.y = 0;
        fwd.normalize();
        const angles = (points: Vector3[]) => {
          const out = { left: -Infinity, right: -Infinity, up: -Infinity, down: -Infinity };
          for (const p of points) {
            const d = p.clone().sub(head);
            const ahead = d.x * fwd.x + d.z * fwd.z;
            const side = d.x * -fwd.z + d.z * fwd.x;
            const yaw = (Math.atan2(side, ahead) * 180) / Math.PI;
            const pitch = (Math.atan2(d.y, Math.hypot(ahead, side)) * 180) / Math.PI;
            out.right = Math.max(out.right, yaw);
            out.left = Math.max(out.left, -yaw);
            out.up = Math.max(out.up, pitch);
            out.down = Math.max(out.down, -pitch);
          }
          for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] = Math.round(out[k] * 10) / 10;
          return out;
        };
        const boxOf = (o: Object3D | undefined | null) => {
          if (!o) return null;
          let shown = o.visible;
          o.traverseAncestors((a) => (shown &&= a.visible));
          if (!shown) return null;
          const b = new Box3().setFromObject(o);
          if (b.isEmpty()) return null;
          const pts: Vector3[] = [];
          for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(new Vector3(x, y, z));
          return angles(pts);
        };
        const r = stageRuntime;
        const corners = [-1, 1].flatMap((sx) =>
          [-1, 1].map((sy) => r.center.clone().addScaledVector(r.right, (sx * r.width) / 2).addScaledVector(r.up, (sy * r.height) / 2)),
        );
        const scene = this.world.scene;
        const stage = entity('Stage');
        return {
          head: head.toArray().map((v) => Math.round(v * 100) / 100),
          mode: stage?.getValue(Stage, 'mode'),
          ready: r.ready,
          distance: stage?.getValue(Stage, 'distance'),
          width: Math.round(r.width * 100) / 100,
          stage: r.ready ? angles(corners) : null,
          caption: boxOf(scene.getObjectByName('story-caption')),
          journalPage: boxOf(scene.getObjectByName('journal-overlay')),
          settings: boxOf(entity('Settings')?.object3D),
          flare: Math.round(r.wakeFlare * 100) / 100,
          lightHint: trackingRuntime.lightHint,
          desk: stageRuntime.desk,
          lampY: Math.round((entity('DeskLamp')?.object3D?.position.y ?? 0) * 1000) / 1000,
        };
      },
      /** What the GPU draws: shadow casters, transparent layers, shadow map setup (performance audit). */
      audit: () => {
        const casters: string[] = [];
        const transparent: string[] = [];
        let meshes = 0;
        this.world.scene.traverseVisible((o) => {
          const m = o as import('@iwsdk/core').Mesh & { count?: number; isMesh?: boolean };
          if (!m.isMesh) return;
          meshes++;
          const instances = (m as { isInstancedMesh?: boolean }).isInstancedMesh ? ` x${m.count}` : '';
          if (m.castShadow) casters.push(`${m.name || m.type}${instances}`);
          const mat = Array.isArray(m.material) ? m.material[0] : m.material;
          if (mat?.transparent) transparent.push(`${m.name || m.type}${mat.depthTest === false ? ' (no depth test)' : ''}`);
        });
        const renderer = this.world.renderer;
        let mapSize = 0;
        this.world.scene.traverse((o) => {
          const l = o as { isSpotLight?: boolean; castShadow?: boolean; shadow?: { mapSize: { x: number } } };
          if (l.isSpotLight && l.castShadow && l.shadow) mapSize = l.shadow.mapSize.x;
        });
        return { meshes, casters, transparent, shadowType: renderer.shadowMap.type, shadowMap: mapSize, pixelRatio: renderer.getPixelRatio() };
      },
      /** A saved recording in its shareable (wire) form, for building bundled samples. */
      exportRecording: async (id: string) => {
        const perf = await loadRecording<Performance>(id);
        return perf ? toWire(perf) : null;
      },
      /** Peak renderer counts since the last call (then reset), and app ms per frame. */
      perf: () => {
        const peak = { ...this.peak };
        Object.keys(this.peak).forEach((k) => ((this.peak as Record<string, number>)[k] = 0));
        const c = [...this.costs].sort((a, b) => a - b);
        return { peak, appMs: c.length ? { median: c[c.length >> 1], p95: c[Math.floor(c.length * 0.95)], max: c[c.length - 1] } : null };
      },
      beats: () => [...this.beatLog],
      voice: () => ({ ...voiceStats, sentEdges: [...voiceStats.sentEdges], heardEdges: [...voiceStats.heardEdges] }),
      /** A hand's pointing ray (target-ray space) in world space: origin and unit direction. */
      ray: (side: 'left' | 'right') => {
        const space = this.player.raySpaces[side];
        space.updateWorldMatrix(true, false);
        const origin = new Vector3().setFromMatrixPosition(space.matrixWorld);
        const dir = new Vector3(0, 0, -1).transformDirection(space.matrixWorld);
        return { origin: origin.toArray(), dir: dir.toArray() };
      },
      /** Headset panel buttons pressed so far (ids). */
      presses: () => [...uiPresses],
      /** World midpoint of thumb tip and index tip (where a direct pinch acts), or null when untracked. */
      pinchPoint: (side: 'left' | 'right') => {
        const h = handRuntime[side];
        if (!h.tracked) return null;
        const j = h.joints;
        return [0, 1, 2].map((k) => (j[4 * 3 + k] + j[9 * 3 + k]) / 2);
      },
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
