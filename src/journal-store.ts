/**
 * Local persistence (IndexedDB): discovered creatures and story progress.
 * Everything stays on the device; no backend. All calls fail soft (a private
 * window or blocked storage just means nothing is remembered).
 */
const DB_NAME = 'shadowplay';
const DB_VERSION = 2;
const CREATURES = 'creatures';
const PROGRESS = 'progress';
const RECORDINGS = 'recordings';

export interface CreatureEntry {
  id: string;
  discoveredAt: number;
  chapter: string;
}

export interface StoryProgress {
  /** Index of the chapter beat to resume from. */
  beatIndex: number;
  chapter: string;
  branch: string;
  savedAt: number;
  /** Story script the progress belongs to (missing: The Moth, saved before the library). */
  script?: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CREATURES)) db.createObjectStore(CREATURES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PROGRESS)) db.createObjectStore(PROGRESS);
      // v2: recorded performances (bedtime stories), with their voice as a Blob.
      if (!db.objectStoreNames.contains(RECORDINGS)) db.createObjectStore(RECORDINGS, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const request = op(db.transaction(store, mode).objectStore(store));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export async function loadCreatures(): Promise<CreatureEntry[]> {
  return (await run<CreatureEntry[]>(CREATURES, 'readonly', (s) => s.getAll() as IDBRequest<CreatureEntry[]>)) ?? [];
}

export async function saveCreature(entry: CreatureEntry): Promise<void> {
  await run(CREATURES, 'readwrite', (s) => s.put(entry));
}

export async function loadProgress(): Promise<StoryProgress | null> {
  return run<StoryProgress>(PROGRESS, 'readonly', (s) => s.get('story') as IDBRequest<StoryProgress>);
}

export async function saveProgress(progress: StoryProgress): Promise<void> {
  await run(PROGRESS, 'readwrite', (s) => s.put(progress, 'story'));
}

/** Date (YYYY-MM-DD, local) of the last solved Shape of the Day. */
export async function loadDailySolved(): Promise<string | null> {
  return run<string>(PROGRESS, 'readonly', (s) => s.get('daily') as IDBRequest<string>);
}

export async function saveDailySolved(date: string): Promise<void> {
  await run(PROGRESS, 'readwrite', (s) => s.put(date, 'daily'));
}

export interface StoredSettings {
  tolerance: string;
  hints: string;
  oneHand: boolean;
  highContrast?: boolean;
  gazeDwell?: boolean;
  voiceCommands?: boolean;
  placeholderVoice?: boolean;
}

export async function loadFamily(): Promise<{ child: string; performer: string } | null> {
  return run<{ child: string; performer: string }>(PROGRESS, 'readonly', (s) => s.get('family') as IDBRequest<{ child: string; performer: string }>);
}

export async function saveFamily(names: { child: string; performer: string }): Promise<void> {
  await run(PROGRESS, 'readwrite', (s) => s.put(names, 'family'));
}

/** Whether a bundled sample was added (per sample; 'samples' alone marks devices seeded before that). */
export async function loadSampleSeeded(name: string): Promise<boolean> {
  const one = await run<boolean>(PROGRESS, 'readonly', (s) => s.get(`samples:${name}`) as IDBRequest<boolean>);
  const all = await run<boolean>(PROGRESS, 'readonly', (s) => s.get('samples') as IDBRequest<boolean>);
  return Boolean(one || all);
}

export async function saveSampleSeeded(name: string): Promise<void> {
  await run(PROGRESS, 'readwrite', (s) => s.put(true, `samples:${name}`));
}

/** The last story Mo dreamed up (one is kept, so it can be resumed next launch). */
export async function loadDreamed(): Promise<unknown> {
  return run<unknown>(PROGRESS, 'readonly', (s) => s.get('dreamed') as IDBRequest<unknown>);
}

export async function saveDreamed(script: unknown): Promise<void> {
  await run(PROGRESS, 'readwrite', (s) => s.put(script, 'dreamed'));
}

export async function loadSettings(): Promise<StoredSettings | null> {
  return run<StoredSettings>(PROGRESS, 'readonly', (s) => s.get('settings') as IDBRequest<StoredSettings>);
}

export async function saveSettings(settings: StoredSettings): Promise<void> {
  await run(PROGRESS, 'readwrite', (s) => s.put(settings, 'settings'));
}

/** Silhouette templates recorded on this device (recognition method 2). */
export async function loadRecordedTemplates(): Promise<{ shape: string; mask: string }[]> {
  return (await run<{ shape: string; mask: string }[]>(PROGRESS, 'readonly', (s) => s.get('silhouettes') as IDBRequest<{ shape: string; mask: string }[]>)) ?? [];
}

export async function saveRecordedTemplates(templates: { shape: string; mask: string }[]): Promise<void> {
  await run(PROGRESS, 'readwrite', (s) => s.put(templates, 'silhouettes'));
}

export interface Unlocks {
  chapters: string[];
  endings: string[];
}

/** Chapters reached and endings seen, for chapter select and encore endings. */
export async function loadUnlocks(): Promise<Unlocks> {
  return (await run<Unlocks>(PROGRESS, 'readonly', (s) => s.get('unlocks') as IDBRequest<Unlocks>)) ?? { chapters: [], endings: [] };
}

export async function saveUnlocks(unlocks: Unlocks): Promise<void> {
  await run(PROGRESS, 'readwrite', (s) => s.put(unlocks, 'unlocks'));
}

/** Recognition-lab trials (device gate testing), kept so testers' data pools across sessions. */
export async function loadLabTrials<T>(): Promise<T[]> {
  return (await run<T[]>(PROGRESS, 'readonly', (s) => s.get('lab') as IDBRequest<T[]>)) ?? [];
}

export async function saveLabTrials<T>(trials: T[]): Promise<void> {
  await run(PROGRESS, 'readwrite', (s) => s.put(trials, 'lab'));
}

/** Recorded performances (kept locally; sharing comes through the server). */
export async function saveRecording<T extends { id: string }>(recording: T): Promise<void> {
  await run(RECORDINGS, 'readwrite', (s) => s.put(recording));
}

export async function loadRecording<T>(id: string): Promise<T | null> {
  return run<T>(RECORDINGS, 'readonly', (s) => s.get(id) as IDBRequest<T>);
}

export async function listRecordings<T>(): Promise<T[]> {
  return (await run<T[]>(RECORDINGS, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)) ?? [];
}

export async function deleteRecording(id: string): Promise<void> {
  await run(RECORDINGS, 'readwrite', (s) => s.delete(id));
}
