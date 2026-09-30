import { createSystem, Entity, MeshBasicMaterial, Quaternion, Vector3 } from '@iwsdk/core';
import { computeFeatures, FEATURE_COUNT } from './hand-features.js';
import { buildPuppetRig, PuppetRig } from './puppet-rigs.js';
import { playChime } from './sfx.js';
import {
  Hands,
  PuppetStates,
  ShadowPuppet,
  ShapeIds,
  ShapeRecognizer,
} from './shadowplay-components.js';
import { handRuntime, HandSample, isOnStage, projectToStage, stageRuntime } from './stage-runtime.js';

const HAND_LENGTH = 0.18;
/** Characters read best a little smaller than the raw hand shadow. */
const CHARACTER_SCALE = 0.6;
/** Largest character, as a fraction of stage width. */
const MAX_SIZE = 0.95;
/** Two hands side by side cast a wider shadow than one. */
const TWO_HAND_SPAN = 1.35;
const RELEASE_LOST_SECONDS = 0.6;
/** An open hand must stay out of the light this long before it lets go. */
const RELEASE_OPEN_SECONDS = 0.25;
const RELEASE_DARK_SECONDS = 1.0;
const FADE_SECONDS = 0.8;
const INK = 0x0a0810;

interface PuppetRuntime {
  rig: PuppetRig;
  fill: MeshBasicMaterial;
  eyeMat: MeshBasicMaterial;
  pos: Vector3;
  scale: number;
  facing: number;
  lostFor: number;
  fade: number;
  alive: number;
  blinkIn: number;
  hop: number;
  lastState: string;
  twoHanded: boolean;
}

/**
 * Shows a requested character as a faint outline that fills in while the
 * shape is held; once matched, the character replaces the hand's shadow and
 * follows it (position from the lamp projection, size from lamp distance, parts
 * from finger pose). Opening the hand or leaving the light releases it.
 */
