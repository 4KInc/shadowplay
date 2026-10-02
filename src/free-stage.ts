import { createSystem, Entity } from '@iwsdk/core';
import { CREATURES } from './creatures.js';
import { loadDailySolved, saveDailySolved } from './journal-store.js';
import { playChime, playMusicBoxNote } from './sfx.js';
import { stageRuntime } from './stage-runtime.js';
import {
  DailyShape,
  PuppetStates,
  ShadowJournal,
  ShadowPuppet,
  StoryState,
} from './shadowplay-components.js';

/** Shape of the Day riddles; the answer is the shape to make. */
export const RIDDLES: readonly { shape: string; riddle: string }[] = [
  { shape: 'snail', riddle: 'I carry my house on my back.' },
  { shape: 'swan', riddle: 'I glide across the lake with my long neck bent low.' },
  { shape: 'rabbit', riddle: 'Two long ears, and I never stop hopping.' },
  { shape: 'fish', riddle: 'I have no legs, yet I cross every river.' },
  { shape: 'dog', riddle: 'I bark at the moon and guard the door.' },
  { shape: 'bird', riddle: 'Two hands make my wings.' },
];

const MESSAGE_SECONDS = 4.5;
const MUSIC_STEP_SECONDS = 0.55;

function localDate(d = new Date()): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Deterministic riddle for a date: same riddle for everyone on the same day. */
export function riddleFor(date: string): { shape: string; riddle: string } {
  let h = 0;
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return RIDDLES[h % RIDDLES.length];
}

/**
 * Free Stage (after the story): any creature the player can make comes alive,
 * with a soft music-box loop. Shows the Shape of the Day riddle, celebrates
 * solving it (once per day, remembered in IndexedDB), and announces hidden
 * creatures the first time they are found, adding them to the journal.
 */
export class FreeStageSystem extends createSystem({
  stories: { required: [StoryState] },
  daily: { required: [DailyShape] },
  puppets: { required: [ShadowPuppet] },
  journals: { required: [ShadowJournal] },
}) {
  private loaded = false;
  private loading = false;
  private message = '';
  private messageTime = 0;
  private musicTime = 0;
  private musicStep = 0;
  private alive = new Set<string>();
  /** Cached riddle caption; rebuilt only when the riddle or its solved state changes. */
  private base = '';

  update(delta: number): void {
    const story = first(this.queries.stories.entities);
    const daily = first(this.queries.daily.entities);
    if (!story || !daily) return;
    if (!this.loaded && !this.loading) this.load(daily);
    if (!story.getValue(StoryState, 'freeStage') || !this.loaded) return;
    if (story.getValue(StoryState, 'status') === 'paused') return;

    this.musicTime += delta;
    if (this.musicTime >= MUSIC_STEP_SECONDS) {
      this.musicTime = 0;
      playMusicBoxNote(this.musicStep++, stageRuntime.center);
    }

    for (const puppet of this.queries.puppets.entities) {
      const shape = puppet.getValue(ShadowPuppet, 'shape') ?? '';
      const isAlive = puppet.getValue(ShadowPuppet, 'state') === PuppetStates.Alive;
      if (isAlive && !this.alive.has(shape)) this.onAlive(daily, shape);
      if (isAlive) this.alive.add(shape);
      else this.alive.delete(shape);
    }

    this.messageTime = Math.max(0, this.messageTime - delta);
    const caption = this.messageTime > 0 ? this.message : this.base;
    if (story.getValue(StoryState, 'caption') !== caption) story.setValue(StoryState, 'caption', caption);
  }

  private load(daily: Entity): void {
    this.loading = true;
    const today = localDate();
    const { shape, riddle } = riddleFor(today);
    daily.setValue(DailyShape, 'date', today);
    daily.setValue(DailyShape, 'shape', shape);
    daily.setValue(DailyShape, 'riddle', riddle);
    loadDailySolved().then((solvedOn) => {
      daily.setValue(DailyShape, 'solved', solvedOn === today);
      this.base = this.baseCaption(daily);
      this.loaded = true;
    });
  }

  private baseCaption(daily: Entity): string {
    if (daily.getValue(DailyShape, 'solved')) {
      return 'Free Stage. Make any creature you know. Shape of the Day solved; a new riddle tomorrow.';
    }
    return `Free Stage. Shape of the Day: "${daily.getValue(DailyShape, 'riddle')}"`;
  }

  private say(text: string): void {
    this.message = text;
    this.messageTime = MESSAGE_SECONDS;
  }

  private onAlive(daily: Entity, shape: string): void {
    const journal = first(this.queries.journals.entities);
    const known = (journal?.getValue(ShadowJournal, 'discovered') ?? '').split(',').includes(shape);
    const creature = CREATURES.find((c) => c.id === shape);
    if (journal && creature && !known) {
      journal.setValue(ShadowJournal, 'pendingAdd', shape);
      this.say(`You found a hidden creature: the ${creature.name}! It is now in your Shadow Journal.`);
    }
    if (shape === daily.getValue(DailyShape, 'shape') && !daily.getValue(DailyShape, 'solved')) {
      daily.setValue(DailyShape, 'solved', true);
      this.base = this.baseCaption(daily);
      void saveDailySolved(daily.getValue(DailyShape, 'date') ?? localDate());
      playChime(stageRuntime.center);
      this.say(`Shape of the Day solved: the ${creature?.name ?? shape}! Come back tomorrow for a new riddle.`);
    }
  }
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
