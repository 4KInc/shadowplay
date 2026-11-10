import { createSystem, Entity } from '@iwsdk/core';
import { family } from '../family.js';
import { loadRecording } from '../journal-store.js';
import { isStoryScript, loadStoryScript, StoryBeat, storyRuntime } from '../story-script.js';
import {
  DeskLamp,
  HiddenProp,
  Moth,
  PerformancePlayer,
  Scenery,
  ShadowPuppet,
  ShapeRecognizer,
  Stage,
  StageActor,
  StoryState,
} from '../shadowplay-components.js';
import { handOverride, JOINT_COUNT, stageRuntime } from '../stage-runtime.js';
import { applyEvent, ApplyTargets, applyTargets } from './apply.js';
import { decodeHands, FRAME_STRIDE, Performance, PerformanceEvent, readFrame } from './format.js';

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
  private targets!: ApplyTargets;
  private wasPaused = false;
  private beats: StoryBeat[] = [];
  /** Live join-in segment: the story beat index at which the recording takes over again. */
  private rejoinAt = -1;

  init(): void {
    this.targets = applyTargets(this.queries);
    this.cleanupFuncs.push(() => this.teardown());
  }

  update(delta: number): void {
    const player = first(this.queries.players.entities);
    if (!player) return;
    const playing = Boolean(player.getValue(PerformancePlayer, 'playing'));
    if (playing && !this.perf && !this.loading) void this.load(player);
    if (!playing && this.perf) this.finish(player, 'Stopped.');
    if (!this.perf || !this.frames || !stageRuntime.ready) return;

    if (this.rejoinAt >= 0) {
      this.updateJoinIn(player);
      return;
    }

    const paused = Boolean(player.getValue(PerformancePlayer, 'paused'));
    if (paused !== this.wasPaused) {
      this.wasPaused = paused;
      if (paused) this.audio?.pause();
      else void this.audio?.play().catch(() => undefined);
    }
    if (paused) return;
    // Wait while the story loads the recording's script.
    if (this.perf.script && !this.perf.replyTo && storyRuntime.script !== this.perf.script) return;

    this.clock += delta;
    const tMs = this.clock * 1000;
    // At most one beat per frame: the story reads one enterBeat per update, and
    // instant beats (scenery, Mo landing) often share a timestamp.
    while (this.next < this.events.length && this.events[this.next].t <= tMs) {
      const e = this.events[this.next++];
      this.apply(e);
      if (e.type === 'beat') break;
    }

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
    let perf: Performance | null = null;
    let frames: Int16Array;
    let beats: StoryBeat[] = [];
    try {
      perf = await loadRecording<Performance>(id);
      if (!perf) throw new Error(`No recording "${id}".`);
      // A story this version does not know plays without changing the stage's story.
      if (perf.script && !isStoryScript(perf.script)) perf = { ...perf, script: '' };
      frames = decodeHands(perf.hands);
      if (frames.length < perf.frameCount * FRAME_STRIDE) throw new Error('This recording is damaged.');
      beats = perf.script ? (await loadStoryScript(perf.script).catch(() => null))?.beats ?? [] : [];
    } catch (error) {
      player.setValue(PerformancePlayer, 'playing', false);
      player.setValue(PerformancePlayer, 'status', (error as Error).message);
      return;
    } finally {
      this.loading = false;
    }
    // Stopped, or asked for another recording, while this one was loading.
    if (!player.getValue(PerformancePlayer, 'playing') || player.getValue(PerformancePlayer, 'recordingId') !== id) return;
    this.perf = perf;
    this.frames = frames;
    this.events = [...perf.events].sort((a, b) => a.t - b.t);
    this.beats = beats;
    this.rejoinAt = -1;
    // The recorded hands drive the stage; the camera only takes over for join-in moments.
    handOverride.cameraAllowed = false;
    this.next = 0;
    this.clock = 0;
    this.wasPaused = false;
    player.setValue(PerformancePlayer, 'duration', +(perf.durationMs / 1000).toFixed(1));
    family.borrow({ child: perf.child ?? '', performer: perf.performer });
    player.setValue(PerformancePlayer, 'status', `Playing "${perf.title}"${perf.performer ? ` from ${perf.performer}` : ''}.`);
    const story = first(this.queries.stories.entities);
    story?.setValue(StoryState, 'followMode', true);
    // Tell the story in the recording's script (it may be another story from the library).
    // A goodnight is not a story: it plays on whatever stage is here, every creature free to wake.
    if (perf.script && !perf.replyTo) story?.setValue(StoryState, 'script', perf.script);
    if (perf.replyTo) for (const r of this.queries.recognizers.entities) r.setValue(ShapeRecognizer, 'freeMode', true);
    if (perf.audio) {
      this.audioUrl = URL.createObjectURL(perf.audio);
      this.audio = new Audio(this.audioUrl);
      void this.audio.play().catch(() => undefined);
    }
  }

  private apply(e: PerformanceEvent): void {
    if (e.type !== 'beat') {
      applyEvent(e, this.targets);
      return;
    }
    if (this.perf?.replyTo) return;
    const index = Number(e.data.index);
    first(this.queries.stories.entities)?.setValue(StoryState, 'enterBeat', index);
    const type = this.beats[index]?.type;
    const player = first(this.queries.players.entities);
    if (player?.getValue(PerformancePlayer, 'joinIn') && (type === 'request' || type === 'choice')) {
      this.startJoinIn(player, index);
    }
  }

  /**
   * Join-in moment: the recording reaches a shape request. Pause the recorded
   * hands and voice and let the story run live with the viewer's own hands
   * (camera) until it reaches the next release beat, where the recording's
   * creature bowed out; then the recording carries on from there.
   */
  private startJoinIn(player: Entity, requestIndex: number): void {
    let rejoin = -1;
    for (let i = requestIndex + 1; i < this.beats.length; i++) {
      if (this.beats[i].type === 'release') {
        rejoin = i;
        break;
      }
    }
    if (rejoin < 0) return;
    this.rejoinAt = rejoin;
    this.audio?.pause();
    handOverride.cameraAllowed = true;
    if (handOverride.source === 'playback') handOverride.left = handOverride.right = null;
    first(this.queries.stories.entities)?.setValue(StoryState, 'joinIn', true);
    player.setValue(PerformancePlayer, 'inJoinIn', true);
    player.setValue(PerformancePlayer, 'status', 'Your turn! Make the shape with your hands.');
  }

  private updateJoinIn(player: Entity): void {
    const story = first(this.queries.stories.entities);
    const index = story?.getValue(StoryState, 'beatIndex') ?? -1;
    if (index < this.rejoinAt) return;
    // The viewer's scene is done: pick the recording up at the matching beat.
    const at = this.events.findIndex((e) => e.type === 'beat' && Number(e.data.index) >= this.rejoinAt);
    this.rejoinAt = -1;
    story?.setValue(StoryState, 'joinIn', false);
    handOverride.cameraAllowed = false;
    player.setValue(PerformancePlayer, 'inJoinIn', false);
    if (at < 0) {
      this.finish(player, 'Finished.');
      return;
    }
    // Skip re-entering the beat the live story has already entered.
    this.clock = this.events[at].t / 1000;
    this.next = at + 1;
    if (this.audio) {
      this.audio.currentTime = this.clock;
      void this.audio.play().catch(() => undefined);
    }
    player.setValue(PerformancePlayer, 'status', 'Back to the story...');
  }

  private finish(player: Entity, status: string): void {
    this.teardown();
    player.setValue(PerformancePlayer, 'playing', false);
    player.setValue(PerformancePlayer, 'inJoinIn', false);
    player.setValue(PerformancePlayer, 'status', status);
    const story = first(this.queries.stories.entities);
    story?.setValue(StoryState, 'joinIn', false);
    story?.setValue(StoryState, 'followMode', false);
  }

  private teardown(): void {
    if (this.perf) family.borrow(null);
    this.audio?.pause();
    this.audio = null;
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = '';
    this.perf = null;
    this.frames = null;
    this.rejoinAt = -1;
    handOverride.cameraAllowed = true;
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