export class PuppetSystem extends createSystem({
  puppets: { required: [ShadowPuppet] },
  recognizers: { required: [ShapeRecognizer] },
}) {
  private runtimes = new Map<Entity, PuppetRuntime>();
  private features = new Float32Array(FEATURE_COUNT);
  private palm = new Vector3();
  private palm2 = new Vector3();
  private hit = new Vector3();
  private tmp = new Vector3();
  private quat = new Quaternion();
  private time = 0;

  init(): void {
    this.cleanupFuncs.push(
      this.queries.puppets.subscribe('disqualify', (entity) => {
        const rt = this.runtimes.get(entity);
        if (rt) {
          rt.rig.root.removeFromParent();
          rt.fill.dispose();
          rt.eyeMat.dispose();
          this.runtimes.delete(entity);
        }
      }),
    );
  }

  private runtimeFor(entity: Entity): PuppetRuntime | undefined {
    let rt = this.runtimes.get(entity);
    if (rt || !entity.object3D) return rt;
    const fill = new MeshBasicMaterial({ color: INK, transparent: true, opacity: 0 });
    const eyeMat = new MeshBasicMaterial({ color: 0xffb45a, transparent: true, opacity: 0 });
    const rig = buildPuppetRig(entity.getValue(ShadowPuppet, 'shape') ?? ShapeIds.Rabbit, fill, eyeMat);
    rig.root.userData.seat = rig.seat;
    entity.object3D.add(rig.root);
    rt = {
      rig, fill, eyeMat, pos: new Vector3(), scale: 0.3, facing: 1,
      lostFor: 0, fade: 0, alive: 0, blinkIn: 2.5, hop: 0,
      lastState: PuppetStates.Hidden, twoHanded: false,
    };
    this.runtimes.set(entity, rt);
    return rt;
  }

  update(delta: number): void {
    this.time += delta;
    const recognizer = this.queries.recognizers.entities.values().next().value as Entity | undefined;
    for (const entity of this.queries.puppets.entities) {
      const rt = this.runtimeFor(entity);
      const obj = entity.object3D;
      if (!rt || !obj) continue;
      obj.visible = stageRuntime.ready;
      if (!stageRuntime.ready) continue;
      obj.quaternion.copy(this.stageQuaternion());

      const state = entity.getValue(ShadowPuppet, 'state') ?? PuppetStates.Hidden;
      if (state !== rt.lastState) {
        // Entering Releasing from anywhere (e.g. the story's bow) starts the fade.
        if (state === PuppetStates.Releasing) rt.fade = Math.max(rt.fade, rt.fill.opacity / 0.92);
        if (state === PuppetStates.Alive) playChime();
        rt.lastState = state;
      }
      let features: Float32Array | null = null;
      if (state === PuppetStates.Outline) this.updateOutline(entity, rt, recognizer, delta);
      else if (state === PuppetStates.Alive) features = this.updateAlive(entity, rt, recognizer, delta);
      else if (state === PuppetStates.Releasing) this.updateReleasing(entity, rt, recognizer, delta);
      else {
        rt.fill.opacity = Math.max(0, rt.fill.opacity - delta * 1.5);
        rt.eyeMat.opacity = 0;
        // Free Stage: any discovered shape comes alive without a request.
        if (recognizer?.getValue(ShapeRecognizer, 'freeMode')) this.tryWake(entity, rt, recognizer);
      }
      rt.rig.animate(this.time, delta, features);

      obj.position.copy(rt.pos).addScaledVector(stageRuntime.normal, 0.01);
      rt.rig.root.scale.set(rt.scale * rt.facing, rt.scale, rt.scale);
      entity.setValue(ShadowPuppet, 'size', rt.scale / stageRuntime.width);
    }
  }

  private stageQuaternion(): Quaternion {
    const n = stageRuntime.normal;
    return this.quat.setFromAxisAngle(this.tmp.set(0, 1, 0), Math.atan2(n.x, n.z));
  }

  private updateOutline(entity: Entity, rt: PuppetRuntime, rec: Entity | undefined, delta: number): void {
    const u = entity.getValue(ShadowPuppet, 'outlineU') ?? 0;
    const v = entity.getValue(ShadowPuppet, 'outlineV') ?? 0;
    rt.pos
      .copy(stageRuntime.center)
      .addScaledVector(stageRuntime.right, u * stageRuntime.width)
      .addScaledVector(stageRuntime.up, v * stageRuntime.height);
    rt.scale = stageRuntime.height * 0.62;
    rt.facing = 1;
    const shape = entity.getValue(ShadowPuppet, 'shape');
    const hold = rec?.getValue(ShapeRecognizer, 'holdSeconds') ?? 0.5;
    const held = rec?.getValue(ShapeRecognizer, 'heldFor') ?? 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.2);
    // Only the outline being formed fills in.
    const forming = rec?.getValue(ShapeRecognizer, 'matchedShape') === shape || held > 0;
    const target = 0.14 + 0.08 * pulse + (forming ? 0.7 * Math.min(1, held / hold) : 0);
    rt.fill.opacity += (target - rt.fill.opacity) * Math.min(1, delta * 10);
    rt.eyeMat.opacity = 0;

    this.tryWake(entity, rt, rec);
  }

  /** Brings the puppet alive when the recognizer has matched its shape. */
  private tryWake(entity: Entity, rt: PuppetRuntime, rec: Entity | undefined): void {
    const shape = entity.getValue(ShadowPuppet, 'shape');
    const matched = rec?.getValue(ShapeRecognizer, 'matchedHand') ?? Hands.None;
    if (matched !== Hands.None && rec?.getValue(ShapeRecognizer, 'matchedShape') === shape) {
      rt.twoHanded = Boolean(rec.getValue(ShapeRecognizer, 'twoHanded'));
      entity.setValue(ShadowPuppet, 'state', PuppetStates.Alive);
      entity.setValue(ShadowPuppet, 'hand', matched);
      handRuntime[matched as 'left' | 'right'].hideCasters = true;
      if (rt.twoHanded) handRuntime.left.hideCasters = handRuntime.right.hideCasters = true;
      rt.lostFor = 0;
      rt.alive = 0;
      rt.pos.copy(stageRuntime.center);
    }
  }

  private palmOf(hand: HandSample, out: Vector3): Vector3 {
    const j = hand.joints;
    return out.set((j[0] + j[33]) * 0.5, (j[1] + j[34]) * 0.5, (j[2] + j[35]) * 0.5);
  }

  private updateAlive(entity: Entity, rt: PuppetRuntime, rec: Entity | undefined, delta: number): Float32Array | null {
    const side = entity.getValue(ShadowPuppet, 'hand') as 'left' | 'right';
    const hand = handRuntime[side];
    rt.alive = Math.min(1, rt.alive + delta * 3);
    rt.fill.opacity = 0.92 * Math.min(1, rt.alive * 1.5);
    rt.eyeMat.opacity = rt.fill.opacity;

    const shapeId = entity.getValue(ShadowPuppet, 'shape');
    if (shapeId === ShapeIds.Bird || shapeId === ShapeIds.Cup) {
      const two = Boolean(rec?.getValue(ShapeRecognizer, 'twoHanded'));
      if (two !== rt.twoHanded) {
        rt.twoHanded = two;
        const other = side === 'left' ? handRuntime.right : handRuntime.left;
        other.hideCasters = two;
      }
    }
    let onStage = false;
    let released = false;
    let features: Float32Array | null = null;
    if (hand?.tracked) {
      this.palmOf(hand, this.palm);
      const other = side === 'left' ? handRuntime.right : handRuntime.left;
      if (rt.twoHanded && other.tracked) this.palm.lerp(this.palmOf(other, this.palm2), 0.5);
      const t = projectToStage(this.palm, this.hit);
      onStage = t > 0 && isOnStage(this.hit, 0.3);
      const shape = rec?.getValue(ShapeRecognizer, side === 'left' ? 'leftShape' : 'rightShape');
      released = shape === ShapeIds.Open && !onStage && rt.lostFor + delta > RELEASE_OPEN_SECONDS;
      if (onStage) {
        const k = Math.min(1, delta * 12);
        const dx = this.hit.x - rt.pos.x;
        const dz = this.hit.z - rt.pos.z;
        const lateral = dx * stageRuntime.right.x + dz * stageRuntime.right.z;
        if (Math.abs(lateral) > 0.004) rt.facing = lateral > 0 ? 1 : -1;
        rt.hop += Math.min(1, Math.abs(lateral) * 40) * delta * 9;
        rt.pos.lerp(this.hit, k);
        const hopY = Math.abs(Math.sin(rt.hop)) * rt.scale * 0.12;
        rt.pos.addScaledVector(stageRuntime.up, hopY * k);
        const pop = 1 + 0.25 * Math.sin(Math.min(1, rt.alive) * Math.PI);
        const span = rt.twoHanded ? TWO_HAND_SPAN : 1;
        const target = Math.min(stageRuntime.width * MAX_SIZE, HAND_LENGTH * CHARACTER_SCALE * span * t * pop);
        rt.scale += (target - rt.scale) * k;
        computeFeatures(hand.joints, this.features);
        features = this.features;
      }
    }
    this.blink(rt, delta);

    rt.lostFor = onStage ? 0 : rt.lostFor + delta;
    const limit = hand?.tracked ? RELEASE_DARK_SECONDS : RELEASE_LOST_SECONDS;
    if (released || rt.lostFor > limit) {
      entity.setValue(ShadowPuppet, 'state', PuppetStates.Releasing);
      rt.fade = 1;
    }
    return features;
  }

  private updateReleasing(entity: Entity, rt: PuppetRuntime, rec: Entity | undefined, delta: number): void {
    rt.fade -= delta / FADE_SECONDS;
    rt.fill.opacity = rt.eyeMat.opacity = Math.max(0, rt.fade) * 0.92;
    rt.pos.addScaledVector(stageRuntime.up, delta * 0.05); // bow and drift
    if (rt.fade > 0) return;
    const side = entity.getValue(ShadowPuppet, 'hand') as 'left' | 'right' | 'none';
    if (side !== 'none') handRuntime[side].hideCasters = false;
    if (rt.twoHanded) handRuntime.left.hideCasters = handRuntime.right.hideCasters = false;
    rt.twoHanded = false;
    entity.setValue(ShadowPuppet, 'hand', Hands.None);
    // Still requested (hand slipped out mid-scene): show the outline again.
    const shape = entity.getValue(ShadowPuppet, 'shape');
    const requested =
      rec?.getValue(ShapeRecognizer, 'target') === shape || rec?.getValue(ShapeRecognizer, 'target2') === shape;
    entity.setValue(ShadowPuppet, 'state', requested ? PuppetStates.Outline : PuppetStates.Hidden);
    rec?.setValue(ShapeRecognizer, 'matchedHand', Hands.None);
    rec?.setValue(ShapeRecognizer, 'matchedShape', ShapeIds.None);
    rec?.setValue(ShapeRecognizer, 'twoHanded', false);
    rec?.setValue(ShapeRecognizer, 'heldFor', 0);
  }

  private blink(rt: PuppetRuntime, delta: number): void {
    rt.blinkIn -= delta;
    const closing = rt.blinkIn < 0.12;
    rt.rig.eye.scale.y = closing ? 0.15 : 1;
    if (rt.blinkIn <= 0) rt.blinkIn = 2 + ((this.time * 7.31) % 2.5);
  }
}
