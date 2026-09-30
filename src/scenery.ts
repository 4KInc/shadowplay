import {
  createSystem,
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
} from '@iwsdk/core';
import { Scenery, ScenerySets } from './shadowplay-components.js';
import { stageRuntime } from './stage-runtime.js';

/** Deterministic PRNG so the field looks the same every time. */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Tall grass: blades in stage units (x in stage widths, y in stage heights),
 * rooted on y = 0 (the bottom edge of the stage).
 */
function grassClump(seed: number, x0: number, x1: number, count: number): ShapeGeometry {
  const rand = makeRandom(seed);
  const shapes: Shape[] = [];
  for (let i = 0; i < count; i++) {
    const x = x0 + ((x1 - x0) * (i + rand() * 0.8)) / count;
    const h = 0.22 + rand() * 0.3;
    const w = 0.008 + rand() * 0.008;
    const lean = (rand() - 0.5) * 0.09;
    const s = new Shape();
    s.moveTo(x - w, 0);
    s.quadraticCurveTo(x - w * 0.6, h * 0.55, x + lean, h);
    s.quadraticCurveTo(x + w * 0.4, h * 0.5, x + w, 0);
    s.closePath();
    shapes.push(s);
    if (rand() > 0.72) {
      // Seed head.
      const head = new Shape();
      head.absellipse(x + lean, h + 0.02, w * 1.4, 0.03, 0, Math.PI * 2, false, lean * 4);
      shapes.push(head);
    }
  }
  return new ShapeGeometry(shapes, 6);
}

/** Wave strip: a sine-topped band, wider than the stage so it can scroll. */
function waveStrip(amplitude: number, height: number, period: number): ShapeGeometry {
  const s = new Shape();
  const x0 = -0.62;
  const x1 = 0.62;
  s.moveTo(x0, 0);
  for (let x = x0; x <= x1 + 1e-6; x += period / 8) {
    s.lineTo(x, height + Math.sin((x / period) * Math.PI * 2) * amplitude);
  }
  s.lineTo(x1, 0);
  s.closePath();
  return new ShapeGeometry(s, 1);
}

/** Layered pine: stacked triangles on a short trunk, rooted at y = 0. */
function pines(seed: number, xs: number[]): ShapeGeometry {
  const rand = makeRandom(seed);
  const shapes: Shape[] = [];
  for (const x of xs) {
    const h = 0.55 + rand() * 0.35;
    const w = 0.07 + rand() * 0.04;
    const trunk = new Shape();
    trunk.moveTo(x - 0.008, 0);
    trunk.lineTo(x - 0.008, h * 0.2);
    trunk.lineTo(x + 0.008, h * 0.2);
    trunk.lineTo(x + 0.008, 0);
    trunk.closePath();
    shapes.push(trunk);
    for (let i = 0; i < 4; i++) {
      const base = h * (0.15 + i * 0.2);
      const half = w * (1 - i * 0.18);
      const tier = new Shape();
      tier.moveTo(x - half, base);
      tier.lineTo(x, base + h * 0.32);
      tier.lineTo(x + half, base);
      tier.closePath();
      shapes.push(tier);
    }
  }
  return new ShapeGeometry(shapes, 1);
}

interface SceneryRuntime {
  root: Group;
  field: Group;
  clumps: Mesh[];
  material: MeshBasicMaterial;
  level: number;
  river: Group;
  waves: Mesh[];
  moon: Mesh;
  moonMaterial: MeshBasicMaterial;
  riverLevel: number;
  forest: Group;
  forestLevel: number;
  geometries: ShapeGeometry[];
}

