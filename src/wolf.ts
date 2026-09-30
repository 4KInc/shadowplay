import { createSystem, Entity, MeshBasicMaterial, Quaternion, Vector3 } from '@iwsdk/core';
import { buildWolf, WolfRig } from './puppet-rigs.js';
import { ActorStates, StageActor } from './shadowplay-components.js';
import { stageRuntime } from './stage-runtime.js';

/** Wolf length as a fraction of stage width (rig is ~1.25 units long). */
const SCALE_PER_WIDTH = 0.36;
const FLEE_SPEED = 0.55;

interface ActorRuntime {
  rig: WolfRig;
  fill: MeshBasicMaterial;
  eyeMat: MeshBasicMaterial;
  u: number;
  level: number;
  lastState: string;
  growl: number;
}

/**
 * Story-driven shadow actors. The wolf blocks the path (breathing, tail
 * swaying, growling now and then), flees off-stage when scared, or dozes
 * with its eye shut while the player slips past.
 */
export class StageActorSystem extends createSystem({
  actors: { required: [StageActor] },
}) {
  private runtimes = new Map<Entity, ActorRuntime>();
  private quat = new Quaternion();
  private yAxis = new Vector3(0, 1, 0);
  private time = 0;

  init(): void {
    this.cleanupFuncs.push(
      this.queries.actors.subscribe('disqualify', (entity) => {
        const rt = this.runtimes.get(entity);
        if (!rt) return;
        rt.rig.root.removeFromParent();
        rt.fill.dispose();
        rt.eyeMat.dispose();
        this.runtimes.delete(entity);
      }),
    );
  }

  private runtimeFor(entity: Entity): ActorRuntime | undefined {
    const existing = this.runtimes.get(entity);
    if (existing || !entity.object3D) return existing;
    const fill = new MeshBasicMaterial({ color: 0x07060c, transparent: true, opacity: 0 });
    const eyeMat = new MeshBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0 });
    const rig = buildWolf(fill, eyeMat);
    entity.object3D.add(rig.root);
    const rt = { rig, fill, eyeMat, u: 0, level: 0, lastState: ActorStates.Hidden as string, growl: 3 };
    this.runtimes.set(entity, rt);
    return rt;
  }

  update(delta: number): void {
    this.time += delta;
    for (const entity of this.queries.actors.entities) {
      const rt = this.runtimeFor(entity);
      const obj = entity.object3D;
      if (!rt || !obj) continue;
      obj.visible = stageRuntime.ready;
      if (!stageRuntime.ready) continue;

      const state = entity.getValue(StageActor, 'state') ?? ActorStates.Hidden;
      const homeU = entity.getValue(StageActor, 'u') ?? 0.3;
      const v = entity.getValue(StageActor, 'v') ?? -0.26;
      if (state !== rt.lastState) {
        if (state === ActorStates.Blocking && rt.lastState === ActorStates.Hidden) rt.u = homeU;
        rt.lastState = state;
      }

      const t = this.time;
      let target = 1;
      let bob = 0;
      let breathe = 1 + 0.012 * Math.sin(t * 1.8);
      rt.rig.eye.scale.y = 0.7;
      switch (state) {
        case ActorStates.Hidden:
          target = 0;
          break;
        case ActorStates.Blocking:
          rt.u += (homeU - rt.u) * Math.min(1, delta * 2);
          rt.rig.tail.rotation.z = Math.sin(t * 1.3) * 0.12;
          rt.growl -= delta;
          if (rt.growl < 0) rt.growl = 3.5;
          rt.rig.jaw.rotation.z = rt.growl < 0.8 ? -Math.abs(Math.sin(rt.growl * 12)) * 0.35 : 0;
          break;
        case ActorStates.Fleeing:
          rt.u += delta * FLEE_SPEED;
          bob = Math.abs(Math.sin(t * 14)) * 0.04;
          rt.rig.tail.rotation.z = -0.5; // tail tucked
          rt.rig.jaw.rotation.z = 0;
          if (rt.u > 0.75) target = 0;
          if (rt.u > 0.95) entity.setValue(StageActor, 'state', ActorStates.Hidden);
          break;
        case ActorStates.Dozing:
          breathe = 1 + 0.02 * Math.sin(t * 0.9);
          rt.rig.eye.scale.y = 0.08;
          rt.rig.jaw.rotation.z = 0;
          rt.rig.tail.rotation.z = 0.25;
          break;
      }
      rt.level += Math.sign(target - rt.level) * Math.min(Math.abs(target - rt.level), delta * 1.2);
      rt.fill.opacity = 0.94 * rt.level;
      rt.eyeMat.opacity = rt.level;
      rt.rig.root.visible = rt.level > 0.001;

      const size = stageRuntime.width * SCALE_PER_WIDTH;
      const n = stageRuntime.normal;
      obj.quaternion.copy(this.quat.setFromAxisAngle(this.yAxis, Math.atan2(n.x, n.z)));
      obj.position
        .copy(stageRuntime.center)
        .addScaledVector(stageRuntime.right, rt.u * stageRuntime.width)
        .addScaledVector(stageRuntime.up, v * stageRuntime.height + bob * size)
        .addScaledVector(n, 0.008);
      // Faces left (toward the travellers) while blocking, right while fleeing.
      const facing = state === ActorStates.Fleeing ? 1 : -1;
      rt.rig.root.scale.set(size * facing, size * breathe, size);
    }
  }
}
