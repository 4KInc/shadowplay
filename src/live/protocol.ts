import type { TapEvent } from '../performance/story-tap.js';

/**
 * Live room wire protocol (relayed as-is by the server).
 *
 * Binary: a 2-byte header [kind, 0] then little-endian int16 payload.
 *   HANDS: one performance frame (FRAME_STRIDE values, stage-relative mm).
 *   VOICE: mono PCM16 at VOICE_RATE.
 * Text: JSON PeerMessage, or a server control message.
 */
export const KIND_HANDS = 1;
export const KIND_VOICE = 2;
export const HEADER_BYTES = 2;
export const VOICE_RATE = 16000;
/** Hands are sent this often (Hz); the receiver interpolates. */
export const HANDS_HZ = 20;

export type PeerMessage =
  | { type: 'hello'; name: string; script: string }
  /** Host -> guest: everything to start mid-story (snapshot, beat, lamp, staging, awake creatures). */
  | { type: 'state'; events: TapEvent[] }
  | { type: 'event'; event: TapEvent };

export type ServerMessage =
  | { type: 'room'; code: string }
  | { type: 'joined'; code: string }
  | { type: 'guest-joined' }
  | { type: 'guest-left' }
  | { type: 'ended'; reason: string }
  | { type: 'error'; error: string };

export function packBinary(kind: number, payload: Int16Array): ArrayBuffer {
  const out = new ArrayBuffer(HEADER_BYTES + payload.byteLength);
  new Uint8Array(out)[0] = kind;
  new Int16Array(out, HEADER_BYTES).set(payload);
  return out;
}

export function unpackBinary(data: ArrayBuffer): { kind: number; payload: Int16Array } | null {
  if (data.byteLength < HEADER_BYTES || (data.byteLength - HEADER_BYTES) % 2) return null;
  return { kind: new Uint8Array(data)[0], payload: new Int16Array(data, HEADER_BYTES) };
}
