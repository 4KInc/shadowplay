import {
  AddEquation,
  CustomBlending,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  PlaneGeometry,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
  ZeroFactor,
} from '@iwsdk/core';

/**
 * Chapter Four and Five scenery. Built in stage units (x in stage widths,
 * y in stage heights, rooted on the stage floor at y = 0); the scenery system
 * scales the group to the stage.
 */
export interface ScenerySet {
  group: Group;
  update(time: number, level: number, finale: number): void;
  dispose(): void;
}

function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function glow(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
}

// ---------------------------------------------------------------- storm

const DROPS = 70;

/** Slanting rain streaks and heavy clouds rolling across the top of the stage. */
export function buildStorm(ink: MeshBasicMaterial): ScenerySet {
  const group = new Group();
  group.name = 'scenery-storm';
  const rand = makeRandom(71);

  const rainMat = new MeshBasicMaterial({ color: 0x0a0810, transparent: true, opacity: 0, depthWrite: false });
  const dropGeo = new PlaneGeometry(0.004, 0.07);
  const rain = new InstancedMesh(dropGeo, rainMat, DROPS);
  rain.name = 'scenery-storm-rain';
  rain.renderOrder = 4;
  rain.frustumCulled = false;
  const seeds = Array.from({ length: DROPS }, () => ({ x: rand() * 1.2 - 0.6, y: rand(), speed: 0.9 + rand() * 0.5 }));
  group.add(rain);

  const cloudShapes: Shape[] = [];
  // Two rows of uneven billows: a flat underside with lumpy tops.
  for (let i = 0; i < 16; i++) {
    const c = new Shape();
    const row = i % 2;
    const x = -0.6 + (i / 15) * 1.2 + (rand() - 0.5) * 0.05;
    const r = 0.05 + rand() * 0.06 + row * 0.02;
    c.absellipse(x, 0.9 + row * 0.05 + rand() * 0.04, r * 1.3, r, 0, Math.PI * 2, false, 0);
    cloudShapes.push(c);
  }
  const cloudGeo = new ShapeGeometry(cloudShapes, 12);
  const clouds = new Mesh(cloudGeo, ink);
  clouds.name = 'scenery-storm-clouds';
  clouds.renderOrder = 3;
  group.add(clouds);

  const m = new Matrix4();
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.35);
  const p = new Vector3();
  const s = new Vector3(1, 1, 1);
  return {
    group,
    update(time, level) {
      rainMat.opacity = 0.55 * level;
      for (let i = 0; i < DROPS; i++) {
        const d = seeds[i];
        const y = 1 - ((d.y + time * d.speed) % 1);
        const x = ((d.x + 0.6 - (1 - y) * 0.3) % 1.2 + 1.2) % 1.2 - 0.6;
        m.compose(p.set(x, y * 0.95, 0), q, s);
        rain.setMatrixAt(i, m);
      }
      rain.instanceMatrix.needsUpdate = true;
      clouds.position.x = Math.sin(time * 0.15) * 0.04;
    },
    dispose() {
      rainMat.dispose();
      dropGeo.dispose();
      cloudGeo.dispose();
    },
  };
}

// ---------------------------------------------------------------- sea + lighthouse

function lighthouseShape(): Shape {
  const s = new Shape();
  const x = 0.36;
  s.moveTo(x - 0.075, 0);
  s.lineTo(x - 0.045, 0.62);
  s.lineTo(x - 0.07, 0.62); // gallery
  s.lineTo(x - 0.07, 0.65);
  s.lineTo(x - 0.035, 0.65);
  s.lineTo(x - 0.035, 0.76); // lamp room
  s.lineTo(x - 0.045, 0.76);
  s.lineTo(x, 0.84); // roof
  s.lineTo(x + 0.045, 0.76);
  s.lineTo(x + 0.035, 0.76);
  s.lineTo(x + 0.035, 0.65);
  s.lineTo(x + 0.07, 0.65);
  s.lineTo(x + 0.07, 0.62);
  s.lineTo(x + 0.045, 0.62);
  s.lineTo(x + 0.075, 0);
  s.closePath();
  return s;
}

function seaWaves(): Shape {
  const s = new Shape();
  s.moveTo(-0.62, 0);
  for (let x = -0.62; x <= 0.62 + 1e-6; x += 0.02) s.lineTo(x, 0.07 + Math.sin(x * 34) * 0.018);
  s.lineTo(0.62, 0);
  s.closePath();
  return s;
}

function beamShape(): Shape {
  const s = new Shape();
  s.moveTo(0, 0);
  s.lineTo(-1.1, 0.12);
  s.lineTo(-1.1, -0.12);
  s.closePath();
  return s;
}

/** The lighthouse on its rock by the sea; its lamp room and beam wake in the finale. */
export function buildSea(ink: MeshBasicMaterial): ScenerySet {
  const group = new Group();
  group.name = 'scenery-sea';
  const towerGeo = new ShapeGeometry(lighthouseShape(), 1);
  const tower = new Mesh(towerGeo, ink);
  tower.name = 'scenery-sea-lighthouse';
  tower.renderOrder = 3;
  const waveGeo = new ShapeGeometry(seaWaves(), 1);
  const waves = new Mesh(waveGeo, ink);
  waves.name = 'scenery-sea-waves';
  waves.renderOrder = 4;

  const windowMat = glow(0xffc46a);
  const windowGeo = new PlaneGeometry(0.05, 0.09);
  const lampRoom = new Mesh(windowGeo, windowMat);
  lampRoom.name = 'scenery-sea-lamp-room';
  lampRoom.position.set(0.36, 0.705, 0.001);
  lampRoom.renderOrder = 5;

  const beamMat = glow(0xffd48a);
  const beamGeo = new ShapeGeometry(beamShape(), 1);
  const beam = new Mesh(beamGeo, beamMat);
  beam.name = 'scenery-sea-beam';
  beam.position.set(0.36, 0.71, 0.0005);
  beam.renderOrder = 2;

  group.add(beam, tower, waves, lampRoom);
  return {
    group,
    update(time, level, finale) {
      waves.position.x = Math.sin(time * 0.6) * 0.015;
      const lit = level * finale;
      windowMat.color.setHex(0xffc46a).multiplyScalar(0.08 * level + 0.9 * lit);
      beamMat.color.setHex(0xffd48a).multiplyScalar(0.35 * lit);
      beam.rotation.z = Math.sin(time * 0.5) * 0.35;
      beam.visible = lit > 0.01;
    },
    dispose() {
      towerGeo.dispose();
      waveGeo.dispose();
      windowGeo.dispose();
      windowMat.dispose();
      beamGeo.dispose();
      beamMat.dispose();
    },
  };
}
