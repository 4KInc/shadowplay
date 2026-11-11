import { createSystem, Entity } from '@iwsdk/core';
import { onAway } from './away.js';
import { StallWatch } from './narration-watch.js';
import { LiveSession, PerformanceRecorder, Settings, StoryState, StoryStatuses } from './shadowplay-components.js';

interface NarrationManifest {
  version: 'shadowplay.narration.v1';
  /** Beat id -> clip path relative to the app base. */
  clips: Record<string, string>;
}

/**
 * Plays narration in sync with the captions (the brief's NarrationSystem).
 * When a beat brings a new caption, its recorded clip from
 * public/narration/manifest.json plays; until recordings exist, an optional
 * test-only placeholder voice (on-device speech synthesis only, never a cloud
 * voice) can speak the caption for playtest pacing. Reports when each line
 * finishes so the story waits for it, and pauses and resumes with the story.
 */
export class NarrationSystem extends createSystem({
  stories: { required: [StoryState] },
  settings: { required: [Settings] },
  recorders: { required: [PerformanceRecorder] },
  sessions: { required: [LiveSession] },
}) {
  private clips: Record<string, string> = {};
  private loaded = false;
  private loading = false;
  private lastBeat = '';
  private lastText = '';
  private audio: HTMLAudioElement | null = null;
  private speaking = false;
  private paused = false;
  /** Bumped per line so callbacks from a stopped line are ignored. */
  private line = 0;
  /** Notices a clip that stopped making progress (see narration-watch.ts). */
  private watch = new StallWatch();

  init(): void {
    // Browsers load the voice list lazily; ask early so the first line has a voice.
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices();
    this.cleanupFuncs.push(
      () => this.stopLine(),
      // Pause at once when the player steps away: a hidden session runs no frames to do it.
      // Coming back, update() resumes the line once the story is playing again.
      onAway((isAway) => {
        if (isAway) this.pauseLine();
      }),
    );
  }

  update(delta: number): void {
    const story = first(this.queries.stories.entities);
    if (!story) return;
    if (!this.loaded && !this.loading) this.load();
    if (!this.loaded) return;

    const status = story.getValue(StoryState, 'status');
    if (status === StoryStatuses.Paused) {
      this.pauseLine();
      return;
    }
    // During a replayed performance the performer's own voice is the narration;
    // and while a parent records with their voice or talks live, they are the
    // narrator (the captions become their script).
    const replaying = Boolean(story.getValue(StoryState, 'followMode'));
    if (status !== StoryStatuses.Playing || story.getValue(StoryState, 'freeStage') || replaying || this.parentNarrating()) {
      if (this.audio || this.speaking) {
        this.stopLine();
        // A cut-off line counts as finished, so the story paces itself by reading time.
        story.setValue(StoryState, 'voiceDone', true);
      }
      return;
    }
    this.resumeLine();
    if (this.audio) this.watchClip(story, delta);

    const beat = story.getValue(StoryState, 'beatId') ?? '';
    if (beat === this.lastBeat) return;
    this.lastBeat = beat;
    const text = story.getValue(StoryState, 'caption') ?? '';
    // Beats without new words (moth, scenery, lamp...) keep the previous line.
    if (!text || text === this.lastText) {
      this.finish(story, beat, '');
      return;
    }
    this.lastText = text;
    this.speak(story, beat, text);
  }

  private parentNarrating(): boolean {
    const rec = first(this.queries.recorders.entities);
    if (rec?.getValue(PerformanceRecorder, 'recording') && rec.getValue(PerformanceRecorder, 'withVoice')) return true;
    return Boolean(first(this.queries.sessions.entities)?.getValue(LiveSession, 'talking'));
  }

  private load(): void {
    this.loading = true;
    fetch(`${import.meta.env.BASE_URL}narration/manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<NarrationManifest>) : null))
      .catch(() => null)
      .then((manifest) => {
        this.clips = manifest?.clips ?? {};
        this.loaded = true;
      });
  }

  private speak(story: Entity, beat: string, text: string): void {
    this.stopLine();
    const line = ++this.line;
    story.setValue(StoryState, 'voiceBeat', beat);
    story.setValue(StoryState, 'voiceDone', false);
    const done = () => {
      if (line === this.line) this.finish(story, beat, story.getValue(StoryState, 'voiceSource') ?? '');
    };

    const clip = this.clips[beat];
    if (clip) {
      const audio = new Audio(`${import.meta.env.BASE_URL}${clip.replace(/^\/+/u, '')}`);
      this.audio = audio;
      this.watch.reset();
      audio.addEventListener('ended', done, { once: true });
      audio.addEventListener('error', done, { once: true });
      story.setValue(StoryState, 'voiceSource', 'clip');
      // An AbortError only means a pause or a reload (the stall watch's retry) interrupted
      // this attempt; the line is not over. Any other failure ends it.
      void audio.play().catch((e: unknown) => {
        if ((e as Error)?.name !== 'AbortError') done();
      });
      return;
    }

    const settings = first(this.queries.settings.entities);
    // Test-only: never in production builds (no licence for commercial use).
    const allowed = import.meta.env.DEV && Boolean(settings?.getValue(Settings, 'placeholderVoice'));
    const voice = allowed ? localVoice() : null;
    if (voice) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.rate = 0.92;
      utterance.onend = done;
      utterance.onerror = done;
      this.speaking = true;
      story.setValue(StoryState, 'voiceSource', 'placeholder');
      speechSynthesis.speak(utterance);
      return;
    }
    this.finish(story, beat, '');
  }

  private finish(story: Entity, beat: string, source: string): void {
    this.audio = null;
    this.speaking = false;
    story.setValue(StoryState, 'voiceBeat', beat);
    story.setValue(StoryState, 'voiceSource', source);
    story.setValue(StoryState, 'voiceDone', true);
  }

  /**
   * A clip that should be playing but has not moved: reload it and try once
   * more; if it is still stuck, stop it and let the line end on its caption
   * (the story then paces it by reading time), rather than wait on silence.
   */
  private watchClip(story: Entity, delta: number): void {
    const audio = this.audio!;
    const action = this.watch.step(delta, audio.currentTime);
    if (action === 'retry') {
      audio.load();
      void audio.play().catch(() => undefined);
    } else if (action === 'give-up') {
      this.line++;
      audio.pause();
      this.finish(story, story.getValue(StoryState, 'voiceBeat') ?? '', 'clip');
    }
  }

  private pauseLine(): void {
    if (this.paused) return;
    this.paused = true;
    this.audio?.pause();
    if (this.speaking) speechSynthesis.pause();
  }

  private resumeLine(): void {
    if (!this.paused) return;
    this.paused = false;
    void this.audio?.play().catch(() => undefined);
    if (this.speaking) speechSynthesis.resume();
  }

  private stopLine(): void {
    this.line++;
    this.paused = false;
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    if (this.speaking && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.speaking = false;
  }
}

/** An English voice that runs on the device (never a network voice). */
function localVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices().filter((v) => v.localService && v.lang.toLowerCase().startsWith('en'));
  return voices.find((v) => v.default) ?? voices[0] ?? null;
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
