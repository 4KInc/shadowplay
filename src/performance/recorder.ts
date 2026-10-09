import { createSystem, Entity, Vector3 } from '@iwsdk/core';
import { saveRecording } from '../journal-store.js';
import {
  DeskLamp,
  HiddenProp,
  Moth,
  PerformanceRecorder,
  PuppetStates,
  ShadowPuppet,
  Scenery,
  ShapeRecognizer,
  Stage,
  StageActor,
  StoryState,
} from '../shadowplay-components.js';
import { handRuntime, stageRuntime } from '../stage-runtime.js';
import {
  encodeHands,
  FRAME_HZ,
  FRAME_STRIDE,
  Performance,
  PERFORMANCE_VERSION,
  PerformanceEvent,
  pointToStage,
  writeFrame,
} from './format.js';

/** Longest performance (seconds): a bedtime story, not a film. */
const MAX_SECONDS = 15 * 60;
/** Lamp moves smaller than this (m) are not recorded. */
const LAMP_EPSILON = 0.005;
/** Staging values (lamp level, finale, glow): record changes larger than this, at most 20 times a second. */
const STAGE_EPSILON = 0.02;
const STAGE_INTERVAL_MS = 50;

/**
 * Records a performance on this stage: both hands at 30 Hz in stage-relative
 * coordinates, story beats as they are entered, creatures waking and
 * releasing, lamp moves, and (optionally) the performer's voice. Saved to
 * IndexedDB on stop; the player replays it on any stage.
 */