/** Background silhouette sets (currently the Chapter One field), faded in by the story. */
export class ScenerySystem extends createSystem({
  scenery: { required: [Scenery] },
}) {
  private runtimes = new Map<Entity, SceneryRuntime>();
  private quat = new Quaternion();
  private yAxis = new Vector3(0, 1, 0);
  private time = 0;

  init(): void {
    this.cleanupFuncs.push(
      this.queries.scenery.subscribe('disqualify', (entity) => {
        const rt = this.runtimes.get(entity);
        if (!rt) return;
        rt.root.removeFromParent();
        rt.geometries.forEach((g) => g.dispose());
        rt.material.dispose();
        rt.moonMaterial.dispose();
        this.runtimes.delete(entity);
      }),
    );
  }

  private runtimeFor(entity: Entity): SceneryRuntime | undefined {
    const existing = this.runtimes.get(entity);
    if (existing || !entity.object3D) return existing;
    const material = new MeshBasicMaterial({ color: 0x0a0810, transparent: true, opacity: 0 });
    const field = new Group();
    field.name = 'scenery-field';
    const clumps = [
      grassClump(11, -0.58, -0.2, 14),
      grassClump(23, -0.22, 0.2, 13),
      grassClump(37, 0.18, 0.58, 14),
    ].map((geo, i) => {
      const mesh = new Mesh(geo, material);
      mesh.name = `scenery-field-grass-${i}`;
      mesh.renderOrder = 4;
      field.add(mesh);
      return mesh;
    });
    const geometries = clumps.map((c) => c.geometry as ShapeGeometry);

    const river = new Group();
    river.name = 'scenery-river';
    const waves = [waveStrip(0.02, 0.1, 0.16), waveStrip(0.025, 0.06, 0.22)].map((geo, i) => {
      geometries.push(geo);
      const m = new Mesh(geo, material);
      m.name = `scenery-river-wave-${i}`;
      m.renderOrder = 4;
      m.position.z = i * 0.001;
      river.add(m);
      return m;
    });
    const moonShape = new Shape();
    moonShape.absarc(0, 0, 0.07, 0, Math.PI * 2, false);
    const moonGeo = new ShapeGeometry(moonShape, 32);
    geometries.push(moonGeo);
    const moonMaterial = new MeshBasicMaterial({ color: 0xbcd3ff, transparent: true, opacity: 0, depthWrite: false });
    const moon = new Mesh(moonGeo, moonMaterial);
    moon.name = 'scenery-river-moon';
    moon.renderOrder = 3;
    moon.position.set(0.34, 0.8, -0.001);
    river.add(moon);

    const forest = new Group();
    forest.name = 'scenery-forest';
    const treeGeo = pines(53, [-0.56, -0.47, -0.4, 0.48, 0.56]);
    geometries.push(treeGeo);
    const trees = new Mesh(treeGeo, material);
    trees.name = 'scenery-forest-pines';
    trees.renderOrder = 3;
    forest.add(trees);

    const root = new Group();
    root.name = 'scenery';
    root.add(field, river, forest);
    entity.object3D.add(root);
    const rt = {
      root, field, clumps, material, level: 0,
      river, waves, moon, moonMaterial, riverLevel: 0,
      forest, forestLevel: 0, geometries,
    };
    this.runtimes.set(entity, rt);
    return rt;
  }

  update(delta: number): void {
    this.time += delta;
    for (const entity of this.queries.scenery.entities) {
      const rt = this.runtimeFor(entity);
      const obj = entity.object3D;
      if (!rt || !obj) continue;
      obj.visible = stageRuntime.ready;
      if (!stageRuntime.ready) continue;

      const set = entity.getValue(Scenery, 'set');
      const fade = (level: number, on: boolean) =>
        level + Math.sign((on ? 1 : 0) - level) * Math.min(Math.abs((on ? 1 : 0) - level), delta * 0.6);
      rt.level = fade(rt.level, set === ScenerySets.Field);
      rt.riverLevel = fade(rt.riverLevel, set === ScenerySets.River);
      rt.forestLevel = fade(rt.forestLevel, set === ScenerySets.Forest);
      // One shared ink material: sets cross-fade through each other's level.
      rt.material.opacity = 0.9 * Math.max(rt.level, rt.riverLevel, rt.forestLevel);
      rt.field.visible = rt.level > 0.001;
      rt.river.visible = rt.riverLevel > 0.001;
      rt.forest.visible = rt.forestLevel > 0.001;
      rt.root.visible = rt.field.visible || rt.river.visible || rt.forest.visible;
      rt.moonMaterial.opacity = 0.5 * rt.riverLevel;

      const n = stageRuntime.normal;
      obj.quaternion.copy(this.quat.setFromAxisAngle(this.yAxis, Math.atan2(n.x, n.z)));
      obj.position
        .copy(stageRuntime.center)
        .addScaledVector(stageRuntime.up, -stageRuntime.height * 0.5)
        .addScaledVector(n, 0.006);
      // Grass grows up from the stage floor as it fades in.
      rt.field.scale.set(stageRuntime.width, stageRuntime.height * (0.4 + 0.6 * rt.level), 1);
      rt.clumps.forEach((clump, i) => {
        clump.rotation.z = Math.sin(this.time * 0.8 + i * 1.7) * 0.025;
      });
      rt.river.scale.set(stageRuntime.width, stageRuntime.height, 1);
      rt.forest.scale.set(stageRuntime.width, stageRuntime.height * (0.6 + 0.4 * rt.forestLevel), 1);
      rt.waves[0].position.x = ((this.time * 0.03) % 0.16) - 0.08;
      rt.waves[1].position.x = -(((this.time * 0.02) % 0.22) - 0.11);
      // Keep the moon round despite the stage's non-uniform scale.
      rt.moon.scale.set(1, stageRuntime.width / stageRuntime.height, 1);
    }
  }
}
