import { createSystem, Entity } from '@iwsdk/core';
import { loadStoryScript, StoryBeat, storyRuntime } from '../story-script.js';
import { listRecordings, loadRecording, saveRecording } from '../journal-store.js';
import { FamilyInbox, LiveSession, PerformancePlayer, StoryState } from '../shadowplay-components.js';
import type { Performance } from './format.js';
import { seedSamples } from './samples.js';
import { fetchReplies } from './sharing.js';

/** Look for new goodnights this often (ms), only while the page is open. */
const POLL_MS = 90_000;
/** Shared stories expire after 30 days, and so do their replies. */
const MAX_AGE_MS = 30 * 86_400_000;

/**
 * The storyteller's inbox: for each story this device sent, fetch the
 * goodnights the family sent back, keep them on the device, and play the
 * oldest unwatched one on the wall when asked.
 */
export class FamilyInboxSystem extends createSystem({
  inboxes: { required: [FamilyInbox] },
  players: { required: [PerformancePlayer] },
  stories: { required: [StoryState] },
  sessions: { required: [LiveSession] },
}) {
  /** Beat types of the running story (for the waiting-goodnight cue). */
  private beatTypes = new Map<string, StoryBeat['type']>();
  private typesFor = '';
  private cuedBeat = '';
  private nextPoll = 0;
  private polling = false;
  /** Goodnight ids waiting to be watched, oldest first. */
  private unwatched: { id: string; from: string }[] = [];
  private playing = '';

  update(): void {
    const inbox = this.queries.inboxes.entities.values().next().value;
    const player = this.queries.players.entities.values().next().value;
    if (!inbox || !player) return;
    const now = performance.now();
    if (now >= this.nextPoll && !this.polling) {
      this.nextPoll = now + POLL_MS;
      void this.poll(inbox);
    }
    if (inbox.getValue(FamilyInbox, 'playRequested')) {
      inbox.setValue(FamilyInbox, 'playRequested', false);
      const next = this.unwatched[0];
      if (next && !player.getValue(PerformancePlayer, 'playing')) {
        this.playing = next.id;
        player.setValue(PerformancePlayer, 'recordingId', next.id);
        player.setValue(PerformancePlayer, 'joinIn', false);
        player.setValue(PerformancePlayer, 'paused', false);
        player.setValue(PerformancePlayer, 'playing', true);
      }
    }
    this.cue(inbox);
    // Watched to the end (or stopped): it leaves the unwatched list.
    if (this.playing && !player.getValue(PerformancePlayer, 'playing')) {
      void this.markWatched(this.playing);
      this.unwatched = this.unwatched.filter((u) => u.id !== this.playing);
      this.playing = '';
      this.publish(inbox);
    }
  }

  /**
   * At the story's natural pauses (between chapters, the end, Free Stage) tell
   * the storyteller a goodnight is waiting, and where to find it.
   */
  private cue(inbox: Entity): void {
    const story = this.queries.stories.entities.values().next().value;
    if (!story || !this.unwatched.length || story.getValue(StoryState, 'followMode')) return;
    if (this.queries.sessions.entities.values().next().value?.getValue(LiveSession, 'role') !== 'off') return;
    const script = storyRuntime.script;
    if (script && script !== this.typesFor) {
      this.typesFor = script;
      this.beatTypes.clear();
      void loadStoryScript(script).then((s) => {
        if (this.typesFor === script) for (const b of s.beats) this.beatTypes.set(b.id, b.type);
      }).catch(() => undefined);
    }
    const beat = story.getValue(StoryState, 'beatId') ?? '';
    const type = this.beatTypes.get(beat);
    if (beat === this.cuedBeat || (type !== 'continue' && type !== 'freestage' && type !== 'end')) return;
    this.cuedBeat = beat;
    const from = inbox.getValue(FamilyInbox, 'latestFrom') || 'your family';
    const caption = story.getValue(StoryState, 'caption') ?? '';
    story.setValue(StoryState, 'caption', `${caption}  A goodnight from ${from} is waiting: pinch your Shadow Journal to watch it.`.trim());
  }

  private async poll(inbox: Entity): Promise<void> {
    this.polling = true;
    try {
      await seedSamples();
      const all = await listRecordings<Performance & { watched?: boolean }>();
      const cutoff = Date.now() - MAX_AGE_MS;
      const shared = all.filter((p) => p.shareCode && !p.replyTo && p.createdAt > cutoff);
      for (const story of shared) {
        for (const reply of await fetchReplies(story.shareCode!)) {
          if (await loadRecording(reply.id)) continue;
          await saveRecording({ ...reply, watched: false });
        }
      }
      const fresh = (await listRecordings<Performance & { watched?: boolean }>())
        .filter((p) => p.replyTo && !p.watched)
        .sort((a, b) => a.createdAt - b.createdAt);
      this.unwatched = fresh.map((p) => ({ id: p.id, from: p.performer }));
      this.publish(inbox);
    } catch {
      // Offline: try again at the next poll.
    } finally {
      this.polling = false;
    }
  }

  private publish(inbox: Entity): void {
    inbox.setValue(FamilyInbox, 'unwatched', this.unwatched.length);
    inbox.setValue(FamilyInbox, 'latestFrom', this.unwatched[this.unwatched.length - 1]?.from ?? '');
  }

  private async markWatched(id: string): Promise<void> {
    const perf = await loadRecording<Performance>(id);
    if (perf) await saveRecording({ ...perf, watched: true });
  }
}
