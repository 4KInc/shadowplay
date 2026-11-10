import { saveRecording } from '../journal-store.js';
import { Performance, PERFORMANCE_VERSION } from './format.js';

/**
 * Sharing bedtime stories through the Shadowplay server: a performance is
 * uploaded with its voice embedded and comes back as a private family code;
 * the family viewer fetches it by that code and keeps a local copy.
 */
type Wire = Omit<Performance, 'audio'> & { audio: string | null };

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

export async function toWire(perf: Performance): Promise<Wire> {
  return { ...perf, audio: perf.audio ? await blobToDataUrl(perf.audio) : null };
}

export async function fromWire(wire: Wire): Promise<Performance> {
  if (wire.version !== PERFORMANCE_VERSION) throw new Error('This story needs a newer Shadowplay.');
  return { ...wire, audio: wire.audio ? await dataUrlToBlob(wire.audio) : null };
}

export interface Shared {
  code: string;
  expiresAt: number;
}

export async function uploadStory(perf: Performance): Promise<Shared> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(await toWire(perf)),
  });
  const body = (await res.json()) as Shared & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Upload failed (${res.status})`);
  return { code: body.code, expiresAt: body.expiresAt };
}

/** Fetch a story by family code and keep it on this device. */
export async function fetchStory(code: string): Promise<Performance> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/stories/${encodeURIComponent(code.trim())}`);
  const body = (await res.json()) as { performance?: Wire; error?: string };
  if (!res.ok || !body.performance) throw new Error(body.error ?? 'No story with that code.');
  const perf = await fromWire(body.performance);
  perf.shareCode = (body as { code?: string }).code ?? code.trim();
  await saveRecording(perf);
  return perf;
}

/** Send a goodnight back, attached to the story it answers. */
export async function sendReply(code: string, perf: Performance): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/stories/${encodeURIComponent(code)}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(await toWire({ ...perf, replyTo: code })),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Could not send (${res.status})`);
  }
}

/** The goodnights the family sent back for a story (the storyteller's side). */
export async function fetchReplies(code: string): Promise<Performance[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/stories/${encodeURIComponent(code)}/replies`);
  if (!res.ok) return [];
  const body = (await res.json()) as { replies?: Wire[] };
  const out: Performance[] = [];
  for (const wire of body.replies ?? []) {
    try {
      out.push({ ...(await fromWire(wire)), replyTo: code });
    } catch {
      // A reply from a newer version: skip it.
    }
  }
  return out;
}

/** The link a family member opens to watch (the viewer picks the code up). */
export function watchLink(code: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}?viewer&watch=${encodeURIComponent(code)}`;
}
