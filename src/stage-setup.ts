import {
  createSystem,
  Entity,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  SpotLight,
  Vector3,
  VisibilityState,
  XRPlane,
} from '@iwsdk/core';
import { DeskLamp, ShadowJournal, Stage, StageModes } from './shadowplay-components.js';
import { stageRuntime } from './stage-runtime.js';
import {
  createDimShell,
  createLightPool,
  createPaperScreen,
  createShadowSurface,
} from './stage-visuals.js';

const MIN_WALL = 0.6;
const MAX_WALL = 4;
const CLOSE_WALL = 1.0;
const SCREEN_DISTANCE = 2;
const FRONT_COS = Math.cos((40 * Math.PI) / 180);
/** Stage subtends ~33 degrees: width = 2 * d * tan(16.5deg). */
const WIDTH_PER_METER = 2 * Math.tan((16.5 * Math.PI) / 180);
const SCAN_MIN_SECONDS = 1.2;
const SCAN_TIMEOUT_SECONDS = 4;
const EYE_TO_DESK = 0.45;
/** How far outside a detected wall's outline the point straight ahead may fall. */
const WALL_MARGIN = 0.25;
/** Narrowest stage we will build on a small wall. */
const MIN_STAGE_WIDTH = 0.35;
const DIM_FADE_SECONDS = 2.5;
/** Sliding the lamp sideways sweeps its aim across the wall this many times further. */
const SWEEP_GAIN = 3.5;

/**
 * Chooses the wall in front of the seated player (or a floating paper screen),
 * places the stage and the desk lamp, owns the lamp's shadow-casting spot light,
 * and fades the room-dimming shell in like a theatre.
 */
