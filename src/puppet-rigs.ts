import { Group, Material, Mesh, Shape, ShapeGeometry } from '@iwsdk/core';
import { ShapeIds } from './shadowplay-components.js';
import { buildRabbit } from './silhouettes.js';

/**
 * Puppet silhouettes share one contract: ~1 unit long, facing +X, centred on
 * the origin, drawn in the stage plane. Parts behind the body sit slightly
 * back in Z so overlapping translucent fills don't double-darken.
 */
export interface PuppetRig {
  root: Group;
  eye: Mesh;
  /** Where Mo sits when riding, in rig units. */
  seat: { x: number; y: number };
  /** Per-frame animation; features are the matched hand's (may be null). */
  animate(time: number, delta: number, features: Float32Array | null): void;
}

function mesh(geometry: ShapeGeometry, material: Material, name: string, order: number, z = 0): Mesh {
  const m = new Mesh(geometry, material);
  m.name = name;
  m.renderOrder = order;
  m.position.z = z;
  return m;
}

function pivot(name: string, x: number, y: number, z: number, child: Mesh): Group {
  const g = new Group();
  g.name = name;
  g.position.set(x, y, z);
  g.add(child);
  return g;
}

function circle(r: number): Shape {
  const s = new Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  return s;
}

const eyeGeo = new ShapeGeometry(circle(0.026), 16);

function eyeAt(material: Material, x: number, y: number): Mesh {
  const e = mesh(eyeGeo, material, 'eye', 12, 0.001);
  e.position.x = x;
  e.position.y = y;
  return e;
}

// ---------------------------------------------------------------- fish

function fishBody(): Shape {
  const s = new Shape();
  s.moveTo(0.5, 0);
  s.bezierCurveTo(0.45, 0.2, 0.1, 0.26, -0.15, 0.18);
  s.bezierCurveTo(-0.28, 0.12, -0.32, 0.05, -0.34, 0);
  s.bezierCurveTo(-0.32, -0.05, -0.28, -0.12, -0.15, -0.16);
  s.bezierCurveTo(0.1, -0.24, 0.45, -0.18, 0.5, 0);
  return s;
}
function fishTail(): Shape {
  const s = new Shape();
  s.moveTo(0.02, 0);
  s.bezierCurveTo(-0.08, 0.08, -0.16, 0.2, -0.22, 0.25);
  s.bezierCurveTo(-0.15, 0.1, -0.15, -0.1, -0.22, -0.25);
  s.bezierCurveTo(-0.16, -0.2, -0.08, -0.08, 0.02, 0);
  return s;
}
function fishFin(): Shape {
  const s = new Shape();
  s.moveTo(-0.08, 0.19);
  s.quadraticCurveTo(0.02, 0.38, 0.2, 0.22);
  s.lineTo(0.12, 0.2);
  s.closePath();
  return s;
}
const fishGeo = {
  body: new ShapeGeometry(fishBody(), 18),
  tail: new ShapeGeometry(fishTail(), 12),
  fin: new ShapeGeometry(fishFin(), 10),
};

function buildFish(fill: Material, eyeMat: Material): PuppetRig {
  const root = new Group();
  root.name = 'fish';
  const tail = pivot('fish-tail', -0.32, 0, -0.0015, mesh(fishGeo.tail, fill, 'fish-tail-fin', 6));
  const eye = eyeAt(eyeMat, 0.32, 0.06);
  root.add(mesh(fishGeo.body, fill, 'fish-body', 5), tail, mesh(fishGeo.fin, fill, 'fish-fin', 6, -0.0015), eye);
  return {
    root,
    eye,
    seat: { x: -0.02, y: 0.26 },
    animate(time) {
      tail.rotation.z = Math.sin(time * 6) * 0.35;
    },
  };
}

// ---------------------------------------------------------------- dog

