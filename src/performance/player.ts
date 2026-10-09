import { createSystem, Entity, Vector3 } from '@iwsdk/core';
import { loadRecording } from '../journal-store.js';
import {
  DeskLamp,
  HiddenProp,
  Moth,
  PerformancePlayer,
  PuppetStates,
  Scenery,
  ShadowPuppet,
  ShapeRecognizer,
  Stage,
  StageActor,
  StoryState,
} from '../shadowplay-components.js';
import { handOverride, JOINT_COUNT, stageRuntime } from '../stage-runtime.js';
import { decodeHands, Performance, PerformanceEvent, pointFromStage, readFrame } from './format.js';

/** Re-sync the voice when it drifts this far (s) from the performance clock. */
const AUDIO_DRIFT = 0.25;

/**
 * Replays a recorded performance on this stage, in or out of XR: the hands
 * move again through the hand override (so shadows, recognition and creatures
 * behave as they did), the story re-enters each recorded beat at its time,
 * creatures wake and release on cue, the lamp moves, and the performer's
 * voice plays in sync. Pause and resume keep everything together.
 */
export class PerformancePlayerSystem extends createSystem({
  players: { required: [PerformancePlayer] },
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
  private perf: Performance | null = null;
  private frames: Int16Array | null = null;
  private loading = false;
  private clock = 0;
  private next = 0;
  private events: PerformanceEvent[] = [];
  private audio: HTMLAudioElement | null = null;
  private audioUrl = '';
  private left = new Float32Array(JOINT_COUNT * 3);
  private right = new Float32Array(JOINT_COUNT * 3);
  private lampPos = new Vector3();
  private wasPaused = false;

  init(): void {
    this.cleanupFuncs.push(() => this.teardown());
  }

  update(delta: number): void {
    const player = first(this.queries.players.entities);
    if (!player) return;
    const playing = Boolean(player.getValue(PerformancePlayer, 'playing'));
    if (playing && !this.perf && !this.loading) void this.load(player);
    if (!playing && this.perf) this.finish(player, 'Stopped.');
    if (!this.perf || !this.frames || !stageRuntime.ready) return;

    const paused = Boolean(player.getValue(PerformancePlayer, 'paused'));
    if (paused !== this.wasPaused) {
      this.wasPaused = paused;
      if (paused) this.audio?.pause();
      else void this.audio?.play().catch(() => undefined);
    }
    if (paused) return;

    this.clock += delta;
    const tMs = this.clock * 1000;
    while (this.next < this.events.length && this.events[this.next].t <= tMs) this.apply(this.events[this.next++]);

    const hands = readFrame(this.frames, this.perf.frameCount, this.clock * this.perf.frameHz, this.left, this.right);
    handOverride.active = true;
    handOverride.source = 'playback';
    handOverride.left = hands.left ? this.left : null;
    handOverride.right = hands.right ? this.right : null;

    if (this.audio && !this.audio.paused && Math.abs(this.audio.currentTime - this.clock) > AUDIO_DRIFT) {
      this.audio.currentTime = this.clock;
    }
    player.setValue(PerformancePlayer, 'position', +this.clock.toFixed(1));
    if (tMs >= this.perf.durationMs) this.finish(player, 'Finished.');
  }

  private async load(player: Entity): Promise<void> {
    this.loading = true;
    const id = player.getValue(PerformancePlayer, 'recordingId') ?? '';
    const perf = await loadRecording<Performance>(id);
    this.loading = false;
    if (!perf) {
      player.setValue(PerformancePlayer, 'playing', false);
      player.setValue(PerformancePlayer, 'status', `No recording "${id}".`);
      return;
    }
    this.perf = perf;
    this.frames = decodeHands(perf.hands);
    this.events = [...perf.events].sort((a, b) => a.t - b.t);
    this.next = 0;
    this.clock = 0;
    this.wasPaused = false;
    player.setValue(PerformancePlayer, 'duration', +(perf.durationMs / 1000).toFixed(1));
    player.setValue(PerformancePlayer, 'status', `Playing "${perf.title}"${perf.performer ? ` from ${perf.performer}` : ''}.`);
    const story = first(this.queries.stories.entities);
    story?.setValue(StoryState, 'followMode', true);
    if (perf.audio) {
      this.audioUrl = URL.createObjectURL(perf.audio);
      this.audio = new Audio(this.audioUrl);
      void this.audio.play().catch(() => undefined);
    }
  }

  private apply(e: PerformanceEvent): void {
    const story = first(this.queries.stories.entities);
    const rec = first(this.queries.recognizers.entities);
    switch (e.type) {
      case 'snapshot':
        this.applySnapshot(e.data);
        break;
      case 'beat':
        story?.setValue(StoryState, 'enterBeat', Number(e.data.index));
        break;
      case 'wake': {
        // Make the creature wake on cue even if recognition would differ here.
        const puppet = this.puppetFor(String(e.data.shape));
        if (rec && puppet && puppet.getValue(ShadowPuppet, 'state') !== PuppetStates.Alive) {
          if (puppet.getValue(ShadowPuppet, 'state') === PuppetStates.Hidden) {
            puppet.setValue(ShadowPuppet, 'state', PuppetStates.Outline);
          }
          rec.setValue(ShapeRecognizer, 'matchedHand', String(e.data.hand) as never);
          rec.setValue(ShapeRecognizer, 'matchedShape', String(e.data.shape) as never);
          rec.setValue(ShapeRecognizer, 'twoHanded', Boolean(e.data.twoHanded));
        }
        break;
      }
      case 'release': {
        const puppet = this.puppetFor(String(e.data.shape));
        if (puppet?.getValue(ShadowPuppet, 'state') === PuppetStates.Alive) {
          puppet.setValue(ShadowPuppet, 'state', PuppetStates.Releasing);
        }
        break;
      }
      case 'lamp': {
        const lamp = first(this.queries.lamps.entities)?.object3D;
        if (lamp) lamp.position.copy(pointFromStage(Number(e.data.x), Number(e.data.y), Number(e.data.z), this.lampPos));
        break;
      }
    }
  }

  private applySnapshot(d: PerformanceEvent['data']): void {
    // Clear the viewer's own creatures and requests: the replay starts on a clean stage.
    for (const p of this.queries.puppets.entities) p.setValue(ShadowPuppet, 'state', PuppetStates.Hidden);
    for (const r of this.queries.recognizers.entities) {
      r.setValue(ShapeRecognizer, 'target', 'none');
      r.setValue(ShapeRecognizer, 'target2', 'none');
      r.setValue(ShapeRecognizer, 'matchedHand', 'none');
      r.setValue(ShapeRecognizer, 'matchedShape', 'none');
      r.setValue(ShapeRecognizer, 'heldFor', 0);
    }
    for (const s of this.queries.scenery.entities) s.setValue(Scenery, 'set', String(d.scenery) as never);
    for (const m of this.queries.moths.entities) {
      m.setValue(Moth, 'restU', Number(d.mothRestU));
      m.setValue(Moth, 'restV', Number(d.mothRestV));
      m.setValue(Moth, 'glow', Number(d.mothGlow));
      m.setValue(Moth, 'mode', String(d.mothMode) as never);
    }
    for (const a of this.queries.actors.entities) {
      a.setValue(StageActor, 'u', Number(d.actorU));
      a.setValue(StageActor, 'v', Number(d.actorV));
      a.setValue(StageActor, 'state', String(d.actorState) as never);
    }
    for (const s of this.queries.stages.entities) {
      s.setValue(Stage, 'lampLevel', Number(d.lampLevel));
      s.setValue(Stage, 'finale', Number(d.finale));
    }
    for (const p of this.queries.props.entities) {
      p.setValue(HiddenProp, 'u', Number(d.propU));
      p.setValue(HiddenProp, 'active', Boolean(d.propActive));
    }
  }

  private puppetFor(shape: string): Entity | undefined {
    for (const p of this.queries.puppets.entities) {
      if (p.getValue(ShadowPuppet, 'shape') === shape) return p;
    }
    return undefined;
  }

  private finish(player: Entity, status: string): void {
    this.teardown();
    player.setValue(PerformancePlayer, 'playing', false);
    player.setValue(PerformancePlayer, 'status', status);
    first(this.queries.stories.entities)?.setValue(StoryState, 'followMode', false);
  }

  private teardown(): void {
    this.audio?.pause();
    this.audio = null;
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = '';
    this.perf = null;
    this.frames = null;
    if (handOverride.source === 'playback') {
      handOverride.active = false;
      handOverride.left = handOverride.right = null;
    }
  }
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
