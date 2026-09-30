import { Group, Material, Mesh, Shape, ShapeGeometry } from '@iwsdk/core';

/**
 * Flat silhouette characters drawn on the stage (the brief's "2D shape with a
 * few animated parts"). Built in the stage's local XY plane, facing +X, about
 * 1 unit wide and centred on the origin. Parts behind the body sit slightly
 * back in Z so overlapping translucent fills don't double-darken.
 */

export interface RabbitRig {
  root: Group;
  /** Pivot groups at the ear roots; rotate around Z to fold ears back. */
  earFront: Group;
  earBack: Group;
  eye: Mesh;
}

const OX = 0;
const OY = -0.3;

function rabbitBodyShape(): Shape {
  const s = new Shape();
  s.moveTo(-0.42 + OX, 0.04 + OY);
  s.bezierCurveTo(-0.56, 0.1 + OY, -0.56, 0.36 + OY, -0.38, 0.43 + OY); // rump
  s.bezierCurveTo(-0.2, 0.52 + OY, 0.04, 0.5 + OY, 0.15, 0.43 + OY); // back
  s.bezierCurveTo(0.2, 0.56 + OY, 0.32, 0.61 + OY, 0.42, 0.57 + OY); // crown
  s.bezierCurveTo(0.53, 0.53 + OY, 0.57, 0.45 + OY, 0.51, 0.39 + OY); // nose
  s.bezierCurveTo(0.46, 0.33 + OY, 0.37, 0.32 + OY, 0.31, 0.3 + OY); // chin
  s.bezierCurveTo(0.3, 0.2 + OY, 0.33, 0.08 + OY, 0.38, 0.02 + OY); // chest, foreleg
  s.lineTo(0.26, 0.0 + OY);
  s.bezierCurveTo(0.2, 0.08 + OY, 0.12, 0.12 + OY, 0.04, 0.1 + OY); // belly
  s.bezierCurveTo(-0.05, 0.03 + OY, -0.14, 0.0 + OY, -0.22, 0.0 + OY); // hind foot
  s.lineTo(-0.42 + OX, 0.0 + OY);
  s.closePath();
  return s;
}

function earShape(length: number): Shape {
  const s = new Shape();
  s.moveTo(-0.04, -0.02);
  s.bezierCurveTo(-0.075, length * 0.45, -0.045, length * 0.92, 0.0, length);
  s.bezierCurveTo(0.05, length * 0.92, 0.075, length * 0.45, 0.04, -0.02);
  s.closePath();
  return s;
}

function circle(r: number): Shape {
  const s = new Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  return s;
}

const bodyGeo = new ShapeGeometry(rabbitBodyShape(), 16);
const earFrontGeo = new ShapeGeometry(earShape(0.42), 12);
const earBackGeo = new ShapeGeometry(earShape(0.38), 12);
const tailGeo = new ShapeGeometry(circle(0.065), 20);
const eyeGeo = new ShapeGeometry(circle(0.024), 16);

export function buildRabbit(fill: Material, eyeMat: Material): RabbitRig {
  const root = new Group();
  root.name = 'rabbit';

  const body = new Mesh(bodyGeo, fill);
  body.name = 'rabbit-body';
  body.renderOrder = 5;

  const earFront = new Group();
  earFront.name = 'rabbit-ear-front';
  earFront.position.set(0.31, 0.53 + OY, -0.0015);
  const earFrontMesh = new Mesh(earFrontGeo, fill);
  earFrontMesh.renderOrder = 6;
  earFront.add(earFrontMesh);

  const earBack = new Group();
  earBack.name = 'rabbit-ear-back';
  earBack.position.set(0.25, 0.52 + OY, -0.003);
  const earBackMesh = new Mesh(earBackGeo, fill);
  earBackMesh.renderOrder = 6;
  earBack.add(earBackMesh);

  const tail = new Mesh(tailGeo, fill);
  tail.name = 'rabbit-tail';
  tail.position.set(-0.5, 0.3 + OY, -0.0015);
  tail.renderOrder = 6;

  const eye = new Mesh(eyeGeo, eyeMat);
  eye.name = 'rabbit-eye';
  eye.position.set(0.41, 0.47 + OY, 0.001);
  eye.renderOrder = 7;

  root.add(body, earFront, earBack, tail, eye);
  return { root, earFront, earBack, eye };
}

export interface MothRig {
  root: Group;
  /** Wing pivots at the body; scale.x folds the wing in the wall plane. */
  wingLeft: Group;
  wingRight: Group;
}

function mothWingShape(): Shape {
  // Right forewing + hindwing as one lobed outline, rooted at the body (0, 0).
  const s = new Shape();
  s.moveTo(0, 0.04);
  s.bezierCurveTo(0.12, 0.22, 0.42, 0.3, 0.5, 0.16);
  s.bezierCurveTo(0.54, 0.06, 0.4, 0.0, 0.26, -0.01);
  s.bezierCurveTo(0.36, -0.08, 0.36, -0.24, 0.2, -0.26);
  s.bezierCurveTo(0.08, -0.26, 0.02, -0.14, 0, -0.06);
  s.closePath();
  return s;
}

function mothBodyShape(): Shape {
  const s = new Shape();
  s.absellipse(0, -0.04, 0.045, 0.2, 0, Math.PI * 2, false, 0);
  return s;
}

function antennaShape(side: number): Shape {
  const s = new Shape();
  s.moveTo(0.008 * side, 0.14);
  s.quadraticCurveTo(0.05 * side, 0.26, 0.13 * side, 0.3);
  s.lineTo(0.125 * side, 0.315);
  s.quadraticCurveTo(0.035 * side, 0.27, -0.006 * side, 0.145);
  s.closePath();
  return s;
}

const mothWingGeo = new ShapeGeometry(mothWingShape(), 14);
const mothBodyGeo = new ShapeGeometry(mothBodyShape(), 16);
const antennaGeo = new ShapeGeometry([antennaShape(1), antennaShape(-1)], 6);

/** Mo, the moth: ~1 unit wingspan, centred on the body, facing up the wall. */
export function buildMoth(fill: Material): MothRig {
  const root = new Group();
  root.name = 'moth';
  const body = new Mesh(mothBodyGeo, fill);
  body.name = 'moth-body';
  body.renderOrder = 9;
  const antennae = new Mesh(antennaGeo, fill);
  antennae.name = 'moth-antennae';
  antennae.renderOrder = 9;

  const wingRight = new Group();
  wingRight.name = 'moth-wing-right';
  wingRight.position.z = -0.0015;
  const right = new Mesh(mothWingGeo, fill);
  right.renderOrder = 10;
  wingRight.add(right);

  const wingLeft = new Group();
  wingLeft.name = 'moth-wing-left';
  wingLeft.position.z = -0.0015;
  wingLeft.scale.x = -1;
  const left = new Mesh(mothWingGeo, fill);
  left.renderOrder = 10;
  wingLeft.add(left);

  root.add(body, antennae, wingRight, wingLeft);
  return { root, wingLeft, wingRight };
}