function dogHead(): Shape {
  const s = new Shape();
  s.moveTo(-0.4, -0.3);
  s.bezierCurveTo(-0.45, 0.0, -0.35, 0.28, -0.1, 0.3);
  s.bezierCurveTo(0.05, 0.32, 0.15, 0.22, 0.25, 0.16);
  s.bezierCurveTo(0.35, 0.12, 0.5, 0.1, 0.55, 0.05);
  s.bezierCurveTo(0.58, 0.02, 0.56, -0.03, 0.5, -0.04);
  s.lineTo(0.1, -0.04);
  s.bezierCurveTo(0.0, -0.1, -0.1, -0.3, -0.2, -0.35);
  s.lineTo(-0.4, -0.3);
  return s;
}
function dogJaw(): Shape {
  const s = new Shape();
  s.moveTo(-0.04, 0.02);
  s.lineTo(0.38, 0.0);
  s.bezierCurveTo(0.4, -0.04, 0.36, -0.08, 0.3, -0.09);
  s.bezierCurveTo(0.15, -0.1, 0.02, -0.1, -0.06, -0.06);
  s.closePath();
  return s;
}
function dogEar(): Shape {
  const s = new Shape();
  s.moveTo(-0.07, -0.02);
  s.bezierCurveTo(-0.07, 0.12, -0.02, 0.22, 0.02, 0.27);
  s.bezierCurveTo(0.06, 0.18, 0.07, 0.08, 0.06, -0.02);
  s.closePath();
  return s;
}
const dogGeo = {
  head: new ShapeGeometry(dogHead(), 16),
  jaw: new ShapeGeometry(dogJaw(), 10),
  ear: new ShapeGeometry(dogEar(), 10),
};

function buildDog(fill: Material, eyeMat: Material): PuppetRig {
  const root = new Group();
  root.name = 'dog';
  const jaw = pivot('dog-jaw', 0.1, -0.04, -0.0015, mesh(dogGeo.jaw, fill, 'dog-jaw-mesh', 6));
  const ear = pivot('dog-ear', -0.12, 0.26, -0.0015, mesh(dogGeo.ear, fill, 'dog-ear-mesh', 6));
  const eye = eyeAt(eyeMat, 0.12, 0.14);
  root.add(mesh(dogGeo.head, fill, 'dog-head', 5), jaw, ear, eye);
  return {
    root,
    eye,
    seat: { x: -0.18, y: 0.34 },
    animate(time, _delta, f) {
      // Thumb is the ear, the dropped pinky is the jaw.
      ear.rotation.z = f ? 0.15 + f[0] * 0.9 : 0.2;
      jaw.rotation.z = f ? -f[4] * 0.5 : -Math.max(0, Math.sin(time * 3)) * 0.2;
    },
  };
}

// ---------------------------------------------------------------- bird

function birdBody(): Shape {
  const s = new Shape();
  s.moveTo(0.3, 0.05);
  s.bezierCurveTo(0.3, 0.14, 0.18, 0.16, 0.14, 0.1);
  s.bezierCurveTo(0.05, 0.05, -0.2, 0.08, -0.35, 0.02);
  s.lineTo(-0.52, 0.08);
  s.lineTo(-0.5, -0.04);
  s.lineTo(-0.3, -0.04);
  s.bezierCurveTo(-0.1, -0.14, 0.15, -0.1, 0.25, -0.02);
  s.lineTo(0.3, 0.05);
  return s;
}
function birdBeak(): Shape {
  const s = new Shape();
  s.moveTo(0.28, 0.09);
  s.lineTo(0.42, 0.055);
  s.lineTo(0.28, 0.025);
  s.closePath();
  return s;
}
function birdWing(): Shape {
  const s = new Shape();
  s.moveTo(0.04, 0);
  s.bezierCurveTo(-0.02, 0.2, -0.2, 0.42, -0.42, 0.5);
  s.bezierCurveTo(-0.3, 0.3, -0.24, 0.12, -0.2, 0);
  s.closePath();
  return s;
}
const birdGeo = {
  body: new ShapeGeometry(birdBody(), 14),
  beak: new ShapeGeometry(birdBeak(), 4),
  wing: new ShapeGeometry(birdWing(), 12),
};

function buildBird(fill: Material, eyeMat: Material): PuppetRig {
  const root = new Group();
  root.name = 'bird';
  const far = pivot('bird-wing-far', 0.02, 0.06, -0.003, mesh(birdGeo.wing, fill, 'bird-wing-far-mesh', 4));
  const near = pivot('bird-wing-near', 0.0, 0.05, 0.0015, mesh(birdGeo.wing, fill, 'bird-wing-near-mesh', 7));
  const eye = eyeAt(eyeMat, 0.22, 0.1);
  root.add(far, mesh(birdGeo.body, fill, 'bird-body', 5), mesh(birdGeo.beak, fill, 'bird-beak', 6, -0.0015), near, eye);
  let phase = 0;
  return {
    root,
    eye,
    seat: { x: -0.08, y: 0.16 },
    animate(_time, delta) {
      phase += delta * 7;
      near.scale.y = Math.cos(phase);
      far.scale.y = Math.cos(phase - 0.5) * 0.85;
    },
  };
}

