import { Vector3 } from '@iwsdk/core';
import type { RoomPlane } from './wall-choice.js';

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
  /** Adaptive quality level (Stage.quality), for visuals outside the stage system. */
  quality: 0,
  /** The headset's answer to our 72 Hz request: '' (not asked yet), 'granted', 'refused', 'unsupported'. */
  frameRateRequest: '',
  /** Distance from the eyes to the stage, metres. */
  distance: 2,
  /** The headset's horizontal field of view in degrees (0 until measured in XR). */
  fovH: 0,
  /** Where the lamp and journal stand: on the real desk Room Setup found ('surface'), or at the usual height ('estimate'). */
  desk: 'estimate' as 'estimate' | 'surface',
  /** The stage's room anchor (stage-anchor.ts AnchorState), for diagnostics and tests. */
  anchor: '' as string,
  /** The stage went back to the wall remembered from last session. */
  anchorFromLastTime: false,
  /** Times the anchor moved the stage back onto its wall this session, and the largest move (cm). */
  anchorFixes: 0,
  anchorMaxFixCm: 0,
  /** A creature just woke: the lamp light swells (1) and settles back (0) over about a second. */
  wakeFlare: 0,
  /**
   * Automation only (emulator tests): when set, stage placement sees these
   * planes instead of the headset's detected planes.
   */
  testPlanes: null as RoomPlane[] | null,
  /** Automation only: behave as a browser without WebXR anchors. */
  testNoAnchors: false,
};

/** Hand tracking flickering during a shape request (story.ts): show the light hint. */
export const trackingRuntime = { lightHint: false };

/** Accessibility modes that several systems draw differently (written by SettingsSystem). */
export const accessRuntime = {
  highContrast: false,
  /** Look to press: head-gaze dwell presses buttons and stands in for shapes. */
  gazeDwell: false,
  /** Look to press: the centre of the view is on the stage right now. */
  gazeOnStage: false,
};

/**
 * Everything "Look to press" can press, by name: panel buttons register here
 * (with the same handler a pinch runs). Written by the panel systems.
 */
export const gazeTargets = new Map<string, { object: import('@iwsdk/core').Object3D; press: () => void }>();

/** The headset panel's last button presses (ids, newest last), for the hands-only test. */
export const uiPresses: string[] = [];

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
 * Test hand sources (synthetic pose fixtures, the webcam bridge). While
 * `active`, the hand caster uses these world-space joints instead of WebXR
 * hand input; a side set to null counts as untracked. Works outside XR too.
 */
export const handOverride: {
  active: boolean;
  source: string;
  left: Float32Array | null;
  right: Float32Array | null;
  radii: Float32Array;
  cameraAllowed: boolean;
  cameraTarget: 'override' | 'second';
  xrToSecond: boolean;
} = {
  active: false,
  source: '',
  left: null,
  right: null,
  radii: new Float32Array(JOINT_COUNT).fill(0.009),
  /** False while a replay drives the hands; the camera may take over only during join-in moments. */
  cameraAllowed: true,
  /** Where camera hands go: the performing pair, or the second pair (a Live guest while the host performs). */
  cameraTarget: 'override',
  /** While the override performs (a Live guest's turn), this headset's own hands still cast, as the second pair. */
  xrToSecond: false,
};

/**
 * A second pair of hands on this stage, in world space: the other person in a
 * Live room (or, for a Live guest, their own camera hands while the host
 * performs). They cast shadows only: they do not occlude and do not drive this
 * stage's recognition. Null means not shown.
 */
export const secondHands: { left: Float32Array | null; right: Float32Array | null } = {
  left: null,
  right: null,
};

/** This headset's own hands while they cast as the second pair (handOverride.xrToSecond); written by the caster. */
export const xrSecond: { left: Float32Array | null; right: Float32Array | null } = {
  left: null,
  right: null,
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
