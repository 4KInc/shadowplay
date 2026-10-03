import { Vector3 } from '@iwsdk/core';
import { JOINT_COUNT } from './stage-runtime.js';

/**
 * Map MediaPipe hand landmarks (21 points) onto the 25 WebXR hand joints.
 * WebXR adds a metacarpal joint at the base of each finger, which MediaPipe
 * does not track; those are synthesised a quarter of the way from the wrist to
 * the knuckle. Pure, so it can be checked without a camera.
 */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** WebXR joint -> MediaPipe landmark, or [wrist, knuckle] for a synthesised metacarpal. */
const MAP: readonly (number | readonly [number, number])[] = [
  0, // wrist
  1, 2, 3, 4, // thumb: CMC, MCP, IP, tip
  [0, 5], 5, 6, 7, 8, // index
  [0, 9], 9, 10, 11, 12, // middle
  [0, 13], 13, 14, 15, 16, // ring
  [0, 17], 17, 18, 19, 20, // pinky
];

/**
 * The webcam faces the player from the wall's side, so its image axes map to
 * the stage: image +x -> -stage right, image +y (down) -> -up, depth (+z, away
 * from the camera) -> +normal (towards the player).
 */
export function landmarksToJoints(
  world: readonly Landmark[],
  wrist: Vector3,
  right: Vector3,
  up: Vector3,
  normal: Vector3,
  out: Float32Array,
): Float32Array {
  const w = world[0];
  for (let i = 0; i < JOINT_COUNT; i++) {
    const m = MAP[i];
    let x: number;
    let y: number;
    let z: number;
    if (typeof m === 'number') {
      x = world[m].x - w.x;
      y = world[m].y - w.y;
      z = world[m].z - w.z;
    } else {
      const k = world[m[1]];
      x = (k.x - w.x) * 0.25;
      y = (k.y - w.y) * 0.25;
      z = (k.z - w.z) * 0.25;
    }
    out[i * 3] = wrist.x - right.x * x - up.x * y + normal.x * z;
    out[i * 3 + 1] = wrist.y - right.y * x - up.y * y + normal.y * z;
    out[i * 3 + 2] = wrist.z - right.z * x - up.z * y + normal.z * z;
  }
  return out;
}
