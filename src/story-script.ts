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
  | { id: string; type: 'end'; text: string };

export interface StoryScript {
  version: 'shadowplay.story.v1';
  title: string;
  beats: StoryBeat[];
}

/** Comfortable caption reading time: ~3 words per second plus a pause. */
export function readingSeconds(text: string): number {
  const words = text.trim().split(/\s+/u).length;
  return Math.max(2.5, words / 3 + 1.2);
}

export async function loadStoryScript(path: string): Promise<StoryScript> {
  const url = `${import.meta.env.BASE_URL}${path.replace(/^\/+/u, '')}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Story script ${url}: HTTP ${response.status}`);
  const script = (await response.json()) as StoryScript;
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
