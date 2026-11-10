import { loadRecording, loadSamplesSeeded, saveRecording, saveSamplesSeeded } from '../journal-store.js';
import { fromWire } from './sharing.js';

/**
 * First launch: two bundled examples, so someone trying Shadowplay alone can
 * see what a family shares. A story "from Dad" (the family viewer lists it)
 * and a goodnight "from Mia" waiting in the storyteller's Goodnights. Both are
 * labelled as samples, are added once per device, and can be watched like
 * any other.
 */
const SAMPLES = ['samples/story-from-dad.json', 'samples/goodnight-from-mia.json'];

let ready: Promise<void> | null = null;

/** Adds the samples on a device that has never had them; resolves when done (or failed). */
export function seedSamples(): Promise<void> {
  ready ??= (async () => {
    try {
      if (await loadSamplesSeeded()) return;
      for (const path of SAMPLES) {
        const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
        if (!response.ok) return;
        const perf = await fromWire(await response.json());
        if (await loadRecording(perf.id)) continue;
        await saveRecording({ ...perf, sample: true, ...(perf.replyTo ? { watched: false } : {}) });
      }
      await saveSamplesSeeded();
    } catch {
      // Offline or storage blocked: the app works without samples.
    }
  })();
  return ready;
}
