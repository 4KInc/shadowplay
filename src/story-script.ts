import { loadDreamed } from './journal-store.js';
/**
 * Story script format (public/story/*.story.json). Each beat either runs for a
 * reading-time duration (chapter, narrate, release, journal) or waits on the
 * player (follow, request, choice, grow, carry, continue). The story never
 * fails: it waits.
 */
export interface ChoiceOption {
  shape: string;
  alt?: string;
  outlineU?: number;
  outlineV?: number;
  /** Beat id to jump to when this option is chosen. */
  goto: string;
}

export type StoryBeat =
  | { id: string; type: 'chapter'; chapter: string; text: string }
  | { id: string; type: 'narrate'; text: string; seconds?: number }
  | { id: string; type: 'lamp'; level: number }
  | { id: string; type: 'moth'; mode: string; restU?: number; restV?: number }
  | { id: string; type: 'scenery'; set: string }
  | { id: string; type: 'actor'; state: string; u?: number; v?: number }
  | { id: string; type: 'follow'; seconds: number; text: string }
  | { id: string; type: 'request'; shape: string; alt?: string; outlineU?: number; outlineV?: number; text: string }
  | { id: string; type: 'choice'; text: string; options: ChoiceOption[] }
  | {
      id: string;
      type: 'grow';
      /** Required growth relative to the size when the beat began. */
      factor: number;
      /** Absolute floor, as a fraction of stage width. */
      minSize?: number;
      holdSeconds?: number;
      text: string;
    }
  | { id: string; type: 'carry'; toU: number; minV?: number; text: string }
  | { id: string; type: 'release'; text: string }
  | { id: string; type: 'journal'; creature: string; text: string }
  | { id: string; type: 'continue'; text: string }
  | { id: string; type: 'goto'; to: string }
  | { id: string; type: 'prop'; active: boolean; u?: number }
  | { id: string; type: 'reveal'; text: string }
  | { id: string; type: 'letgo'; text: string }
  | { id: string; type: 'finale'; seconds: number }
  | { id: string; type: 'freestage'; text: string }
  | { id: string; type: 'end'; text: string };

export interface StoryScript {
  version: 'shadowplay.story.v1';
  title: string;
  beats: StoryBeat[];
}

/** The script the story system has loaded and is running (replays and Live wait for it). */
export const storyRuntime = { script: '' };

/** Comfortable caption reading time: ~3 words per second plus a pause. */
export function readingSeconds(text: string): number {
  const words = text.trim().split(/\s+/u).length;
  return Math.max(2.5, words / 3 + 1.2);
}

/**
 * A story Mo dreamed up ('dreamed:<n>', the n-th one on this device): kept in
 * the journal store, never a file, and only the latest is kept. Not an app
 * story file, so recordings and Live do not carry it.
 */
const DREAMED = /^dreamed:\d{1,6}$/;

export function isDreamed(path: string): boolean {
  return DREAMED.test(path);
}

/**
 * A dreamed story received from another device, inside a recording or a live
 * story ('shared:<key>'): already checked (story-checks.ts checkSharedStory),
 * kept in memory while it plays. Never saved, never shared on.
 */
const SHARED = /^shared:[A-Za-z0-9_-]{1,80}$/;
const sharedScripts = new Map<string, StoryScript>();

/** Make a received story playable; answers the path to tell it by. */
export function shareScript(key: string, script: StoryScript): string {
  const path = `shared:${key.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80)}`;
  sharedScripts.set(path, script);
  return path;
}

/** Only the app's own story files (a recording or a Live peer names one; never any other path). */
const SCRIPT_PATH = /^story\/[a-z0-9-]{1,40}\.story\.json$/;

export function isStoryScript(path: string): boolean {
  return SCRIPT_PATH.test(path);
}

export async function loadStoryScript(path: string): Promise<StoryScript> {
  let script: StoryScript;
  let url = path;
  if (DREAMED.test(path)) {
    script = (await loadDreamed()) as StoryScript;
    if (!script) throw new Error('No dreamed story on this device');
  } else if (SHARED.test(path)) {
    const shared = sharedScripts.get(path);
    if (!shared) throw new Error('That story is no longer here');
    script = shared;
  } else {
    if (!SCRIPT_PATH.test(path)) throw new Error(`Unknown story "${path.slice(0, 60)}"`);
    url = `${import.meta.env.BASE_URL}${path.replace(/^\/+/u, '')}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Story script ${url}: HTTP ${response.status}`);
    script = (await response.json()) as StoryScript;
  }
  if (script.version !== 'shadowplay.story.v1' || !Array.isArray(script.beats)) {
    throw new Error(`Story script ${url}: unsupported format`);
  }
  const ids = new Set(script.beats.map((b) => b.id));
  for (const beat of script.beats) {
    const targets =
      beat.type === 'goto' ? [beat.to] : beat.type === 'choice' ? beat.options.map((o) => o.goto) : [];
    for (const t of targets) {
      if (!ids.has(t)) throw new Error(`Story script ${url}: beat '${beat.id}' jumps to unknown '${t}'`);
    }
  }
  return script;
}
