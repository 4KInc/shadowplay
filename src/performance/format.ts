import { Vector3 } from '@iwsdk/core';
import { JOINT_COUNT, stageRuntime } from '../stage-runtime.js';

/**
 * Performance stream: everything needed to replay a shadow performance on any
 * stage (a wall in a headset, a phone screen). Hands are stored in the stage's
 * own frame (millimetres along stage right / up / normal from the stage
 * centre), so a replay fits whatever stage the viewer has.
 */
export const PERFORMANCE_VERSION = 'shadowplay.performance.v1';
export const FRAME_HZ = 30;
/** int16 values per frame: presence flags, then 25 joints x 3 for left and right. */
export const FRAME_STRIDE = 1 + JOINT_COUNT * 3 * 2;
const LEFT = 1;
const RIGHT = 2;

/** 'stage' carries animated staging values (lamp level, finale, Mo's glow) that the story animates itself. */
export type PerformanceEventType = 'snapshot' | 'beat' | 'wake' | 'release' | 'lamp' | 'stage';

export interface PerformanceEvent {
  /** Milliseconds from the start of the performance. */
  t: number;
  type: PerformanceEventType;
  data: Record<string, string | number | boolean>;
}

export interface Performance {
  version: typeof PERFORMANCE_VERSION;
  id: string;
  title: string;
  performer: string;
  /** Who the story is for (fills {child} in story lines on replay). */
  child?: string;
  /** The family code this story was sent with (or fetched by). */
  shareCode?: string;
  /** A goodnight back from the family: the code of the story it answers. */
  replyTo?: string;
  /** Bundled example (first launch), so someone alone can see what families share. */
  sample?: boolean;
  createdAt: number;
  durationMs: number;
  /** Story script the beats refer to. */
  script: string;
  /** A dreamed story's own script ('dreamed:<n>'), carried along so any device can tell it. */
  story?: unknown;
  frameHz: number;
  /** Base64 of an Int16Array, FRAME_STRIDE values per frame. */
  hands: string;
  frameCount: number;
  events: PerformanceEvent[];
  /** Voice, if recorded (stored as a Blob locally, a data URL in exports). */
  audio?: Blob | null;
  audioType?: string;
}

/** Write the current stage-relative hand positions into frame `index` of `buf`. */
export function writeFrame(
  buf: Int16Array,
  index: number,
  left: Float32Array | null,
  right: Float32Array | null,
): void {
  const o = index * FRAME_STRIDE;
  buf[o] = (left ? LEFT : 0) | (right ? RIGHT : 0);
  if (left) toStage(left, buf, o + 1);
  if (right) toStage(right, buf, o + 1 + JOINT_COUNT * 3);
}

const tmp = new Vector3();

function toStage(joints: Float32Array, buf: Int16Array, offset: number): void {
  const c = stageRuntime.center;
  const r = stageRuntime.right;
  const u = stageRuntime.up;
  const n = stageRuntime.normal;
  for (let i = 0; i < JOINT_COUNT; i++) {
    tmp.set(joints[i * 3] - c.x, joints[i * 3 + 1] - c.y, joints[i * 3 + 2] - c.z);
    buf[offset + i * 3] = Math.round(tmp.dot(r) * 1000);
    buf[offset + i * 3 + 1] = Math.round(tmp.dot(u) * 1000);
    buf[offset + i * 3 + 2] = Math.round(tmp.dot(n) * 1000);
  }
}

/**
 * Read frame position `f` (fractional: interpolated between frames) into world
 * joints on the viewer's current stage. Returns which hands are present.
 */
export function readFrame(
  buf: Int16Array,
  frameCount: number,
  f: number,
  left: Float32Array,
  right: Float32Array,
): { left: boolean; right: boolean } {
  const i0 = Math.max(0, Math.min(frameCount - 1, Math.floor(f)));
  const i1 = Math.min(frameCount - 1, i0 + 1);
  const a = Math.max(0, Math.min(1, f - i0));
  const flags0 = buf[i0 * FRAME_STRIDE];
  const flags1 = buf[i1 * FRAME_STRIDE];
  // Only interpolate when the hand exists in both frames.
  const hasL = (flags0 & LEFT) !== 0;
  const hasR = (flags0 & RIGHT) !== 0;
  if (hasL) fromStage(buf, i0, i1, (flags1 & LEFT) !== 0 ? a : 0, 1, left);
  if (hasR) fromStage(buf, i0, i1, (flags1 & RIGHT) !== 0 ? a : 0, 1 + JOINT_COUNT * 3, right);
  return { left: hasL, right: hasR };
}

function fromStage(buf: Int16Array, i0: number, i1: number, a: number, offset: number, out: Float32Array): void {
  const c = stageRuntime.center;
  const r = stageRuntime.right;
  const u = stageRuntime.up;
  const n = stageRuntime.normal;
  const o0 = i0 * FRAME_STRIDE + offset;
  const o1 = i1 * FRAME_STRIDE + offset;
  for (let i = 0; i < JOINT_COUNT * 3; i += 3) {
    const x = (buf[o0 + i] + (buf[o1 + i] - buf[o0 + i]) * a) / 1000;
    const y = (buf[o0 + i + 1] + (buf[o1 + i + 1] - buf[o0 + i + 1]) * a) / 1000;
    const z = (buf[o0 + i + 2] + (buf[o1 + i + 2] - buf[o0 + i + 2]) * a) / 1000;
    out[i] = c.x + r.x * x + u.x * y + n.x * z;
    out[i + 1] = c.y + r.y * x + u.y * y + n.y * z;
    out[i + 2] = c.z + r.z * x + u.z * y + n.z * z;
  }
}

/** Stage-relative point (mm) for small payloads such as the lamp position. */
export function pointToStage(p: Vector3): { x: number; y: number; z: number } {
  tmp.subVectors(p, stageRuntime.center);
  return {
    x: Math.round(tmp.dot(stageRuntime.right) * 1000),
    y: Math.round(tmp.dot(stageRuntime.up) * 1000),
    z: Math.round(tmp.dot(stageRuntime.normal) * 1000),
  };
}

export function pointFromStage(x: number, y: number, z: number, out: Vector3): Vector3 {
  return out
    .copy(stageRuntime.center)
    .addScaledVector(stageRuntime.right, x / 1000)
    .addScaledVector(stageRuntime.up, y / 1000)
    .addScaledVector(stageRuntime.normal, z / 1000);
}

export function encodeHands(buf: Int16Array): string {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function decodeHands(b64: string): Int16Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}
