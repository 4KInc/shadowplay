/**
 * Choosing where the stage goes, as pure geometry (no Three.js, so the room
 * cases can be unit-tested and replayed in the emulator with fake planes).
 *
 * Coordinates are world metres, y up. A plane is described by a point on it,
 * its unit normal and its outline corners in world space.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface RoomPlane {
  orientation: 'vertical' | 'horizontal' | string;
  /** As the headset reports it (Quest uses words such as "wall", "door frame", "window frame"). */
  label?: string;
  point: V3;
  normal: V3;
  corners: V3[];
}

export interface WallChoice {
  /** Unit horizontal normal pointing back toward the player. */
  nx: number;
  nz: number;
  /** A point on the wall plane. */
  point: V3;
  /** Perpendicular distance from the eye to the wall. */
  dist: number;
  /** Stage width and its sideways offset from the point straight ahead (along the wall's right). */
  width: number;
  shift: number;
  /** Width of the wall's outline. */
  wallWidth: number;
}

export const MIN_WALL = 0.6;
export const MAX_WALL = 4;
/** Walls turned further than this from the view are not used. */
export const MAX_WALL_ANGLE = 40;
const FRONT_COS = Math.cos((MAX_WALL_ANGLE * Math.PI) / 180);
/** Stage subtends ~33 degrees: width = 2 * d * tan(16.5deg). */
export const WIDTH_PER_METER = 2 * Math.tan((16.5 * Math.PI) / 180);
/** How far outside a detected wall's outline the point straight ahead may fall. */
const WALL_MARGIN = 0.25;
/** Narrowest stage we will build on a small wall. */
export const MIN_STAGE_WIDTH = 0.35;
const MAX_STAGE_WIDTH = 1.5;
/** A door or window counts as part of a wall when it lies this close to its plane. */
const OPENING_DEPTH = 0.2;
/** The band of the wall the stage occupies, relative to eye height. */
const STAGE_BAND_LOW = -0.4;
const STAGE_BAND_HIGH = 0.75;
/**
 * Sliding the stage off a door or window: its centre no further than this from
 * straight ahead (a seated story is watched for minutes; a window right ahead
 * gets the paper screen in front of it instead).
 */
const MAX_SHIFT_TAN = Math.tan((20 * Math.PI) / 180);
export const SCREEN_DISTANCE = 2;
/** A paper screen never comes nearer than this (hands need room in front of it). */
export const SCREEN_MIN_DISTANCE = 0.9;

export type LabelKind = 'wall' | 'unlabelled' | 'opening' | 'other';

/** Score bonus for a plane labelled a wall, and the cost of an unexpected label (vs unlabelled, 0). */
const WALL_LABEL_BONUS = 0.1;
const OTHER_LABEL_PENALTY = 0.15;

/**
 * Walls are planes labelled "wall" (any spelling: "wall", "wall face", "WALL_FACE")
 * or not labelled at all. Doors and windows are openings to keep the stage off.
 * Any other label ("invisible wall face" in an open-plan room, "wall art", a TV
 * "screen") is 'other': a vertical one can still hold the stage, behind a real
 * wall at the same spot (OTHER_LABEL_PENALTY), so an unexpected label never sends
 * a room to the paper screen for nothing. Horizontal surfaces are never walls.
 */
export function labelKind(label: string | undefined): LabelKind {
  const l = (label ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!l) return 'unlabelled';
  if (l === 'wall' || l === 'wall face') return 'wall';
  if (/\b(door|window)/.test(l)) return 'opening';
  return 'other';
}

interface Measured {
  nx: number;
  nz: number;
  dist: number;
  facing: number;
  uMin: number;
  uMax: number;
}

/** Distance, facing and outline extent (relative to the point straight ahead) of one vertical plane. */
function measure(plane: RoomPlane, head: V3, fx: number, fz: number, out: Measured): boolean {
  if (plane.orientation !== 'vertical') return false;
  let nx = plane.normal.x;
  let nz = plane.normal.z;
  const len = Math.hypot(nx, nz);
  if (len < 1e-6) return false;
  nx /= len;
  nz /= len;
  let dist = (head.x - plane.point.x) * nx + (head.z - plane.point.z) * nz;
  if (dist < 0) {
    nx = -nx;
    nz = -nz;
    dist = -dist;
  }
  const facing = -(nx * fx + nz * fz);
  if (facing <= 0.05) return false;
  const along = dist / Math.max(0.2, facing);
  const ax = head.x + fx * along;
  const az = head.z + fz * along;
  // The wall's right, seen from the player.
  const rx = nz;
  const rz = -nx;
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const c of plane.corners) {
    const u = (c.x - ax) * rx + (c.z - az) * rz;
    const v = c.y - head.y;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  out.nx = nx;
  out.nz = nz;
  out.dist = dist;
  out.facing = facing;
  out.uMin = uMin;
  out.uMax = uMax;
  // Eye height must fall within (or near) the outline too.
  return vMin - 0.5 <= 0 && vMax + 0.5 >= 0;
}

/**
 * Where on [uMin, uMax] a stage of the desired width fits, keeping clear of the
 * blocked spans and as close to straight ahead (0) as possible. Without
 * openings this is the original rule: shrink to 90% of a narrow wall, slide to
 * stay on it. Returns null when no clear span is wide enough.
 */