// ---------------------------------------------------------------- rabbit

function rabbitRig(fill: Material, eyeMat: Material): PuppetRig {
  const r = buildRabbit(fill, eyeMat);
  return {
    root: r.root,
    eye: r.eye,
    seat: { x: -0.1, y: 0.21 },
    animate(_time, _delta, f) {
      // Ears follow the index/middle fingers: curl them to fold the ears.
      r.earFront.rotation.z = f ? 0.15 + f[1] * 1.4 : 0.25;
      r.earBack.rotation.z = f ? 0.3 + f[2] * 1.4 : 0.25;
    },
  };
}

export function buildPuppetRig(shape: string, fill: Material, eyeMat: Material): PuppetRig {
  switch (shape) {
    case ShapeIds.Fish:
      return buildFish(fill, eyeMat);
    case ShapeIds.Dog:
      return buildDog(fill, eyeMat);
    case ShapeIds.Bird:
      return buildBird(fill, eyeMat);
    default:
      return rabbitRig(fill, eyeMat);
  }
}

// ---------------------------------------------------------------- wolf (actor)

function wolfBody(): Shape {
  const s = new Shape();
  s.moveTo(-0.5, 0.05);
  s.bezierCurveTo(-0.52, 0.2, -0.4, 0.3, -0.2, 0.3);
  s.bezierCurveTo(0.0, 0.32, 0.15, 0.34, 0.25, 0.38);
  s.bezierCurveTo(0.3, 0.46, 0.36, 0.5, 0.41, 0.5);
  s.lineTo(0.42, 0.62);
  s.lineTo(0.47, 0.51);
  s.lineTo(0.51, 0.6);
  s.lineTo(0.53, 0.48);
  s.bezierCurveTo(0.58, 0.45, 0.66, 0.42, 0.73, 0.38);
  s.lineTo(0.73, 0.34);
  s.lineTo(0.55, 0.33);
  s.bezierCurveTo(0.48, 0.26, 0.4, 0.2, 0.36, 0.12);
  s.lineTo(0.37, -0.3);
  s.lineTo(0.3, -0.3);
  s.lineTo(0.28, -0.02);
  s.bezierCurveTo(0.15, -0.06, -0.1, -0.06, -0.28, -0.02);
  s.lineTo(-0.3, -0.3);
  s.lineTo(-0.38, -0.3);
  s.lineTo(-0.44, -0.04);
  s.lineTo(-0.5, 0.05);
  return s;
}
function wolfTail(): Shape {
  const s = new Shape();
  s.moveTo(0.02, 0.03);
  s.bezierCurveTo(-0.15, 0.05, -0.28, -0.05, -0.34, -0.18);
  s.bezierCurveTo(-0.22, -0.12, -0.1, -0.06, 0.02, -0.03);
  s.closePath();
  return s;
}
function wolfJaw(): Shape {
  const s = new Shape();
  s.moveTo(-0.02, 0.01);
  s.lineTo(0.16, 0.01);
  s.bezierCurveTo(0.12, -0.04, 0.05, -0.06, -0.04, -0.04);
  s.closePath();
  return s;
}
const wolfGeo = {
  body: new ShapeGeometry(wolfBody(), 14),
  tail: new ShapeGeometry(wolfTail(), 12),
  jaw: new ShapeGeometry(wolfJaw(), 8),
};

export interface WolfRig {
  root: Group;
  tail: Group;
  jaw: Group;
  eye: Mesh;
}

/** The shadow wolf: ~1.25 units long, facing +X, feet at y = -0.3. */
export function buildWolf(fill: Material, eyeMat: Material): WolfRig {
  const root = new Group();
  root.name = 'wolf';
  const tail = pivot('wolf-tail', -0.49, 0.16, -0.0015, mesh(wolfGeo.tail, fill, 'wolf-tail-mesh', 6));
  const jaw = pivot('wolf-jaw', 0.55, 0.33, -0.0015, mesh(wolfGeo.jaw, fill, 'wolf-jaw-mesh', 6));
  const eye = eyeAt(eyeMat, 0.5, 0.44);
  eye.scale.setScalar(0.7);
  root.add(mesh(wolfGeo.body, fill, 'wolf-body', 5), tail, jaw, eye);
  return { root, tail, jaw, eye };
}
