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

/**
 * Google Cloud Storage bucket, through the JSON API with the runtime's own
 * service account (Cloud Run metadata server): no SDK needed. Expiry is the
 * bucket's lifecycle rule (delete objects older than the TTL), so olderThan
 * returns nothing; the TTL is still checked on every read.
 */
export class GcsStore implements StoryStore {
  private token = '';
  private tokenExpires = 0;
  private bucket: string;
  private api: string;
  private tokenUrl: string;

  /** `tokenUrl` '' sends no credentials (a local test double). */
  constructor(
    bucket: string,
    api = 'https://storage.googleapis.com',
    tokenUrl = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
  ) {
    this.bucket = bucket;
    this.api = api;
    this.tokenUrl = tokenUrl;
  }

  private async auth(): Promise<Record<string, string>> {
    if (!this.tokenUrl) return {};
    if (Date.now() > this.tokenExpires - 60_000) {
      const res = await fetch(this.tokenUrl, { headers: { 'Metadata-Flavor': 'Google' } });
      if (!res.ok) throw new Error(`metadata token ${res.status}`);
      const body = (await res.json()) as { access_token: string; expires_in: number };
      this.token = body.access_token;
      this.tokenExpires = Date.now() + body.expires_in * 1000;
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  private object(code: string): string {
    return encodeURIComponent(`stories/${code}.json`);
  }

  /** Write any object (diagnostics logs) by its full name. */
  async putRaw(name: string, body: string, contentType = 'application/x-ndjson'): Promise<void> {
    const url = `${this.api}/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`;
    const res = await fetch(url, { method: 'POST', headers: { ...(await this.auth()), 'Content-Type': contentType }, body });
    if (!res.ok) throw new Error(`storage put ${res.status}`);
  }

  async put(code: string, json: string): Promise<void> {
    const url = `${this.api}/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${this.object(code)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...(await this.auth()), 'Content-Type': 'application/json' },
      body: json,
    });
    if (!res.ok) throw new Error(`storage put ${res.status}`);
  }

  async get(code: string): Promise<string | null> {
    const res = await fetch(`${this.api}/storage/v1/b/${this.bucket}/o/${this.object(code)}?alt=media`, {
      headers: await this.auth(),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`storage get ${res.status}`);
    return res.text();
  }

  async remove(code: string): Promise<void> {
    const res = await fetch(`${this.api}/storage/v1/b/${this.bucket}/o/${this.object(code)}`, {
      method: 'DELETE',
      headers: await this.auth(),
    });
    if (!res.ok && res.status !== 404) throw new Error(`storage delete ${res.status}`);
  }

  async olderThan(): Promise<string[]> {
    return [];
  }
}