export class StageSetupSystem extends createSystem({
  stages: { required: [Stage] },
  lamps: { required: [DeskLamp] },
  planes: { required: [XRPlane] },
  journals: { required: [ShadowJournal] },
}) {
  private stageEntity: Entity | undefined;
  private lampEntity: Entity | undefined;
  private shell = createDimShell();
  private pool = createLightPool();
  private surface = createShadowSurface();
  private paper = createPaperScreen();
  private spot!: SpotLight;
  private spotTarget = new Object3D();
  /** Per-instance bulb material so the glow can follow the lamp level. */
  private bulbMaterial: MeshStandardMaterial | null = null;
  private scanTime = 0;
  private dimLevel = 0;
  private placed = false;
  private inXR = false;

  private head = new Vector3();
  private forward = new Vector3();
  private tmpA = new Vector3();
  private tmpB = new Vector3();
  private normal = new Vector3();
  private bestNormal = new Vector3();
  private bestPoint = new Vector3();
  private basis = new Matrix4();
  private right = new Vector3();
  private corner = new Vector3();
  /** Chosen wall's horizontal extent, relative to the point straight ahead. */
  private bestUMin = 0;
  private bestUMax = 0;
  private watchedRef: XRReferenceSpace | null = null;
  private onReset = () => this.resetPlacement();
  /** Where the lamp was placed; dragging away from here sweeps the light. */
  private lampHome = new Vector3();
  private sweep = new Vector3();

  init(): void {
    this.spot = new SpotLight(0xffc27a, 6, 6, (38 * Math.PI) / 180, 0.55, 1.2);
    this.spot.name = 'lamp-spot';
    // SpotLight defaults to position (0, 1, 0); it must sit exactly on the bulb.
    this.spot.position.set(0, 0, 0);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.camera.near = 0.02;
    this.spot.shadow.camera.far = 6;
    this.spot.shadow.bias = -0.0004;
    this.spot.shadow.normalBias = 0.004;
    this.spot.shadow.radius = 4;
    this.spot.target = this.spotTarget;
    this.spotTarget.name = 'lamp-spot-target';

    this.cleanupFuncs.push(
      () => this.watchedRef?.removeEventListener('reset', this.onReset),
      this.world.visibilityState.subscribe((state) => {
        const inXR = state !== VisibilityState.NonImmersive;
        if (inXR !== this.inXR) {
          this.inXR = inXR;
          this.resetPlacement();
        }
      }),
    );
  }

  private resetPlacement(): void {
    this.placed = false;
    this.scanTime = 0;
    this.dimLevel = 0;
    stageRuntime.ready = false;
    if (this.stageEntity) this.stageEntity.setValue(Stage, 'mode', StageModes.Pending);
  }

  /** Resolve authored nodes and attach runtime visuals once the level exists. */
  private bind(): boolean {
    if (this.stageEntity && this.lampEntity) return true;
    this.stageEntity = this.queries.stages.entities.values().next().value;
    this.lampEntity = this.queries.lamps.entities.values().next().value;
    const stageObj = this.stageEntity?.object3D;
    const lampObj = this.lampEntity?.object3D;
    if (!stageObj || !lampObj) {
      this.stageEntity = undefined;
      this.lampEntity = undefined;
      return false;
    }
    stageObj.add(this.paper, this.pool, this.surface, this.shell, this.spotTarget);
    const anchor = lampObj.getObjectByName('lamp-bulb-anchor') ?? lampObj;
    anchor.add(this.spot);
    const bulb = lampObj.getObjectByName('lamp-bulb');
    if (bulb instanceof Mesh && bulb.material instanceof MeshStandardMaterial) {
      this.bulbMaterial = bulb.material.clone();
      bulb.material = this.bulbMaterial;
    }
    return true;
  }

  update(delta: number): void {
    const renderer = this.world.renderer;
    if (!renderer.shadowMap.enabled) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFSoftShadowMap;
    }
    if (!this.bind()) return;
    const stage = this.stageEntity!;
    const lamp = this.lampEntity!;

    // Re-place on request (Settings) or when the headset recenters the space.
    if (stage.getValue(Stage, 'replaceRequested')) {
      stage.setValue(Stage, 'replaceRequested', false);
      this.resetPlacement();
    }
    const ref = this.world.xrReferenceSpace;
    if (ref !== this.watchedRef) {
      this.watchedRef?.removeEventListener('reset', this.onReset);
      ref?.addEventListener('reset', this.onReset);
      this.watchedRef = ref;
    }

    const headObj = this.player.head;
    headObj.updateWorldMatrix(true, false);
    this.head.setFromMatrixPosition(headObj.matrixWorld);
    headObj.getWorldDirection(this.forward);
    // Object3D.getWorldDirection returns +Z; the viewer looks down -Z.
    this.forward.negate();
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();

    if (!this.placed) {
      this.scanTime += delta;
      if (!this.inXR) {
        this.placeScreen(stage, lamp);
      } else if (this.scanTime >= SCAN_MIN_SECONDS) {
        if (this.findWall()) this.placeOnWall(stage, lamp);
        else if (this.scanTime >= SCAN_TIMEOUT_SECONDS) this.placeScreen(stage, lamp);
      }
    }

    this.updateLighting(stage, lamp, delta);
  }

  /** Pick the vertical plane most directly in front of the player. */
  private findWall(): boolean {
    let bestScore = -Infinity;
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as XRPlane | undefined;
      const obj = entity.object3D;
      if (!plane || !obj || plane.orientation !== 'vertical') continue;
      const label = (plane as XRPlane & { semanticLabel?: string }).semanticLabel;
      if (label && label !== 'wall') continue;
      this.normal.set(0, 1, 0).applyQuaternion(obj.quaternion);
      this.tmpA.subVectors(this.head, obj.position);
      let dist = this.tmpA.dot(this.normal);
      if (dist < 0) {
        this.normal.negate();
        dist = -dist;
      }
      if (dist < MIN_WALL || dist > MAX_WALL) continue;
      const facing = -(this.normal.x * this.forward.x + this.normal.z * this.forward.z);
      if (facing < FRONT_COS) continue;
      // The point straight ahead must lie on this wall's detected outline.
      if (!this.measureWall(plane, obj, dist, facing)) continue;
      const score = facing - dist * 0.05;
      if (score > bestScore) {
        bestScore = score;
        this.bestNormal.copy(this.normal);
        this.bestPoint.copy(obj.position);
        this.bestUMin = this.uMin;
        this.bestUMax = this.uMax;
      }
    }
    return bestScore > -Infinity;
  }

  private uMin = 0;
  private uMax = 0;

  /**
   * Project the wall outline onto the wall's horizontal axis, relative to the
   * point straight ahead of the player; reject the wall if that point (or the
   * player's eye height) falls outside the outline by more than the margin.
   */
  private measureWall(plane: XRPlane, obj: Object3D, dist: number, facing: number): boolean {
    const n = this.normal;
    this.right.set(n.z, 0, -n.x).normalize();
    this.tmpB.copy(this.head).addScaledVector(this.forward, dist / Math.max(0.2, facing));
    obj.updateMatrixWorld();
    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const p of plane.polygon) {
      this.corner.set(p.x, p.y, p.z).applyMatrix4(obj.matrixWorld);
      const u = (this.corner.x - this.tmpB.x) * this.right.x + (this.corner.z - this.tmpB.z) * this.right.z;
      const v = this.corner.y - this.head.y;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    this.uMin = uMin;
    this.uMax = uMax;
    return uMin - WALL_MARGIN <= 0 && uMax + WALL_MARGIN >= 0 && vMin - 0.5 <= 0 && vMax + 0.5 >= 0;
  }

  private placeOnWall(stage: Entity, lamp: Entity): void {
    const n = this.bestNormal;
    n.y = 0;
    n.normalize();
    const dist = this.tmpA.subVectors(this.head, this.bestPoint).dot(n);
    // Ray from the head along its horizontal forward to the wall plane.
    const along = dist / Math.max(0.2, -this.forward.dot(n));
    const close = dist < CLOSE_WALL;
    // Fit the stage to the wall: shrink for narrow walls, slide it to stay on them.
    const wallWidth = this.bestUMax - this.bestUMin;
    const width = Math.max(MIN_STAGE_WIDTH, Math.min(1.5, Math.max(0.45, dist * WIDTH_PER_METER), wallWidth * 0.9));
    const half = width / 2;
    const shift =
      wallWidth <= width ? (this.bestUMin + this.bestUMax) / 2 : Math.min(this.bestUMax - half, Math.max(this.bestUMin + half, 0));
    this.right.set(n.z, 0, -n.x).normalize();
    this.tmpB
      .copy(this.head)
      .addScaledVector(this.forward, along)
      .addScaledVector(this.right, shift)
      .addScaledVector(n, 0.004);
    stage.setValue(Stage, 'wallWidth', wallWidth);
    // Close walls usually sit behind a monitor: lift the stage above it.
    this.tmpB.y = this.head.y + (close ? 0.28 : 0.05);
    this.applyStage(stage, lamp, this.tmpB, n, width, dist, StageModes.Wall, close);
  }

  private placeScreen(stage: Entity, lamp: Entity): void {
    stage.setValue(Stage, 'wallWidth', 0);
    this.normal.copy(this.forward).negate();
    this.tmpB.copy(this.head).addScaledVector(this.forward, SCREEN_DISTANCE);
    this.tmpB.y = this.head.y + 0.05;
    const width = SCREEN_DISTANCE * WIDTH_PER_METER;
    this.applyStage(stage, lamp, this.tmpB, this.normal, width, SCREEN_DISTANCE, StageModes.Screen, false);
  }

  private applyStage(
    stage: Entity,
    lamp: Entity,
    center: Vector3,
    normal: Vector3,
    width: number,
    dist: number,
    mode: (typeof StageModes)[keyof typeof StageModes],
    close: boolean,
  ): void {
    const stageObj = stage.object3D!;
    const lampObj = lamp.object3D!;
    const height = width * 0.62;
    const up = stageRuntime.up.set(0, 1, 0);
    const right = stageRuntime.right.crossVectors(up, normal).normalize();
    stageRuntime.normal.copy(normal);
    stageRuntime.center.copy(center);
    stageRuntime.width = width;
    stageRuntime.height = height;

    stageObj.position.copy(center);
    this.basis.makeBasis(right, up, normal);
    stageObj.quaternion.setFromRotationMatrix(this.basis);
    stageObj.updateMatrixWorld(true);

    const screen = mode === StageModes.Screen;
    this.paper.visible = screen;
    this.paper.scale.set(width * 1.25, height * 1.35, 1);
    this.pool.scale.set(width * 1.5, height * 1.7, 1);
    if (screen) this.surface.scale.set(width * 1.25, height * 1.35, 1);
    else this.surface.scale.set(width * 2.6, height * 3, 1);

    // Dimming shell is centred on the viewer, with its opening toward the stage.
    stageObj.worldToLocal(this.shell.position.copy(this.head));
    const u = this.shell.material.uniforms;
    (u.uStageDir.value as Vector3).copy(this.shell.position).negate().normalize();
    const half = Math.atan2(width * 0.5, dist);
    u.uCosInner.value = Math.cos(half + (4 * Math.PI) / 180);
    u.uCosOuter.value = Math.cos(half + (20 * Math.PI) / 180);

    // Lamp on the desk, between the player and the stage, facing the stage.
    const deskY = Math.max(0.4, this.head.y - EYE_TO_DESK);
    const lampForward = close ? 0.22 : 0.3;
    lampObj.position
      .copy(this.head)
      .addScaledVector(this.forward, lampForward)
      .addScaledVector(right, 0.16);
    lampObj.position.y = deskY;
    this.lampHome.copy(lampObj.position);

    // The Shadow Journal lies on the desk on the other side, front edge to the player.
    for (const journal of this.queries.journals.entities) {
      const book = journal.object3D;
      if (!book) continue;
      book.position
        .copy(this.head)
        .addScaledVector(this.forward, close ? 0.2 : 0.28)
        .addScaledVector(right, -0.2);
      book.position.y = deskY;
      book.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z) + 0.2, 0);
    }

    stage.setValue(Stage, 'mode', mode);
    stage.setValue(Stage, 'distance', dist);
    stage.setValue(Stage, 'width', width);
    this.placed = true;
    stageRuntime.ready = true;
  }

  /** Aim the lamp (and the light pool) according to how far it was slid along the desk. */
  private updateAim(lamp: Entity): void {
    const lampObj = lamp.object3D!;
    this.sweep.subVectors(lampObj.position, this.lampHome);
    const r = stageRuntime.right;
    const half = stageRuntime.width * 0.45;
    const du = Math.max(-half, Math.min(half, (this.sweep.x * r.x + this.sweep.z * r.z) * SWEEP_GAIN));
    this.spotTarget.position.set(du, 0, 0);
    this.pool.position.x = du;
    stageRuntime.poolCenter.copy(stageRuntime.center).addScaledVector(r, du);
    const p = lampObj.position;
    const c = stageRuntime.poolCenter;
    lampObj.rotation.set(0, Math.atan2(-(c.x - p.x), -(c.z - p.z)), 0);
  }

  private updateLighting(stage: Entity, lamp: Entity, delta: number): void {
    if (this.placed) this.updateAim(lamp);
    const finale = stage.getValue(Stage, 'finale') ?? 0;
    const lampOn = Boolean(stage.getValue(Stage, 'lampOn'));
    const level = lampOn ? (stage.getValue(Stage, 'lampLevel') ?? 1) : 0;
    if (this.bulbMaterial) this.bulbMaterial.emissiveIntensity = 0.15 + 2.05 * level;
    const targetDim = this.placed ? (stage.getValue(Stage, 'dim') ?? 0.6) * (1 - 0.75 * finale) : 0;
    const step = delta / DIM_FADE_SECONDS;
    this.dimLevel += Math.max(-step, Math.min(step, targetDim - this.dimLevel));
    this.shell.material.uniforms.uDim.value = this.dimLevel;
    this.shell.visible = this.dimLevel > 0.001;

    const intensity = lamp.getValue(DeskLamp, 'intensity') ?? 6;
    const angleDeg = lamp.getValue(DeskLamp, 'angleDeg') ?? 38;
    this.spot.intensity = this.placed ? intensity * level * (1 + finale) : 0;
    this.spot.angle = ((angleDeg + (70 - angleDeg) * finale) * Math.PI) / 180;

    const warm = targetDim > 0 ? Math.min(1, this.dimLevel / targetDim) : 1;
    this.pool.scale.set(stageRuntime.width * 1.5 * (1 + 2.5 * finale), stageRuntime.height * 1.7 * (1 + 2.5 * finale), 1);
    const poolGain = this.paper.visible ? 0.18 : 0.4;
    this.pool.material.uniforms.uIntensity.value = this.placed ? (poolGain + 0.5 * finale) * warm * level : 0;
    this.surface.visible = this.placed && level > 0.02;

    this.spot.getWorldPosition(stageRuntime.bulb);
    stageRuntime.lampOn = level > 0.3;
  }
}
