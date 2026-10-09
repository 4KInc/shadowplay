import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Where shared stories live. Local disk for development; a cloud bucket in production. */
export interface StoryStore {
  put(code: string, json: string): Promise<void>;
  get(code: string): Promise<string | null>;
  remove(code: string): Promise<void>;
  /** Codes stored before `cutoff` (ms since epoch). */
  olderThan(cutoff: number): Promise<string[]>;
}

export class DiskStore implements StoryStore {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private file(code: string): string {
    return join(this.dir, `${code}.json`);
  }

  async put(code: string, json: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(code), json, 'utf8');
  }

  async get(code: string): Promise<string | null> {
    try {
      return await readFile(this.file(code), 'utf8');
    } catch {
      return null;
    }
  }

  async remove(code: string): Promise<void> {
    await rm(this.file(code), { force: true });
  }

  async olderThan(cutoff: number): Promise<string[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const old: string[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const info = await stat(join(this.dir, name));
      if (info.mtimeMs < cutoff) old.push(name.slice(0, -5));
    }
    return old;
  }
}
