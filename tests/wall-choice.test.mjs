import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseWall, fitOnWall, labelKind, screenDistance } from '../src/wall-choice.ts';

// Seated player at the origin, eyes 1.2 m up, looking down -Z.
const head = { x: 0, y: 1.2, z: 0 };
const ahead = { x: 0, y: 0, z: -1 };

/** A vertical rectangle `width` x `height` (bottom at y0), centred at (cx, cz), facing the yaw (degrees, 0 = toward +Z). */
function wall({ dist = 2, width = 4, height = 2.6, y0 = 0, yaw = 0, cx = 0, label = 'wall' } = {}) {
  const a = (yaw * Math.PI) / 180;
  const nx = Math.sin(a);
  const nz = Math.cos(a);
  const center = { x: cx, y: y0 + height / 2, z: -dist };
  const rx = nz;
  const rz = -nx;
  const corners = [
    [-1, 0],
    [1, 0],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => ({ x: center.x + (rx * u * width) / 2, y: y0 + v * height, z: center.z + (rz * u * width) / 2 }));
  return { orientation: 'vertical', label, point: center, normal: { x: nx, y: 0, z: nz }, corners };
}
function floor(y = 0, label = 'floor') {
  return {
    orientation: 'horizontal',
    label,
    point: { x: 0, y, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    corners: [
      { x: -2, y, z: -2 },
      { x: 2, y, z: -2 },
      { x: 2, y, z: 2 },
      { x: -2, y, z: 2 },
    ],
  };
}

test('labels: walls in any spelling, doors and windows are openings, the rest is not a wall', () => {
  for (const l of ['wall', 'WALL', 'wall face', 'WALL_FACE', 'wall-face']) assert.equal(labelKind(l), 'wall', l);
  for (const l of ['door', 'door frame', 'DOOR_FRAME', 'window', 'window frame', 'window_frame']) assert.equal(labelKind(l), 'opening', l);
  for (const l of ['invisible wall face', 'wall art', 'screen', 'other', 'table']) assert.equal(labelKind(l), 'other', l);
  assert.equal(labelKind(undefined), 'unlabelled');
  assert.equal(labelKind(''), 'unlabelled');
});

test('an ordinary wall ahead takes the stage, straight ahead, about 33 degrees wide', () => {
  const w = chooseWall(head, ahead, [wall({ dist: 2 })]);
  assert.ok(w);
  assert.ok(Math.abs(w.dist - 2) < 1e-9);
  assert.ok(Math.abs(w.shift) < 1e-9);
  assert.ok(Math.abs(w.width - 2 * 2 * Math.tan((16.5 * Math.PI) / 180)) < 1e-9);
  assert.ok(w.nz > 0.99); // normal points back at the player
});

test('no planes at all: no wall, and the paper screen stands 2 m away', () => {
  assert.equal(chooseWall(head, ahead, []), null);
  assert.equal(screenDistance(head, ahead, []), 2);
});

test('only a floor and ceiling: no wall', () => {
  assert.equal(chooseWall(head, ahead, [floor(0), floor(2.6, 'ceiling')]), null);
});

test('a wall nearer than 0.6 m is not used; the screen comes no nearer than 0.9 m', () => {
  const planes = [wall({ dist: 0.45 })];
  assert.equal(chooseWall(head, ahead, planes), null);
  assert.equal(screenDistance(head, ahead, planes), 0.9);
});

test('a wall farther than 4 m is not used; the screen stays at 2 m', () => {
  const planes = [wall({ dist: 5 })];
  assert.equal(chooseWall(head, ahead, planes), null);
  assert.equal(screenDistance(head, ahead, planes), 2);
});

test('a wall 1.5 m ahead that cannot be used (a window) brings the screen in front of it', () => {
  const planes = [wall({ dist: 1.5, label: 'window frame' })];
  assert.equal(chooseWall(head, ahead, planes), null);
  assert.ok(Math.abs(screenDistance(head, ahead, planes) - 1.35) < 1e-9);
});

test('walls at a steep angle are refused beyond 40 degrees, used below', () => {
  assert.ok(chooseWall(head, ahead, [wall({ yaw: 30 })]));
  assert.equal(chooseWall(head, ahead, [wall({ yaw: 55 })]), null);
  assert.equal(chooseWall(head, ahead, [wall({ yaw: 89 })]), null);
});

test('a window just right of straight ahead: the stage slides left of it', () => {
  const planes = [wall({ dist: 2, width: 5 }), wall({ dist: 1.98, width: 0.4, height: 1.2, y0: 0.9, cx: 0.5, label: 'window frame' })];
  const w = chooseWall(head, ahead, planes);
  assert.ok(w);
  // Right edge left of the window (which starts 0.3 m right of centre), centre within 20 degrees.
  assert.ok(w.shift + w.width / 2 <= 0.3 - 0.05 + 1e-9, `shift ${w.shift} width ${w.width}`);
  assert.ok(Math.abs(w.shift) <= 2 * Math.tan((20 * Math.PI) / 180) + 1e-9);
});

test('a narrow window straight ahead: sliding off it would turn the stage 20+ degrees, so the paper screen', () => {
  const planes = [wall({ dist: 2, width: 5 }), wall({ dist: 1.98, width: 0.5, height: 1.2, y0: 0.9, label: 'window frame' })];
  assert.equal(chooseWall(head, ahead, planes), null);
});

test('a wide window straight ahead: no turning far aside for the story, the paper screen stands in front of it', () => {
  const planes = [wall({ dist: 2, width: 5 }), wall({ dist: 1.98, width: 1.2, height: 1.2, y0: 0.9, label: 'window frame' })];
  assert.equal(chooseWall(head, ahead, planes), null);
  assert.ok(Math.abs(screenDistance(head, ahead, planes) - 1.83) < 1e-9);
});

test('a door filling the wall ahead: that wall is refused (paper screen instead)', () => {
  const planes = [wall({ dist: 2, width: 1.6 }), wall({ dist: 2, width: 1.0, height: 2.1, label: 'door frame' })];
  assert.equal(chooseWall(head, ahead, planes), null);
});

test('a window high above the stage band does not move the stage', () => {
  const planes = [wall({ dist: 2 }), wall({ dist: 2, width: 1, height: 0.4, y0: 2.2, label: 'window' })];
  const w = chooseWall(head, ahead, planes);
  assert.ok(w);
  assert.ok(Math.abs(w.shift) < 1e-9);
});

test('a labelled wall wins over an unlabelled plane at the same distance', () => {
  const unlabelled = wall({ dist: 2, label: '' });
  const labelled = wall({ dist: 2.05 });
  const w = chooseWall(head, ahead, [unlabelled, labelled]);
  assert.ok(Math.abs(w.dist - 2.05) < 1e-9);
});

test('an unexpected vertical label still holds the stage (open-plan rooms: invisible wall faces)', () => {
  for (const label of ['invisible wall face', 'INVISIBLE_WALL_FACE', 'wall art', 'other', 'something new']) {
    const w = chooseWall(head, ahead, [wall({ label })]);
    assert.ok(w, label);
    assert.ok(Math.abs(w.dist - 2) < 1e-9, label);
  }
});

test('a real wall wins over an unexpected label at the same spot (a TV or picture on the wall)', () => {
  const tv = wall({ dist: 1.95, width: 1.4, height: 0.8, y0: 0.9, label: 'screen' });
  const w = chooseWall(head, ahead, [tv, wall({ dist: 2 })]);
  assert.ok(Math.abs(w.dist - 2) < 1e-9);
});

test('an unlabelled plane wins over an unexpected label at equal footing', () => {
  const w = chooseWall(head, ahead, [wall({ dist: 2, label: 'storage' }), wall({ dist: 2.02, label: '' })]);
  assert.ok(Math.abs(w.dist - 2.02) < 1e-9);
});

test('horizontal surfaces are never walls, whatever their label', () => {
  for (const label of ['table', 'desk', 'wall', '']) assert.equal(chooseWall(head, ahead, [floor(0.75, label)]), null, label);
});

test('a wall off to the side (not straight ahead) is not used', () => {
  assert.equal(chooseWall(head, ahead, [wall({ width: 1, cx: 2 })]), null);
});

test('fitOnWall without openings keeps the original rule', () => {
  // Wide wall: full width, straight ahead.
  assert.deepEqual(fitOnWall(-2, 2, 1.2, []), { width: 1.2, shift: 0 });
  // Narrow wall: 90% of it, slid just far enough to stay on it.
  const r = fitOnWall(-0.1, 0.5, 1.2, []);
  assert.ok(Math.abs(r.width - 0.54) < 1e-9 && Math.abs(r.shift - 0.17) < 1e-9, JSON.stringify(r));
});

test('fitOnWall picks the clear span nearest straight ahead and refuses when nothing fits', () => {
  const r = fitOnWall(-3, 3, 1, [[-0.5, 0.2]]);
  assert.ok(r.shift > 0 && r.shift - 0.5 >= 0.2);
  assert.equal(fitOnWall(-0.5, 0.5, 1, [[-0.4, 0.4]]), null);
  // Too far to the side: refused.
  assert.equal(fitOnWall(-3, 3, 1, [[-2.5, 2.5]], 0.6), null);
});

// ---- The desk under the lamp and the journal.
import { findDesk } from '../src/wall-choice.ts';

/** A horizontal rectangle at height y, spanning x0..x1, z0..z1. */
function surface(y, label, x0 = -0.8, x1 = 0.8, z0 = -0.7, z1 = 0.1) {
  const corners = [
    { x: x0, y, z: z0 },
    { x: x1, y, z: z0 },
    { x: x1, y, z: z1 },
    { x: x0, y, z: z1 },
  ];
  return { orientation: 'horizontal', label, point: { x: (x0 + x1) / 2, y, z: (z0 + z1) / 2 }, normal: { x: 0, y: 1, z: 0 }, corners };
}
// Lamp 30 cm ahead and 16 cm right; journal 28 cm ahead and 20 cm left (eyes at 1.2 m, looking down -Z).
const spots = [
  { x: 0.16, y: 0, z: -0.3 },
  { x: -0.2, y: 0, z: -0.28 },
];

test('desk: a table under the lamp and journal is used, at its real height', () => {
  assert.equal(findDesk(head, [surface(0.72, 'table')], spots), 0.72);
  assert.equal(findDesk(head, [surface(0.8, '')], spots), 0.8);
});

test('desk: the floor, a ceiling, or a surface far too low or high is not a desk', () => {
  assert.equal(findDesk(head, [surface(0, 'floor')], spots), null);
  assert.equal(findDesk(head, [surface(0.2, 'other')], spots), null); // 1 m below the eyes: a coffee table across the room
  assert.equal(findDesk(head, [surface(1.15, 'shelf')], spots), null); // at eye height
});

test('desk: a surface that does not reach the lamp and journal is not used', () => {
  // A side table off to the right only.
  assert.equal(findDesk(head, [surface(0.72, 'table', 0.6, 1.2)], spots), null);
});

test('desk: a labelled desk wins over an unlabelled shelf nearer the usual height', () => {
  assert.equal(findDesk(head, [surface(0.75, ''), surface(0.66, 'desk')], spots), 0.66);
});

test('desk: a spot just past the edge (within 10 cm) still counts', () => {
  assert.equal(findDesk(head, [surface(0.72, 'table', -0.8, 0.8, -0.7, -0.33)], spots), 0.72);
});
