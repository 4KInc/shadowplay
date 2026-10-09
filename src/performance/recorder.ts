import { createSystem, Entity } from '@iwsdk/core';
import { family } from '../family.js';
import { loadRecording, saveRecording } from '../journal-store.js';
import { uploadStory, watchLink } from './sharing.js';
import { PerformanceRecorder, StoryState } from '../shadowplay-components.js';
import { handRuntime, stageRuntime } from '../stage-runtime.js';
import {
  encodeHands,
  FRAME_HZ,
  FRAME_STRIDE,
  Performance,
  PERFORMANCE_VERSION,
  PerformanceEvent,
  writeFrame,
} from './format.js';
import { storyTap } from './story-tap.js';

/** Longest performance (seconds): a bedtime story, not a film. */
const MAX_SECONDS = 15 * 60;
/**
 * Records a performance on this stage: both hands at 30 Hz in stage-relative
 * coordinates, the story tap's events (beats, creatures waking and
 * releasing, lamp moves, staging), and (optionally) the performer's voice. Saved to
 * IndexedDB on stop; the player replays it on any stage.
 */
export class PerformanceRecorderSystem extends createSystem({
  recorders: { required: [PerformanceRecorder] },
  stories: { required: [StoryState] },
}) {
  private active = false;
  private elapsed = 0;
  private nextFrameAt = 0;
  private frames = new Int16Array(0);
  private frameCount = 0;
  private events: PerformanceEvent[] = [];
  private media: MediaRecorder | null = null;
  private mic: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private sharing = false;

  init(): void {
    this.cleanupFuncs.push(
      () => this.releaseMic(),
      storyTap.subscribe((e) => {
        if (this.active) this.events.push({ t: Math.round(this.elapsed * 1000), ...e });
      }),
    );
  }

  update(delta: number): void {
    const rec = first(this.queries.recorders.entities);
    const story = first(this.queries.stories.entities);
    if (!rec || !story) return;
    const want = Boolean(rec.getValue(PerformanceRecorder, 'recording'));
    if (want && !this.active) this.beginRecording(rec);
    if (!want && this.active) void this.finishRecording(rec, story);
    if (rec.getValue(PerformanceRecorder, 'shareRequested') && !this.sharing) void this.share(rec);
    if (!this.active || !stageRuntime.ready) return;

    this.elapsed += delta;
    if (this.elapsed >= this.nextFrameAt) {
      this.nextFrameAt += 1 / FRAME_HZ;
      this.captureFrame();
    }
    rec.setValue(PerformanceRecorder, 'seconds', +this.elapsed.toFixed(1));
    if (this.elapsed >= MAX_SECONDS) rec.setValue(PerformanceRecorder, 'recording', false);
  }

  private beginRecording(rec: Entity): void {
    this.active = true;
    this.elapsed = 0;
    this.nextFrameAt = 0;
    this.frameCount = 0;
    this.frames = new Int16Array(FRAME_HZ * 60 * FRAME_STRIDE);
    this.events = [];
    this.startedAt = Date.now();
    // The stage as it is now (a recording may start mid-story), then the beat in progress.
    for (const e of storyTap.current()) this.events.push({ t: 0, ...e });
    rec.setValue(PerformanceRecorder, 'status', 'Recording...');
    if (rec.getValue(PerformanceRecorder, 'withVoice')) void this.startMic(rec);
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

  private async finishRecording(rec: Entity, story: Entity): Promise<void> {
    this.active = false;
    const audio = await this.finishAudio();
    const performance: Performance = {
      version: PERFORMANCE_VERSION,
      id: `perf-${this.startedAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: storyTitle(rec.getValue(PerformanceRecorder, 'title') ?? ''),
      performer: rec.getValue(PerformanceRecorder, 'performer') || family.own.performer,
      child: family.own.child,
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

  /** Send the last recording to the family: upload it and show the family code. */
  private async share(rec: Entity): Promise<void> {
    this.sharing = true;
    rec.setValue(PerformanceRecorder, 'shareRequested', false);
    try {
      const perf = await loadRecording<Performance>(rec.getValue(PerformanceRecorder, 'lastId') ?? '');
      if (!perf) throw new Error('Record a story first.');
      rec.setValue(PerformanceRecorder, 'status', 'Sending your story...');
      const { code } = await uploadStory(perf);
      rec.setValue(PerformanceRecorder, 'shareCode', code);
      rec.setValue(PerformanceRecorder, 'shareLink', watchLink(code));
      rec.setValue(PerformanceRecorder, 'status', `Sent! Family code: ${code}`);
    } catch (error) {
      rec.setValue(PerformanceRecorder, 'status', `Could not send: ${(error as Error).message}`);
    } finally {
      this.sharing = false;
    }
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

/** The untouched default title becomes 'A story for Mia' once the family names are set. */
function storyTitle(title: string): string {
  if (title && title !== 'A bedtime story') return title;
  return family.own.child ? `A story for ${family.own.child}` : 'A bedtime story';
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
