import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

/**
 * Brotli or gzip for text-like app files. The built app never changes while
 * the server runs, so each file is compressed once, kept in memory (a few MB)
 * and warmed at startup so the first visitor does not wait.
 */
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.json', '.uikitml', '.md', '.svg', '.wasm', '.txt']);
const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

interface Entry {
  mtime: number;
  br: Promise<Buffer>;
  gzip: Promise<Buffer>;
}
const cache = new Map<string, Entry>();

export function compressible(file: string): boolean {
  return COMPRESSIBLE.has(extname(file));
}

/** The best encoding the request accepts, or null for none. */
export function pickEncoding(acceptEncoding: string | string[] | undefined): 'br' | 'gzip' | null {
  const accept = (Array.isArray(acceptEncoding) ? acceptEncoding.join(',') : acceptEncoding ?? '').toLowerCase();
  const allowed = (name: string) => new RegExp(`(^|,)\\s*${name}\\s*(;\\s*q=(?!0(\\.0*)?\\s*(,|$))[\\d.]+)?\\s*(,|$)`).test(accept);
  if (allowed('br')) return 'br';
  if (allowed('gzip')) return 'gzip';
  return null;
}

function entry(file: string, mtime: number): Entry {
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit;
  const data = readFile(file);
  const fresh: Entry = {
    mtime,
    br: data.then((d) => brotli(d, { params: { [constants.BROTLI_PARAM_QUALITY]: 10, [constants.BROTLI_PARAM_SIZE_HINT]: d.length } })),
    gzip: data.then((d) => gz(d, { level: 9 })),
  };
  // A failure is not cached: the next request tries again.
  fresh.br.catch(() => cache.delete(file));
  cache.set(file, fresh);
  return fresh;
}

export async function compressed(file: string, mtime: number, encoding: 'br' | 'gzip'): Promise<Buffer> {
  return entry(file, mtime)[encoding];
}

/** Compress every compressible file under `dir` in the background (startup). */
export async function warm(dir: string): Promise<number> {
  let n = 0;
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (compressible(p)) {
        const info = await stat(p);
        const en = entry(p, info.mtimeMs);
        await Promise.all([en.br, en.gzip]).catch(() => undefined);
        n++;
      }
    }
  };
  await walk(dir);
  return n;
}
