import {
  Color,
  createSystem,
  Entity,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  Quaternion,
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
import {
  chooseWall,
  EYE_TO_DESK,
  findDesk,
  restoreOnWall,
  SCREEN_DISTANCE,
  screenDistance,
  stageWidthPerMeter,
  WIDTH_PER_METER,
  type RoomPlane,
  type WallChoice,
} from './wall-choice.js';
import { shadowMapSize } from './quality-levels.js';
import { StageAnchor } from './stage-anchor.js';

/** Behind the stage in a browser (no passthrough): a deep night blue. */
const BROWSER_BACKGROUND = new Color(0x0d0a14);

const SCAN_MIN_SECONDS = 1.2;
const SCAN_TIMEOUT_SECONDS = 4;
/**
 * A wall that turns up after the paper-screen fallback (room data arriving
 * late) still takes the stage, but only this soon after the scan began: later
 * the story is under way and the stage must not jump.
 */
const LATE_WALL_SECONDS = 12;
/** Last session's wall (a restored anchor) is used this soon after entering, before any scan. */
const RESTORE_MIN_SECONDS = 0.3;
/** "Move stage here": time to turn toward the new spot before the scan starts. */
const MOVE_DELAY_SECONDS = 1.5;
/** A close wall (usually behind a monitor) lifts the stage above it. */
const CLOSE_WALL = 1.0;
const DIM_FADE_SECONDS = 2.5;
/** The light swell when a creature wakes: peak gain over normal, and how fast it settles (per second). */
const WAKE_FLARE_GAIN = 0.8;
const WAKE_FLARE_DECAY = 1.1;
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
  private basis = new Matrix4();
  private right = new Vector3();
  private corner = new Vector3();
  /** Detected planes in the shape wall-choice takes; objects reused frame to frame. */
  private room: RoomPlane[] = [];
  private roomPool: RoomPlane[] = [];
  private wall: WallChoice | null = null;
  private planeNormal = new Vector3();
  private bookSpot = new Vector3();
  private lateCheck = 0;
  /** Chosen wall's horizontal extent, relative to the point straight ahead. */
  private watchedRef: XRReferenceSpace | null = null;
  private onReset = () => this.resetPlacement(0);
  private lampMeshes: Mesh[] = [];
  /** Where the lamp was placed; dragging away from here sweeps the light. */
  private lampHome = new Vector3();
  private sweep = new Vector3();
  /** Keeps the stage on its wall and remembers the wall for next time (stage-anchor.ts). */
  private anchor = new StageAnchor();
  private anchorPose = new Matrix4();
  private fix = new Matrix4();
  private anchorQ = new Quaternion();
  private anchorScale = new Vector3();

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
      () => this.anchor.end(),
      (() => {
        // Phones rotate and browsers resize: re-fit the screen outside XR.
        const onResize = () => {
          if (!this.inXR) this.resetPlacement(0);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      })(),
      this.world.visibilityState.subscribe((state) => {
        const inXR = state !== VisibilityState.NonImmersive;
        if (inXR !== this.inXR) {
          this.inXR = inXR;
          if (!inXR) this.anchor.end();
          this.resetPlacement(0);
          this.applyBrowserLook();
          // Fixed foveation (lower resolution at the edges of the view) where the
          // browser supports it: the dimming layer and shadow surface are fill-rate bound.
          if (inXR) {
            this.world.renderer.xr.setFoveation(1);
            this.requestFrameRate();
          }
        }
      }),
    );
  }

  /**
   * Ask the headset for 72 Hz, the comfort floor the app is budgeted for (13.9 ms
   * a frame); Quest Browser may otherwise run at 90. The answer is recorded for
   * diagnostics (stageRuntime.frameRateRequest).
   */
  private requestFrameRate(): void {
    const session = this.world.xrSession as (XRSession & { updateTargetFrameRate?: (rate: number) => Promise<void>; supportedFrameRates?: Float32Array }) | null;
    if (!session?.updateTargetFrameRate) {
      stageRuntime.frameRateRequest = 'unsupported';
      return;
    }
    const rates = session.supportedFrameRates ? Array.from(session.supportedFrameRates) : [];
    if (rates.length && !rates.includes(72)) {
      stageRuntime.frameRateRequest = 'unsupported';
      return;
    }
    session.updateTargetFrameRate(72).then(
      () => (stageRuntime.frameRateRequest = 'granted'),
      () => (stageRuntime.frameRateRequest = 'refused'),
    );
  }

  /** Forget the placement and scan again, after `delay` seconds (time to turn toward a new spot). */
  private resetPlacement(delay: number): void {
    this.placed = false;
    this.scanTime = -delay;
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
    lampObj.traverse((o) => {
      if (o instanceof Mesh) this.lampMeshes.push(o);
    });
    this.applyBrowserLook();
    return true;
  }

  /**
   * Outside a headset (desktop link, phone or tablet viewer) there is no desk:
   * the lamp body would sit between the screen and the stage, so only its light
   * remains, and the empty room behind the stage is a dark night sky.
   */
  private applyBrowserLook(): void {
    for (const m of this.lampMeshes) m.visible = this.inXR;
    this.world.scene.background = this.inXR ? null : BROWSER_BACKGROUND;
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
      // The player chose a new spot: last session's wall no longer applies.
      this.anchor.discardRestored();
      this.resetPlacement(this.inXR ? MOVE_DELAY_SECONDS : 0);
    }
    const ref = this.world.xrReferenceSpace;
    if (ref !== this.watchedRef) {
      this.watchedRef?.removeEventListener('reset', this.onReset);
      ref?.addEventListener('reset', this.onReset);
      this.watchedRef = ref;
    }

    // In XR the tracked head; in the desktop browser the camera actually rendering.
    const headObj = this.inXR ? this.player.head : this.world.camera;
    headObj.updateWorldMatrix(true, false);
    this.head.setFromMatrixPosition(headObj.matrixWorld);
    headObj.getWorldDirection(this.forward);
    // Object3D.getWorldDirection returns +Z (the viewer looks down -Z); cameras
    // already return their look direction.
    if (!(headObj as Object3D & { isCamera?: boolean }).isCamera) this.forward.negate();
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();

    // A new XR session: start restoring last session's wall.
    const session = this.inXR ? (this.world.xrSession ?? null) : null;
    if (session && session !== this.anchor.began) this.anchor.begin(session, stageRuntime.testNoAnchors);

    if (!this.placed) {
      this.scanTime += delta;
      if (!this.inXR) {
        this.placeScreen(stage, lamp);
      } else if (this.scanTime >= RESTORE_MIN_SECONDS && this.placeRestored(stage, lamp)) {
        // Back on last session's wall.
      } else if (this.anchor.waiting && this.scanTime < SCAN_TIMEOUT_SECONDS) {
        // Still hearing whether last session's wall can be restored.
      } else if (this.scanTime >= SCAN_MIN_SECONDS) {
        if (this.findWall()) this.placeOnWall(stage, lamp);
        else if (this.scanTime >= SCAN_TIMEOUT_SECONDS) this.placeScreen(stage, lamp);
      }
    } else if (this.inXR && this.scanTime < LATE_WALL_SECONDS && stage.getValue(Stage, 'mode') === StageModes.Screen) {
      // On the paper screen for now: a wall whose room data arrives late still wins, for a few seconds.
      this.scanTime += delta;
      this.lateCheck += delta;
      if (this.lateCheck >= 0.5) {
        this.lateCheck = 0;
        if (this.findWall()) this.placeOnWall(stage, lamp);
      }
    }

    if (this.placed && this.inXR) this.followAnchor(stage, lamp);
    stageRuntime.anchor = this.anchor.state;
    stageRuntime.anchorFromLastTime = this.anchor.fromLastTime;
    stageRuntime.anchorFixes = this.anchor.fixes;
    stageRuntime.anchorMaxFixCm = this.anchor.maxFixCm;

    this.updateLighting(stage, lamp, delta);
  }

  /**
   * Last session's wall, when its anchor was restored and still makes sense
   * from where the player sits now (wall-choice.ts restoreOnWall). The stage
   * goes back to the same spot, at today's eye height.
   */
  private placeRestored(stage: Entity, lamp: Entity): boolean {
    const savedWidth = this.anchor.restoredPose(this.xrFrame, this.world.xrReferenceSpace, this.anchorPose);
    if (!savedWidth) return false;
    this.anchorPose.decompose(this.tmpB, this.anchorQ, this.anchorScale);
    this.tmpA.set(0, 0, 1).applyQuaternion(this.anchorQ);
    const fit = restoreOnWall(this.head, this.forward, this.tmpB, this.tmpA, savedWidth, stageWidthPerMeter(this.measureFov()));
    if (!fit) {
      this.anchor.discardRestored();
      return false;
    }
    const close = fit.dist < CLOSE_WALL;
    this.normal.set(this.tmpA.x, 0, this.tmpA.z).normalize();
    this.tmpB.y = this.head.y + (close ? 0.28 : 0.05);
    stage.setValue(Stage, 'wallWidth', 0);
    this.anchor.fromLastTime = true;
    this.applyStage(stage, lamp, this.tmpB, this.normal, fit.width, fit.dist, StageModes.Wall, close);
    return true;
  }

  /**
   * Keep the stage where its anchor is. When the headset re-finds the room and
   * the anchor moves, the stage, lamp and journal move with it as one piece.
   */
  private followAnchor(stage: Entity, lamp: Entity): void {
    const stageObj = stage.object3D!;
    stageObj.updateMatrixWorld();
    const moved = this.anchor.correction(this.xrFrame, this.world.xrReferenceSpace, stageObj.matrixWorld, this.fix);
    if (!moved) return;
    stageObj.applyMatrix4(this.fix);
    lamp.object3D!.applyMatrix4(this.fix);
    this.lampHome.applyMatrix4(this.fix);
    for (const journal of this.queries.journals.entities) journal.object3D?.applyMatrix4(this.fix);
    stageObj.updateMatrixWorld(true);
    stageRuntime.center.copy(stageObj.position);
    stageRuntime.normal.set(0, 0, 1).applyQuaternion(stageObj.quaternion);
    stageRuntime.right.set(1, 0, 0).applyQuaternion(stageObj.quaternion);
    stageRuntime.up.set(0, 1, 0).applyQuaternion(stageObj.quaternion);
    this.anchor.corrected(moved * 100);
  }

  /** The detected planes (or an emulator test's fake ones) as wall-choice geometry. */
  private readRoom(): readonly RoomPlane[] {
    if (stageRuntime.testPlanes) return stageRuntime.testPlanes;
    this.room.length = 0;
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as XRPlane | undefined;
      const obj = entity.object3D;
      if (!plane || !obj) continue;
      const r = this.roomPool[this.room.length] ?? { orientation: '', point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, corners: [] };
      this.roomPool[this.room.length] = r;
      obj.updateMatrixWorld();
      r.orientation = plane.orientation;
      r.label = (plane as XRPlane & { semanticLabel?: string }).semanticLabel;
      r.point.x = obj.position.x;
      r.point.y = obj.position.y;
      r.point.z = obj.position.z;
      this.planeNormal.set(0, 1, 0).applyQuaternion(obj.quaternion);
      r.normal.x = this.planeNormal.x;
      r.normal.y = this.planeNormal.y;
      r.normal.z = this.planeNormal.z;
      const polygon = plane.polygon;
      r.corners.length = polygon.length;
      for (let i = 0; i < polygon.length; i++) {
        this.corner.set(polygon[i].x, polygon[i].y, polygon[i].z).applyMatrix4(obj.matrixWorld);
        const c = r.corners[i] ?? { x: 0, y: 0, z: 0 };
        c.x = this.corner.x;
        c.y = this.corner.y;
        c.z = this.corner.z;
        r.corners[i] = c;
      }
      this.room.push(r);
    }
    return this.room;
  }

  /**
   * The headset's horizontal field of view (degrees, one eye), from the XR
   * camera's projection; 0 when unknown (outside XR). Recorded for the layout
   * (stageRuntime.fovH) and diagnostics.
   */
  private measureFov(): number {
    if (!this.inXR) return 0;
    const eye = this.world.renderer.xr.getCamera().cameras[0];
    const e = eye?.projectionMatrix.elements;
    if (!e || !e[0]) return 0;
    // Asymmetric frustum: tan(left) = (1 - m8) / m0, tan(right) = (1 + m8) / m0.
    const fov = ((Math.atan((1 - e[8]) / e[0]) + Math.atan((1 + e[8]) / e[0])) * 180) / Math.PI;
    stageRuntime.fovH = Math.round(fov);
    return fov;
  }

  /** Pick the wall most directly in front of the player (see wall-choice.ts for the rules). */
  private findWall(): boolean {
    this.wall = chooseWall(this.head, this.forward, this.readRoom(), stageWidthPerMeter(this.measureFov()));
    return this.wall !== null;
  }

  private placeOnWall(stage: Entity, lamp: Entity): void {
    const w = this.wall!;
    const n = this.normal.set(w.nx, 0, w.nz);
    // Ray from the head along its horizontal forward to the wall plane.
    const along = w.dist / Math.max(0.2, -this.forward.dot(n));
    const close = w.dist < CLOSE_WALL;
    this.right.set(n.z, 0, -n.x).normalize();
    this.tmpB
      .copy(this.head)
      .addScaledVector(this.forward, along)
      .addScaledVector(this.right, w.shift)
      .addScaledVector(n, 0.004);
    stage.setValue(Stage, 'wallWidth', w.wallWidth);
    // Close walls usually sit behind a monitor: lift the stage above it.
    this.tmpB.y = this.head.y + (close ? 0.28 : 0.05);
    this.applyStage(stage, lamp, this.tmpB, this.tmpA.copy(n), w.width, w.dist, StageModes.Wall, close);
  }

  private placeScreen(stage: Entity, lamp: Entity): void {
    stage.setValue(Stage, 'wallWidth', 0);
    this.normal.copy(this.forward).negate();
    // Two metres ahead, or just in front of a nearer surface (a wall too close to use, a window).
    const dist = this.inXR ? screenDistance(this.head, this.forward, this.readRoom()) : SCREEN_DISTANCE;
    this.tmpB.copy(this.head).addScaledVector(this.forward, dist);
    this.tmpB.y = this.head.y + 0.05;
    if (!this.inXR) {
      // Browser (desktop link, phone or tablet viewer): centre the screen in the
      // actual view, pitch included, and back off until it fits the viewport.
      this.world.camera.getWorldDirection(this.tmpA);
      this.tmpB.copy(this.head).addScaledVector(this.tmpA, this.fitDistance(SCREEN_DISTANCE * WIDTH_PER_METER));
    }
    const width = dist * (this.inXR ? stageWidthPerMeter(this.measureFov()) : WIDTH_PER_METER);
    this.applyStage(stage, lamp, this.tmpB, this.normal, width, dist, StageModes.Screen, false);
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
    stageRuntime.distance = dist;
    stageRuntime.height = height;

    stageObj.position.copy(center);
    this.basis.makeBasis(right, up, normal);
    stageObj.quaternion.setFromRotationMatrix(this.basis);
    stageObj.updateMatrixWorld(true);

    const screen = mode === StageModes.Screen;
    this.paper.visible = screen;
    this.paper.scale.set(width * 1.25, height * 1.35, 1);
    this.pool.scale.set(width * 1.5, height * 1.7, 1);
    this.sizeSurface(screen, 0);

    // Dimming shell is centred on the viewer, with its opening toward the stage.
    stageObj.worldToLocal(this.shell.position.copy(this.head));
    const u = this.shell.material.uniforms;
    (u.uStageDir.value as Vector3).copy(this.shell.position).negate().normalize();
    const half = Math.atan2(width * 0.5, dist);
    u.uCosInner.value = Math.cos(half + (4 * Math.PI) / 180);
    u.uCosOuter.value = Math.cos(half + (20 * Math.PI) / 180);

    // Lamp on the desk, between the player and the stage, facing the stage; the
    // Shadow Journal on the other side. On the real desk or table when Room Setup
    // found one under both (anchored to the detected surface), else at the usual
    // seated desk height.
    const lampForward = close ? 0.22 : 0.3;
    lampObj.position
      .copy(this.head)
      .addScaledVector(this.forward, lampForward)
      .addScaledVector(right, 0.16);
    this.bookSpot
      .copy(this.head)
      .addScaledVector(this.forward, close ? 0.2 : 0.28)
      .addScaledVector(right, -0.2);
    const surface = this.inXR ? findDesk(this.head, this.readRoom(), [lampObj.position, this.bookSpot]) : null;
    const deskY = surface ?? Math.max(0.4, this.head.y - EYE_TO_DESK);
    stageRuntime.desk = surface === null ? 'estimate' : 'surface';
    lampObj.position.y = deskY;
    if (!this.inXR) {
      // Desktop browser: keep the lamp low and to the side, out of the frame.
      lampObj.position.copy(this.head).addScaledVector(this.forward, 0.55).addScaledVector(right, 0.45);
      lampObj.position.y = this.head.y - 0.62;
    }
    this.lampHome.copy(lampObj.position);

    // The Shadow Journal lies on the desk on the other side, front edge to the player.
    for (const journal of this.queries.journals.entities) {
      const book = journal.object3D;
      if (!book) continue;
      book.position.copy(this.bookSpot);
      book.position.y = deskY;
      book.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z) + 0.2, 0);
    }

    stage.setValue(Stage, 'mode', mode);
    stage.setValue(Stage, 'distance', dist);
    stage.setValue(Stage, 'width', width);
    this.placed = true;
    stageRuntime.ready = true;
    // Anchor the stage to the room; a wall is remembered for the next launch.
    if (this.inXR) this.anchor.place(this.xrFrame, this.world.xrReferenceSpace, stageObj.matrixWorld, width, mode === StageModes.Wall);
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

  /** Distance at which a paper screen of this stage width (plus caption) fits the view. */
  private fitDistance(width: number): number {
    const cam = this.world.camera;
    const vHalf = ((cam.fov ?? 50) * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * (cam.aspect || 1));
    const paperW = width * 1.25 * 1.1;
    const paperH = width * 0.62 * 1.35 * 1.35; // room for the caption under the stage
    return Math.max(1.4, paperW / 2 / Math.tan(hHalf), paperH / 2 / Math.tan(vHalf));
  }

  private appliedQuality = 0;

  /**
   * The shadow-receiving surface is the main GPU cost (every pixel of it samples
   * the shadow map, in both eyes). At full quality it spans the spotlight's whole
   * footprint on the wall; from quality 1 it covers the lit area around the light
   * pool (where shadows read anyway; the dimmed wall hides the rest), about half
   * the pixels, growing with the finale's flood of light.
   */
  private sizeSurface(screen: boolean, finale: number): void {
    const w = stageRuntime.width;
    const h = stageRuntime.height;
    if (screen) {
      this.surface.scale.set(w * 1.25, h * 1.35, 1);
      this.surface.position.x = 0;
    } else if (this.appliedQuality >= 1) {
      const grow = 1 + 1.2 * finale;
      this.surface.scale.set(Math.min(w * 2.6, w * 1.9 * grow), Math.min(h * 3, h * 2.2 * grow), 1);
      this.surface.position.x = this.pool.position.x;
    } else {
      this.surface.scale.set(w * 2.6, h * 3, 1);
      this.surface.position.x = 0;
    }
  }

  /** Quality 1-2: a 512 px shadow map instead of 1024; 3: 256 (re-allocated once per change). */
  private applyQuality(quality: number): void {
    if (quality === this.appliedQuality) return;
    this.appliedQuality = quality;
    stageRuntime.quality = quality;
    const size = shadowMapSize(quality);
    this.spot.shadow.mapSize.set(size, size);
    this.spot.shadow.map?.dispose();
    (this.spot.shadow as { map: unknown }).map = null;
  }

  private updateLighting(stage: Entity, lamp: Entity, delta: number): void {
    if (this.placed) this.updateAim(lamp);
    const finale = stage.getValue(Stage, 'finale') ?? 0;
    const lampOn = Boolean(stage.getValue(Stage, 'lampOn'));
    const level = lampOn ? (stage.getValue(Stage, 'lampLevel') ?? 1) : 0;
    if (this.bulbMaterial) this.bulbMaterial.emissiveIntensity = 0.15 + 2.05 * level;
    const quality = stage.getValue(Stage, 'quality') ?? 0;
    this.applyQuality(quality);
    const targetDim = this.placed && quality < 2 ? (stage.getValue(Stage, 'dim') ?? 0.6) * (1 - 0.75 * finale) : 0;
    const step = delta / DIM_FADE_SECONDS;
    this.dimLevel += Math.max(-step, Math.min(step, targetDim - this.dimLevel));
    this.shell.material.uniforms.uDim.value = this.dimLevel;
    this.shell.visible = this.dimLevel > 0.001;

    const intensity = lamp.getValue(DeskLamp, 'intensity') ?? 6;
    const angleDeg = lamp.getValue(DeskLamp, 'angleDeg') ?? 38;
    // A creature waking makes the light swell warmly, then settle.
    stageRuntime.wakeFlare = Math.max(0, stageRuntime.wakeFlare - delta * WAKE_FLARE_DECAY);
    const flare = 1 + WAKE_FLARE_GAIN * stageRuntime.wakeFlare * stageRuntime.wakeFlare;
    this.spot.intensity = this.placed ? intensity * level * (1 + finale) * flare : 0;
    this.spot.angle = ((angleDeg + (70 - angleDeg) * finale) * Math.PI) / 180;

    const warm = targetDim > 0 ? Math.min(1, this.dimLevel / targetDim) : 1;
    this.pool.scale.set(stageRuntime.width * 1.5 * (1 + 2.5 * finale), stageRuntime.height * 1.7 * (1 + 2.5 * finale), 1);
    const poolGain = this.paper.visible ? 0.18 : 0.4;
    this.pool.material.uniforms.uIntensity.value = this.placed ? (poolGain + 0.5 * finale) * warm * level * flare : 0;
    this.surface.visible = this.placed && level > 0.02;
    if (this.placed) this.sizeSurface(this.paper.visible, finale);

    this.spot.getWorldPosition(stageRuntime.bulb);
    stageRuntime.lampOn = level > 0.3;
  }
}
