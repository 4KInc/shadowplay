import {
  createSystem,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Types,
  Vector3,
} from '@iwsdk/core';
import { handOverride, handRuntime, HandSample, JOINT_COUNT, SILHOUETTE_LAYER } from './stage-runtime.js';

type Pair = readonly [number, number, number]; // joint a, joint b, fixed radius (0 = from joints)

/** Finger bones along each WebXR joint chain, plus palm fill. */
const BONES: readonly Pair[] = [
  [0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 4, 0],
  [5, 6, 0], [6, 7, 0], [7, 8, 0], [8, 9, 0],
  [10, 11, 0], [11, 12, 0], [12, 13, 0], [13, 14, 0],
  [15, 16, 0], [16, 17, 0], [17, 18, 0], [18, 19, 0],
  [20, 21, 0], [21, 22, 0], [22, 23, 0], [23, 24, 0],
  // palm: wrist fan and knuckle line so the palm reads as solid in shadow
  [0, 6, 0.02], [0, 11, 0.02], [0, 16, 0.02], [0, 21, 0.018],
  [6, 11, 0.012], [11, 16, 0.012], [16, 21, 0.012], [2, 6, 0.012],
];

/** WebXR Hand Input batch APIs (missing from the bundled DOM typings). */
interface HandJointFrame {
  fillPoses?(spaces: XRSpace[], base: XRSpace, out: Float32Array): boolean;
  fillJointRadii?(spaces: XRJointSpace[], out: Float32Array): boolean;
}

interface HandCaster {
  sample: HandSample;
  joints: InstancedMesh;
  bones: InstancedMesh;
  xrHand: XRHand | null;
  spaces: XRJointSpace[];
}

/**
 * Builds invisible, shadow-casting capsules (spheres at joints, cylinders along
 * bones) from WebXR hand joints every frame. The real hands are visible in
 * passthrough; only their shadows are rendered. The same capsules are
 * depth-only occluders, so virtual content never draws over the real hand.
 * While a character replaces a hand's shadow the capsules stop casting but
 * keep occluding.
 */
