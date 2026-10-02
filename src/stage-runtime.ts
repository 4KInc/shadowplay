import { Vector3 } from '@iwsdk/core';

/**
 * Per-frame shared stage geometry, written by StageSetupSystem and read by the
 * recognizer and puppet systems. Allocated once; never reassigned.
 */
export const stageRuntime = {
  ready: false,
  /** Stage center on the wall/screen surface, world space. */
  center: new Vector3(),
  /** Unit normal pointing from the surface toward the player. */
  normal: new Vector3(0, 0, 1),
  right: new Vector3(1, 0, 0),
  up: new Vector3(0, 1, 0),
  width: 1.2,
  height: 0.75,
  /** Lamp bulb world position (the shadow projection origin). */
  bulb: new Vector3(),
  /** Centre of the lamp's light pool on the stage (moves as the lamp is dragged). */
  poolCenter: new Vector3(),
  lampOn: true,
};

export const JOINT_COUNT = 25;

/** Render layers that isolate each hand's shadow casters for silhouette matching. */
export const SILHOUETTE_LAYER = { left: 2, right: 3 } as const;

export interface HandSample {
  tracked: boolean;
  /** 25 WebXR joints x (x, y, z), world space. */
  joints: Float32Array;
  radii: Float32Array;
  /** Set by the puppet system while a character replaces this hand's shadow. */
  hideCasters: boolean;
  /** Joint-angle features for this frame (written by the shape matcher). */
  features: Float32Array;
  /** Best silhouette template match at or above threshold ('' if none). */
  silhouetteShape: string;
  silhouetteOverlap: number;
  /** performance.now() of the readback that produced the match. */
  silhouetteAt: number;
  /** Raw opinions for the recognition lab: best template of each method, even below threshold. */
  jointBest: string;
  jointScore: number;
  /** Joint method's shape after the tolerance threshold ('' if none). */
  jointShape: string;
  silhouetteBest: string;
  silhouetteBestOverlap: number;
}

function makeHand(): HandSample {
  return {
    tracked: false,
    joints: new Float32Array(JOINT_COUNT * 3),
    radii: new Float32Array(JOINT_COUNT),
    hideCasters: false,
    features: new Float32Array(9),
    silhouetteShape: '',
    silhouetteOverlap: 0,
    silhouetteAt: 0,
    jointBest: '',
    jointScore: 0,
    jointShape: '',
    silhouetteBest: '',
    silhouetteBestOverlap: 0,
  };
}

/** Written by HandCasterSystem each XR frame. */
export const handRuntime = {
  left: makeHand(),
  right: makeHand(),
  /** The session has controllers but no hand input (hands-first guard). */
  controllersOnly: false,
};

/**
 * Project a world point from the lamp bulb onto the stage plane.
 * Returns the magnification (lamp->surface / lamp->point), or 0 when the point
 * is not between the lamp and the surface.
 */
export function projectToStage(point: Vector3, out: Vector3): number {
  const b = stageRuntime.bulb;
  const n = stageRuntime.normal;
  const dx = point.x - b.x;
  const dy = point.y - b.y;
  const dz = point.z - b.z;
  const denom = dx * n.x + dy * n.y + dz * n.z;
  if (denom > -1e-5) return 0;
  const c = stageRuntime.center;
  const t = ((c.x - b.x) * n.x + (c.y - b.y) * n.y + (c.z - b.z) * n.z) / denom;
  if (t < 1) return 0;
  out.set(b.x + dx * t, b.y + dy * t, b.z + dz * t);
  return t;
}

/** True when a projected point falls on the lit stage area (with margin). */
export function isOnStage(p: Vector3, margin = 0.15): boolean {
  const c = stageRuntime.center;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const dz = p.z - c.z;
  const u = dx * stageRuntime.right.x + dy * stageRuntime.right.y + dz * stageRuntime.right.z;
  const v = dx * stageRuntime.up.x + dy * stageRuntime.up.y + dz * stageRuntime.up.z;
  const hw = stageRuntime.width * (0.5 + margin);
  const hh = stageRuntime.height * (0.5 + margin);
  return Math.abs(u) <= hw && Math.abs(v) <= hh;
}
