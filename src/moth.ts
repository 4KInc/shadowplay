import { createSystem, Entity, MeshBasicMaterial, Quaternion, Vector3 } from '@iwsdk/core';
import { buildMoth, MothRig } from './silhouettes.js';
import { Moth, MothModes, PuppetStates, ShadowPuppet } from './shadowplay-components.js';
import { handRuntime, isOnStage, projectToStage, stageRuntime } from './stage-runtime.js';

const INDEX_TIP = 9;
/** Moth wingspan as a fraction of stage width. */
const SIZE = 0.075;

interface MothRuntime {
  rig: MothRig;
  fill: MeshBasicMaterial;
  pos: Vector3;
  target: Vector3;
  mode: string;
  flap: number;
}

/**
 * Mo flies onto the stage, follows the shadow of the player's index fingertip,
 * rides on the rabbit's back, and rests where the story tells her to.
 */
export class MothSystem extends createSystem({
  moths: { required: [Moth] },
  puppets: { required: [ShadowPuppet] },
}) {
  private runtimes = new Map<Entity, MothRuntime>();
  private tip = new Vector3();
  private hit = new Vector3();
  private quat = new Quaternion();
  private yAxis = new Vector3(0, 1, 0);
  private time = 0;

  init(): void {
    this.cleanupFuncs.push(
      this.queries.moths.subscribe('disqualify', (entity) => {
        const rt = this.runtimes.get(entity);
        if (!rt) return;
        rt.rig.root.removeFromParent();
        rt.fill.dispose();
        this.runtimes.delete(entity);
      }),
    );
  }

  private runtimeFor(entity: Entity): MothRuntime | undefined {
    let rt = this.runtimes.get(entity);
    if (rt || !entity.object3D) return rt;
    const fill = new MeshBasicMaterial({ color: 0x0a0810, transparent: true, opacity: 0 });
    const rig = buildMoth(fill);
    entity.object3D.add(rig.root);
    rt = { rig, fill, pos: new Vector3(), target: new Vector3(), mode: MothModes.Hidden, flap: 0 };
    this.runtimes.set(entity, rt);
    return rt;
  }

  /** Stage-local (u, v) in fractions of width/height -> world point on the stage. */
  private stagePoint(u: number, v: number, out: Vector3): Vector3 {
    return out
      .copy(stageRuntime.center)
      .addScaledVector(stageRuntime.right, u * stageRuntime.width)
      .addScaledVector(stageRuntime.up, v * stageRuntime.height);
  }

  update(delta: number): void {
    this.time += delta;
    for (const entity of this.queries.moths.entities) {
      const rt = this.runtimeFor(entity);
      const obj = entity.object3D;
      if (!rt || !obj) continue;
      obj.visible = stageRuntime.ready;
      if (!stageRuntime.ready) continue;

      const mode = entity.getValue(Moth, 'mode') ?? MothModes.Hidden;
      if (mode !== rt.mode) {
        if (mode === MothModes.Arriving) this.stagePoint(-0.75, 0.65, rt.pos);
        rt.mode = mode;
      }
      const restU = entity.getValue(Moth, 'restU') ?? 0;
      const restV = entity.getValue(Moth, 'restV') ?? 0;
      let follow = 4;
      let flapRate = 16;
      let flutter = 1;
      let visible = 1;

      switch (mode) {
        case MothModes.Hidden:
          visible = 0;
          this.stagePoint(-0.75, 0.65, rt.target);
          break;
        case MothModes.Arriving:
          follow = 1.6;
          this.stagePoint(restU, restV, rt.target);
          if (rt.pos.distanceTo(rt.target) < stageRuntime.width * 0.02) {
            entity.setValue(Moth, 'mode', MothModes.Hovering);
          }
          break;
        case MothModes.Hovering:
          this.stagePoint(restU, restV, rt.target);
          break;
        case MothModes.Resting:
          follow = 2.5;
          flapRate = 2.5;
          flutter = 0.1;
          this.stagePoint(restU, restV, rt.target);
          break;
        case MothModes.Following:
          follow = 3.5;
          if (this.fingertipShadow()) {
            rt.target.copy(this.hit);
            const near = rt.pos.distanceTo(this.hit) < stageRuntime.width * 0.1;
            if (near) {
              const s = entity.getValue(Moth, 'followedSeconds') ?? 0;
              entity.setValue(Moth, 'followedSeconds', s + delta);
            }
          }
          break;
        case MothModes.Riding:
          follow = 14;
          flapRate = 3;
          flutter = 0.15;
          this.ridePoint(rt.target);
          break;
      }

      rt.pos.lerp(rt.target, Math.min(1, delta * follow));
      rt.fill.opacity += (visible * 0.92 - rt.fill.opacity) * Math.min(1, delta * 3);
      rt.flap += delta * flapRate;
      const fold = 0.35 + 0.65 * Math.abs(Math.cos(rt.flap));
      rt.rig.wingRight.scale.x = fold;
      rt.rig.wingLeft.scale.x = -fold;

      const size = stageRuntime.width * SIZE;
      const wobble = size * 0.35 * flutter;
      obj.position
        .copy(rt.pos)
        .addScaledVector(stageRuntime.right, Math.sin(this.time * 3.1) * wobble)
        .addScaledVector(stageRuntime.up, Math.sin(this.time * 4.7) * wobble * 0.7)
        .addScaledVector(stageRuntime.normal, 0.014);
      const n = stageRuntime.normal;
      obj.quaternion.copy(this.quat.setFromAxisAngle(this.yAxis, Math.atan2(n.x, n.z)));
      obj.scale.setScalar(size);
    }
  }

  /** Projected shadow of the first index fingertip that is in the light. */
  private fingertipShadow(): boolean {
    for (const hand of [handRuntime.right, handRuntime.left]) {
      if (!hand.tracked || !stageRuntime.lampOn) continue;
      this.tip.fromArray(hand.joints, INDEX_TIP * 3);
      if (projectToStage(this.tip, this.hit) > 0 && isOnStage(this.hit, 0)) return true;
    }
    return false;
  }

  /** A seat on the living puppet's back (or stay put if it is gone). */
  private ridePoint(out: Vector3): void {
    for (const puppet of this.queries.puppets.entities) {
      const obj = puppet.object3D;
      const rig = obj?.children[0];
      if (!obj || !rig || puppet.getValue(ShadowPuppet, 'state') !== PuppetStates.Alive) continue;
      const seat = (rig.userData.seat as { x: number; y: number } | undefined) ?? { x: 0, y: 0.2 };
      const s = rig.scale.y;
      const facing = Math.sign(rig.scale.x) || 1;
      out
        .copy(obj.position)
        .addScaledVector(stageRuntime.up, s * seat.y)
        .addScaledVector(stageRuntime.right, seat.x * s * facing);
      return;
    }
  }
}