export function fitOnWall(
  uMin: number,
  uMax: number,
  desired: number,
  blocked: ReadonlyArray<readonly [number, number]>,
  maxShift = Infinity,
): { width: number; shift: number } | null {
  const spans: Array<[number, number]> = [[uMin, uMax]];
  for (const [b0, b1] of blocked) {
    for (let i = spans.length - 1; i >= 0; i--) {
      const [s0, s1] = spans[i];
      if (b1 <= s0 || b0 >= s1) continue;
      const parts: Array<[number, number]> = [];
      if (b0 > s0) parts.push([s0, b0]);
      if (b1 < s1) parts.push([b1, s1]);
      spans.splice(i, 1, ...parts);
    }
  }
  if (!blocked.length) {
    const wallWidth = uMax - uMin;
    const width = Math.max(MIN_STAGE_WIDTH, Math.min(desired, wallWidth * 0.9));
    const half = width / 2;
    const shift = wallWidth <= width ? (uMin + uMax) / 2 : Math.min(uMax - half, Math.max(uMin + half, 0));
    return { width, shift };
  }
  let best: { width: number; shift: number } | null = null;
  for (const [s0, s1] of spans) {
    const len = s1 - s0;
    const width = Math.min(desired, len * 0.9);
    if (width < MIN_STAGE_WIDTH) continue;
    const half = width / 2;
    // Keep a little gap from the opening's edge when there is room for one.
    const gap = len - width > 0.1 ? 0.05 : 0;
    const lo = s0 + half + gap;
    const hi = s1 - half - gap;
    const shift = lo > hi ? (s0 + s1) / 2 : Math.min(hi, Math.max(lo, 0));
    if (Math.abs(shift) > maxShift) continue;
    if (!best || Math.abs(shift) < Math.abs(best.shift)) best = { width, shift };
  }
  return best;
}

const scratch: Measured = { nx: 0, nz: 0, dist: 0, facing: 0, uMin: 0, uMax: 0 };
const other: Measured = { nx: 0, nz: 0, dist: 0, facing: 0, uMin: 0, uMax: 0 };

/**
 * Pick the wall most directly in front of the player: vertical, not a door or
 * window (labelled walls first, then unlabelled planes, then other labels), 0.6-4 m away, turned less than 40 degrees from the view, with
 * the point straight ahead on its outline and room for the stage clear of any
 * door or window on it. Labelled walls win over unlabelled planes at equal footing.
 * `forward` is the horizontal view direction.
 */
export function chooseWall(head: V3, forward: V3, planes: readonly RoomPlane[]): WallChoice | null {
  const flen = Math.hypot(forward.x, forward.z) || 1;
  const fx = forward.x / flen;
  const fz = forward.z / flen;
  let best: WallChoice | null = null;
  let bestScore = -Infinity;
  for (const plane of planes) {
    const kind = labelKind(plane.label);
    if (kind === 'opening') continue;
    if (!measure(plane, head, fx, fz, scratch)) continue;
    const { nx, nz, dist, facing, uMin, uMax } = scratch;
    if (dist < MIN_WALL || dist > MAX_WALL || facing < FRONT_COS) continue;
    if (uMin - WALL_MARGIN > 0 || uMax + WALL_MARGIN < 0) continue;
    // Doors and windows lying on this wall, within the stage's band of height.
    const blocked: Array<[number, number]> = [];
    for (const o of planes) {
      if (o === plane || labelKind(o.label) !== 'opening') continue;
      if (!measure(o, head, fx, fz, other)) continue;
      if (Math.abs(other.dist - dist) > OPENING_DEPTH || other.nx * nx + other.nz * nz < 0.95) continue;
      let vMin = Infinity;
      let vMax = -Infinity;
      for (const c of o.corners) {
        vMin = Math.min(vMin, c.y - head.y);
        vMax = Math.max(vMax, c.y - head.y);
      }
      if (vMax < STAGE_BAND_LOW || vMin > STAGE_BAND_HIGH) continue;
      blocked.push([other.uMin, other.uMax]);
    }
    const desired = Math.min(MAX_STAGE_WIDTH, Math.max(0.45, dist * WIDTH_PER_METER));
    const fit = fitOnWall(uMin, uMax, desired, blocked, blocked.length ? Math.max(0.3, dist * MAX_SHIFT_TAN) : Infinity);
    if (!fit) continue;
    const label = kind === 'wall' ? WALL_LABEL_BONUS : kind === 'other' ? -OTHER_LABEL_PENALTY : 0;
    const score = facing - dist * 0.05 + label - Math.abs(fit.shift) * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = { nx, nz, point: { ...plane.point }, dist, width: fit.width, shift: fit.shift, wallWidth: uMax - uMin };
    }
  }
  return best;
}

/**
 * How far a floating paper screen should stand: 2 m, unless any vertical
 * surface straight ahead is nearer, in which case just in front of it (never
 * nearer than 0.9 m, so there is room for hands).
 */
export function screenDistance(head: V3, forward: V3, planes: readonly RoomPlane[]): number {
  const flen = Math.hypot(forward.x, forward.z) || 1;
  const fx = forward.x / flen;
  const fz = forward.z / flen;
  let nearest = Infinity;
  for (const plane of planes) {
    if (!measure(plane, head, fx, fz, scratch)) continue;
    if (scratch.uMin > 0 || scratch.uMax < 0) continue;
    const along = scratch.dist / Math.max(0.2, scratch.facing);
    if (along < nearest) nearest = along;
  }
  return Math.max(SCREEN_MIN_DISTANCE, Math.min(SCREEN_DISTANCE, nearest - 0.15));
}
