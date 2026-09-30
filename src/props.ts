import {
  createSystem,
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  Path,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
} from '@iwsdk/core';
import { HiddenProp } from './shadowplay-components.js';
import { stageRuntime } from './stage-runtime.js';

/** Fully revealed within this distance of the light pool centre (stage widths)... */
const REVEAL_NEAR = 0.2;
/** ...and invisible beyond this. */
const REVEAL_FAR = 0.42;

/** Old tree trunk with a hollow big enough for a moth; rooted at y = 0, ~1 unit tall. */
function hollowTree(): ShapeGeometry {
  const s = new Shape();
  s.moveTo(-0.3, 0);
  s.bezierCurveTo(-0.2, 0.05, -0.16, 0.2, -0.17, 0.5);
  s.bezierCurveTo(-0.18, 0.7, -0.3, 0.82, -0.36, 0.95);
  s.lineTo(-0.3, 0.97);
  s.bezierCurveTo(-0.2, 0.86, -0.1, 0.84, -0.06, 0.9);
  s.lineTo(0.02, 1.0);
  s.bezierCurveTo(0.06, 0.88, 0.16, 0.86, 0.3, 0.94);
  s.lineTo(0.33, 0.9);
  s.bezierCurveTo(0.2, 0.78, 0.15, 0.7, 0.15, 0.5);
  s.bezierCurveTo(0.14, 0.2, 0.2, 0.06, 0.3, 0);
  s.closePath();
  const hollow = new Path();
  hollow.absellipse(-0.01, 0.42, 0.075, 0.12, 0, Math.PI * 2, true, 0);
  s.holes.push(hollow);
  return new ShapeGeometry(s, 16);
}

interface PropRuntime {
  root: Group;
  material: MeshBasicMaterial;
  geometry: ShapeGeometry;
}

/**
 * Hidden props live in the dark: they only appear where the lamp's light pool
 * falls, so the player finds them by sliding the lamp along the desk.
 */
export class HiddenPropSystem extends createSystem({
  props: { required: [HiddenProp] },
}) {
  private runtimes = new Map<Entity, PropRuntime>();
  private pos = new Vector3();
  private quat = new Quaternion();
  private yAxis = new Vector3(0, 1, 0);

  init(): void {
    this.cleanupFuncs.push(
      this.queries.props.subscribe('disqualify', (entity) => {
        const rt = this.runtimes.get(entity);
        if (!rt) return;
        rt.root.removeFromParent();
        rt.material.dispose();
        rt.geometry.dispose();
        this.runtimes.delete(entity);
      }),
    );
  }

  private runtimeFor(entity: Entity): PropRuntime | undefined {
    const existing = this.runtimes.get(entity);
    if (existing || !entity.object3D) return existing;
    const material = new MeshBasicMaterial({ color: 0x0a0810, transparent: true, opacity: 0 });
    const geometry = hollowTree();
    const mesh = new Mesh(geometry, material);
    mesh.name = 'hidden-prop-hollow-tree';
    mesh.renderOrder = 4;
    const root = new Group();
    root.name = 'hidden-prop';
    root.add(mesh);
    entity.object3D.add(root);
    const rt = { root, material, geometry };
    this.runtimes.set(entity, rt);
    return rt;
  }

  update(delta: number): void {
    for (const entity of this.queries.props.entities) {
      const rt = this.runtimeFor(entity);
      const obj = entity.object3D;
      if (!rt || !obj) continue;
      obj.visible = stageRuntime.ready;
      if (!stageRuntime.ready) continue;

      const u = entity.getValue(HiddenProp, 'u') ?? 0;
      this.pos
        .copy(stageRuntime.center)
        .addScaledVector(stageRuntime.right, u * stageRuntime.width)
        .addScaledVector(stageRuntime.up, -0.5 * stageRuntime.height);
      const n = stageRuntime.normal;
      obj.quaternion.copy(this.quat.setFromAxisAngle(this.yAxis, Math.atan2(n.x, n.z)));
      obj.position.copy(this.pos).addScaledVector(n, 0.007);
      // Stands on the stage floor, a little over half the stage tall.
      const h = stageRuntime.height * 0.62;
      rt.root.scale.set(h, h, 1);

      // Reveal by the light pool's horizontal distance from the prop.
      const du = Math.abs(
        ((stageRuntime.poolCenter.x - this.pos.x) * stageRuntime.right.x +
          (stageRuntime.poolCenter.z - this.pos.z) * stageRuntime.right.z) /
          stageRuntime.width,
      );
      const t = Math.min(1, Math.max(0, (REVEAL_FAR - du) / (REVEAL_FAR - REVEAL_NEAR)));
      const lit = entity.getValue(HiddenProp, 'active') && stageRuntime.lampOn ? t * t * (3 - 2 * t) : 0;
      const current = entity.getValue(HiddenProp, 'revealed') ?? 0;
      const next = current + (lit - current) * Math.min(1, delta * 6);
      entity.setValue(HiddenProp, 'revealed', next);
      rt.material.opacity = 0.9 * next;
      rt.root.visible = next > 0.002;
    }
  }
}
