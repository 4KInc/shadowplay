/**
 * Local persistence (IndexedDB): discovered creatures and story progress.
 * Everything stays on the device; no backend. All calls fail soft (a private
 * window or blocked storage just means nothing is remembered).
 */
const DB_NAME = 'shadowplay';
const DB_VERSION = 1;
const CREATURES = 'creatures';
const PROGRESS = 'progress';

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
