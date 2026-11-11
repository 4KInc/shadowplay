import { loadRecording, loadSampleSeeded, saveRecording, saveSampleSeeded } from '../journal-store.js';
import { fromWire } from './sharing.js';

/**
 * First launch: a bundled example for whoever is trying Shadowplay alone, by
 * role. The family viewer gets a story "from Dad" (2.8 MB); the storyteller's
 * headset gets a goodnight "from Mia" waiting in Goodnights (0.2 MB). Each is
 * labelled as a sample, added once per device, and downloaded only where it
 * is shown.
 */
const SAMPLES = {
  viewer: 'story-from-dad',
  headset: 'goodnight-from-mia',
} as const;

const ready = new Map<string, Promise<void>>();

/** Adds this role's sample if the device has never had it; resolves when done (or failed). */
export function seedSamples(role: keyof typeof SAMPLES): Promise<void> {
  const name = SAMPLES[role];
  let p = ready.get(name);
  if (!p) {
    p = (async () => {
      try {
        if (await loadSampleSeeded(name)) return;
        const response = await fetch(`${import.meta.env.BASE_URL}samples/${name}.json`);
        if (!response.ok) return;
        const perf = await fromWire(await response.json());
        if (!(await loadRecording(perf.id))) {
          await saveRecording({ ...perf, sample: true, ...(perf.replyTo ? { watched: false } : {}) });
        }
        await saveSampleSeeded(name);
      } catch {
        // Offline or storage blocked: the app works without samples.
      }
    })();
    ready.set(name, p);
  }
  return p;
}