export class PerformanceRecorderSystem extends createSystem({
  recorders: { required: [PerformanceRecorder] },
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
  private active = false;
  private elapsed = 0;
  private nextFrameAt = 0;
  private frames = new Int16Array(0);
  private frameCount = 0;
  private events: PerformanceEvent[] = [];
  private lastBeat = -1;
  private puppetStates = new Map<Entity, string>();
  private lastLamp = new Vector3();
  private lampPos = new Vector3();
  private media: MediaRecorder | null = null;
  private mic: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private lastStage = { lampLevel: -1, finale: -1, glow: -1, t: -1000 };

  init(): void {
    this.cleanupFuncs.push(() => this.releaseMic());
  }

  update(delta: number): void {
    const rec = first(this.queries.recorders.entities);
    const story = first(this.queries.stories.entities);
    if (!rec || !story) return;
    const want = Boolean(rec.getValue(PerformanceRecorder, 'recording'));
    if (want && !this.active) this.beginRecording(rec, story);
    if (!want && this.active) void this.finishRecording(rec, story);
    if (!this.active || !stageRuntime.ready) return;

    this.elapsed += delta;
    const t = Math.round(this.elapsed * 1000);
    if (this.elapsed >= this.nextFrameAt) {
      this.nextFrameAt += 1 / FRAME_HZ;
      this.captureFrame();
    }
    this.captureEvents(story, t);
    rec.setValue(PerformanceRecorder, 'seconds', +this.elapsed.toFixed(1));
    if (this.elapsed >= MAX_SECONDS) rec.setValue(PerformanceRecorder, 'recording', false);
  }

  private beginRecording(rec: Entity, story: Entity): void {
    this.active = true;
    this.elapsed = 0;
    this.nextFrameAt = 0;
    this.frameCount = 0;
    this.frames = new Int16Array(FRAME_HZ * 60 * FRAME_STRIDE);
    this.events = [];
    this.puppetStates.clear();
    this.startedAt = Date.now();
    // The stage as it is now (a recording may start mid-story), then the beat in progress.
    this.events.push({ t: 0, type: 'snapshot', data: this.snapshot() });
    this.lastStage = { lampLevel: -1, finale: -1, glow: -1, t: -1000 };
    this.lastBeat = -1;
    this.captureEvents(story, 0);
    const lamp = first(this.queries.lamps.entities)?.object3D;
    if (lamp) {
      this.lastLamp.copy(lamp.position);
      this.events.push({ t: 0, type: 'lamp', data: pointToStage(lamp.position) });
    }
    rec.setValue(PerformanceRecorder, 'status', 'Recording...');
    if (rec.getValue(PerformanceRecorder, 'withVoice')) void this.startMic(rec);
  }

  /** Story-driven stage state that the beats in the recording may not re-establish. */
  private snapshot(): Record<string, string | number | boolean> {
    const moth = first(this.queries.moths.entities);
    const scenery = first(this.queries.scenery.entities);
    const actor = first(this.queries.actors.entities);
    const stage = first(this.queries.stages.entities);
    const prop = first(this.queries.props.entities);
    return {
      scenery: scenery?.getValue(Scenery, 'set') ?? 'none',
      mothMode: moth?.getValue(Moth, 'mode') ?? 'hidden',
      mothRestU: moth?.getValue(Moth, 'restU') ?? 0,
      mothRestV: moth?.getValue(Moth, 'restV') ?? 0,
      mothGlow: moth?.getValue(Moth, 'glow') ?? 0,
      actorState: actor?.getValue(StageActor, 'state') ?? 'hidden',
      actorU: actor?.getValue(StageActor, 'u') ?? 0.3,
      actorV: actor?.getValue(StageActor, 'v') ?? -0.26,
      lampLevel: stage?.getValue(Stage, 'lampLevel') ?? 1,
      finale: stage?.getValue(Stage, 'finale') ?? 0,
      propActive: Boolean(prop?.getValue(HiddenProp, 'active')),
      propU: prop?.getValue(HiddenProp, 'u') ?? -0.34,
    };
  }

  private async startMic(rec: Entity): Promise<void> {
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!this.active) {
        this.releaseMic();
        return;
      }
      this.chunks = [];
      this.media = new MediaRecorder(this.mic);
      this.media.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.media.start(1000);
    } catch (error) {
      rec.setValue(PerformanceRecorder, 'status', `Recording without voice (${(error as Error).message})`);
    }
  }

  private releaseMic(): void {
    if (this.media && this.media.state !== 'inactive') this.media.stop();
    this.media = null;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
  }

  private captureFrame(): void {
    if ((this.frameCount + 1) * FRAME_STRIDE > this.frames.length) {
      const grown = new Int16Array(this.frames.length * 2);
      grown.set(this.frames);
      this.frames = grown;
    }
    const l = handRuntime.left.tracked ? handRuntime.left.joints : null;
    const r = handRuntime.right.tracked ? handRuntime.right.joints : null;
    writeFrame(this.frames, this.frameCount++, l, r);
  }

  private captureEvents(story: Entity, t: number): void {
    const beat = story.getValue(StoryState, 'beatIndex') ?? -1;
    if (beat !== this.lastBeat && beat >= 0) {
      this.lastBeat = beat;
      this.events.push({ t, type: 'beat', data: { index: beat, id: story.getValue(StoryState, 'beatId') ?? '' } });
    }
    const rec = first(this.queries.recognizers.entities);
    for (const p of this.queries.puppets.entities) {
      const state = p.getValue(ShadowPuppet, 'state') ?? '';
      const before = this.puppetStates.get(p);
      if (state === before) continue;
      this.puppetStates.set(p, state);
      const shape = p.getValue(ShadowPuppet, 'shape') ?? '';
      if (state === PuppetStates.Alive) {
        this.events.push({
          t,
          type: 'wake',
          data: {
            shape,
            hand: p.getValue(ShadowPuppet, 'hand') ?? 'right',
            twoHanded: Boolean(rec?.getValue(ShapeRecognizer, 'twoHanded')),
          },
        });
      } else if (before === PuppetStates.Alive) {
        this.events.push({ t, type: 'release', data: { shape } });
      }
    }
    this.captureStage(t);
    const lamp = first(this.queries.lamps.entities)?.object3D;
    if (lamp && lamp.position.distanceTo(this.lastLamp) > LAMP_EPSILON) {
      this.lastLamp.copy(lamp.position);
      this.events.push({ t, type: 'lamp', data: pointToStage(this.lampPos.copy(lamp.position)) });
    }
  }

  /** The lamp's flicker, the finale's swell and Mo's glow are animated by the story itself. */
  private captureStage(t: number): void {
    if (t - this.lastStage.t < STAGE_INTERVAL_MS) return;
    const stage = first(this.queries.stages.entities);
    const moth = first(this.queries.moths.entities);
    const lampLevel = stage?.getValue(Stage, 'lampLevel') ?? 1;
    const finale = stage?.getValue(Stage, 'finale') ?? 0;
    const glow = moth?.getValue(Moth, 'glow') ?? 0;
    const s = this.lastStage;
    if (
      Math.abs(lampLevel - s.lampLevel) < STAGE_EPSILON &&
      Math.abs(finale - s.finale) < STAGE_EPSILON &&
      Math.abs(glow - s.glow) < STAGE_EPSILON
    ) {
      return;
    }
    this.lastStage = { lampLevel, finale, glow, t };
    this.events.push({
      t,
      type: 'stage',
      data: { lampLevel: +lampLevel.toFixed(3), finale: +finale.toFixed(3), glow: +glow.toFixed(3) },
    });
  }

  private async finishRecording(rec: Entity, story: Entity): Promise<void> {
    this.active = false;
    const audio = await this.finishAudio();
    const performance: Performance = {
      version: PERFORMANCE_VERSION,
      id: `perf-${this.startedAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: rec.getValue(PerformanceRecorder, 'title') || 'A bedtime story',
      performer: rec.getValue(PerformanceRecorder, 'performer') ?? '',
      createdAt: this.startedAt,
      durationMs: Math.round(this.elapsed * 1000),
      script: story.getValue(StoryState, 'script') ?? '',
      frameHz: FRAME_HZ,
      hands: encodeHands(this.frames.subarray(0, this.frameCount * FRAME_STRIDE)),
      frameCount: this.frameCount,
      events: this.events,
      audio,
      audioType: audio?.type,
    };
    await saveRecording(performance);
    rec.setValue(PerformanceRecorder, 'lastId', performance.id);
    rec.setValue(
      PerformanceRecorder,
      'status',
      `Saved "${performance.title}" (${(performance.durationMs / 1000).toFixed(1)} s, ${this.events.length} events${audio ? ', with voice' : ''}).`,
    );
  }

  private finishAudio(): Promise<Blob | null> {
    const media = this.media;
    if (!media || media.state === 'inactive') {
      this.releaseMic();
      return Promise.resolve(this.chunks.length ? new Blob(this.chunks) : null);
    }
    return new Promise((resolve) => {
      media.onstop = () => {
        const blob = this.chunks.length ? new Blob(this.chunks, { type: media.mimeType }) : null;
        this.mic?.getTracks().forEach((t) => t.stop());
        this.mic = null;
        this.media = null;
        resolve(blob);
      };
      media.stop();
    });
  }
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