export class HandCasterSystem extends createSystem(
  {},
  { showCasters: { type: Types.Boolean, default: false } },
) {
  private hands!: { left: HandCaster; right: HandCaster };
  private material!: MeshBasicMaterial;
  private poses = new Float32Array(JOINT_COUNT * 16);
  private m = new Matrix4();
  private q = new Quaternion();
  private a = new Vector3();
  private b = new Vector3();
  private s = new Vector3();
  private yAxis = new Vector3(0, 1, 0);

  init(): void {
    // Never drawn in colour, but always written to depth (and drawn first): the
    // capsules double as occluders so the real hand, seen in passthrough,
    // stays in front of its own shadow, the characters, Mo and the captions.
    this.material = new MeshBasicMaterial({ color: 0x120e18, colorWrite: false, depthWrite: true });
    const sphere = new SphereGeometry(1, 10, 8);
    const cylinder = new CylinderGeometry(1, 1, 1, 10, 1, true);
    const root = new Group();
    root.name = 'hand-casters';
    const make = (sample: HandSample, side: 'left' | 'right'): HandCaster => {
      const joints = new InstancedMesh(sphere, this.material, JOINT_COUNT);
      const bones = new InstancedMesh(cylinder, this.material, BONES.length);
      joints.name = `hand-caster-${side}-joints`;
      bones.name = `hand-caster-${side}-bones`;
      for (const mesh of [joints, bones]) {
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.renderOrder = -20;
        // Layer 0 for the lamp's shadow pass, plus a per-hand layer for silhouette matching.
        mesh.layers.enable(SILHOUETTE_LAYER[side]);
        root.add(mesh);
      }
      return { sample, joints, bones, xrHand: null, spaces: [] };
    };
    this.hands = { left: make(handRuntime.left, 'left'), right: make(handRuntime.right, 'right') };
    this.world.createTransformEntity(root);

    this.cleanupFuncs.push(
      this.config.showCasters.subscribe((show) => {
        this.material.colorWrite = show;
        this.material.needsUpdate = true;
      }),
    );
  }

  update(): void {
    const frame = this.world.xrFrame;
    const refSpace = this.world.xrReferenceSpace;
    const session = this.world.xrSession;
    let seenLeft = false;
    let seenRight = false;
    let hands = 0;
    let controllers = 0;
    if (handOverride.active) {
      // Test source (fixtures / webcam): joints are already in world space.
      seenLeft = this.useOverride(this.hands.left, handOverride.left);
      seenRight = this.useOverride(this.hands.right, handOverride.right);
      handRuntime.controllersOnly = false;
      this.finish(this.hands.left, seenLeft);
      this.finish(this.hands.right, seenRight);
      return;
    }
    if (frame && refSpace && session) {
      for (const source of session.inputSources) {
        if (source.hand) hands++;
        else if (source.gamepad) controllers++;
        if (!source.hand || (source.handedness !== 'left' && source.handedness !== 'right')) continue;
        const caster = this.hands[source.handedness];
        if (this.sampleHand(caster, source.hand, frame, refSpace)) {
          if (source.handedness === 'left') seenLeft = true;
          else seenRight = true;
        }
      }
    }
    handRuntime.controllersOnly = controllers > 0 && hands === 0;
    this.finish(this.hands.left, seenLeft);
    this.finish(this.hands.right, seenRight);
  }

  private sampleHand(caster: HandCaster, hand: XRHand, frame: XRFrame, ref: XRReferenceSpace): boolean {
    if (caster.xrHand !== hand) {
      caster.xrHand = hand;
      caster.spaces = Array.from(hand.values());
    }
    if (caster.spaces.length < JOINT_COUNT) return false;
    const f = frame as XRFrame & HandJointFrame;
    if (!f.fillPoses || !f.fillJointRadii) return false;
    if (!f.fillPoses(caster.spaces, ref, this.poses)) return false;
    f.fillJointRadii(caster.spaces, caster.sample.radii);

    const origin = this.player.matrixWorld;
    const joints = caster.sample.joints;
    for (let i = 0; i < JOINT_COUNT; i++) {
      const o = i * 16;
      this.a.set(this.poses[o + 12], this.poses[o + 13], this.poses[o + 14]).applyMatrix4(origin);
      joints[i * 3] = this.a.x;
      joints[i * 3 + 1] = this.a.y;
      joints[i * 3 + 2] = this.a.z;
    }
    return true;
  }

  private useOverride(caster: HandCaster, joints: Float32Array | null): boolean {
    if (!joints) return false;
    caster.sample.joints.set(joints);
    caster.sample.radii.set(handOverride.radii);
    return true;
  }

  private finish(caster: HandCaster, tracked: boolean): void {
    caster.sample.tracked = tracked;
    if (!tracked) {
      caster.joints.count = 0;
      caster.bones.count = 0;
      return;
    }
    const casting = !caster.sample.hideCasters;
    caster.joints.castShadow = casting;
    caster.bones.castShadow = casting;
    const joints = caster.sample.joints;
    const radii = caster.sample.radii;
    for (let i = 0; i < JOINT_COUNT; i++) {
      this.a.fromArray(joints, i * 3);
      const r = Math.max(0.006, radii[i] * 1.05);
      this.m.compose(this.a, this.q.identity(), this.s.set(r, r, r));
      caster.joints.setMatrixAt(i, this.m);
    }
    for (let k = 0; k < BONES.length; k++) {
      const [ja, jb, fixed] = BONES[k];
      this.a.fromArray(joints, ja * 3);
      this.b.fromArray(joints, jb * 3);
      const r = fixed > 0 ? fixed : Math.max(0.006, (radii[ja] + radii[jb]) * 0.52);
      this.b.sub(this.a);
      const len = this.b.length();
      if (len > 1e-5) this.q.setFromUnitVectors(this.yAxis, this.b.divideScalar(len));
      else this.q.identity();
      this.a.addScaledVector(this.b, len * 0.5);
      this.m.compose(this.a, this.q, this.s.set(r, Math.max(len, 1e-4), r));
      caster.bones.setMatrixAt(k, this.m);
    }
    caster.joints.count = JOINT_COUNT;
    caster.bones.count = BONES.length;
    caster.joints.instanceMatrix.needsUpdate = true;
    caster.bones.instanceMatrix.needsUpdate = true;
  }
}
