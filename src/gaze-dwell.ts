import {
  Box3,
  CircleGeometry,
  createSystem,
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Ray,
  Raycaster,
  type Intersection,
  RingGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { playClick } from './sfx.js';
import { DeskLamp, Hands, ShadowJournal, ShapeRecognizer, Stage, StoryState } from './shadowplay-components.js';
import { accessRuntime, gazeTargets, stageRuntime } from './stage-runtime.js';

/** Look this long at a button (seconds) to press it. */
const DWELL_SECONDS = 1.2;
/** Looking at the ghost hand stands in for making the shape: a little longer, so a glance never counts. */
const SHAPE_DWELL_SECONDS = 1.6;
/** Targets are hit-tested at most this often (Hz); dwell time still counts every frame. */
const TEST_HZ = 20;
/** Reticle size, as a fraction of its distance (about 1.2 degrees across). */
const RETICLE_SCALE = 0.011;
/** Where the reticle rests when nothing is looked at, metres ahead. */
const IDLE_DISTANCE = 1.5;

/** For tests and diagnostics: what is being looked at and how far the dwell has got. */
export const gazeRuntime = { target: '', progress: 0, presses: 0, shapes: 0 };

interface Target {
  object: Object3D;
  press: () => void;
  dwell: number;
}

/**
 * Look to press (accessibility, for limited hand mobility): a reticle follows
 * the centre of the view. Resting it on a panel button, the Shadow Journal or
 * the lamp switch for 1.2 s presses it, with a ring that fills as it waits.
 * During a shape request the ghost hand is shown at once, and looking at it
 * makes the shape, so a whole story can be told without hands. Quest 3 and 3S
 * have no eye tracking: this is head gaze, the centre of the view.
 */
export class GazeDwellSystem extends createSystem({
  journals: { required: [ShadowJournal] },
  lamps: { required: [DeskLamp] },
  stages: { required: [Stage] },
  stories: { required: [StoryState] },
}) {
  private reticle = new Group();
  private ring!: Mesh<RingGeometry, MeshBasicMaterial>;
  private fill!: Mesh<CircleGeometry, MeshBasicMaterial>;
  private entity: Entity | undefined;
  private ray = new Ray();
  /**
   * Panel buttons are UIKit elements drawn as instanced panels (no mesh of their
   * own to bound): they are tested with their own raycast(), the same test the
   * hand-ray pointer uses. Gaze is not a pointer source RayInteractable can take.
   */
  private raycaster = new Raycaster();
  private hits: Intersection[] = [];
  private box = new Box3();
  private hit = new Vector3();
  private head = new Vector3();
  private dir = new Vector3();
  private current = '';
  private held = 0;
  /** A target just pressed stays pressed until the gaze leaves it. */
  private latched = '';
  private sinceTest = 1;
  private hitDistance = IDLE_DISTANCE;
  private extra = new Map<string, Target>();
  private hintObj: Object3D | undefined;
  private switchObj: Object3D | undefined;

  init(): void {
    const material = (color: number) => new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    this.ring = new Mesh(new RingGeometry(0.75, 1, 40), material(0xffffff));
    this.fill = new Mesh(new CircleGeometry(0.7, 40), material(0xffd400));
    this.ring.renderOrder = this.fill.renderOrder = 40;
    this.reticle.add(this.ring, this.fill);
    this.reticle.name = 'gaze-reticle';
    this.reticle.visible = false;
    this.entity = this.world.createTransformEntity(this.reticle);
    this.cleanupFuncs.push(() => {
      this.ring.geometry.dispose();
      this.ring.material.dispose();
      this.fill.geometry.dispose();
      this.fill.material.dispose();
      this.entity?.dispose();
    });
  }

  update(delta: number): void {
    const on = accessRuntime.gazeDwell && stageRuntime.ready && this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    this.reticle.visible = on;
    if (!on) {
      this.reset();
      accessRuntime.gazeOnStage = false;
      return;
    }
    this.bindExtras();
    const head = this.player.head;
    head.updateWorldMatrix(true, false);
    this.head.setFromMatrixPosition(head.matrixWorld);
    head.getWorldDirection(this.dir).negate();
    this.ray.set(this.head, this.dir);

    this.sinceTest += delta;
    if (this.sinceTest >= 1 / TEST_HZ) {
      this.sinceTest = 0;
      const id = this.pick();
      if (id !== this.current) {
        this.current = id;
        this.held = 0;
      }
      if (this.latched && this.latched !== id) this.latched = '';
    }
    const target = this.targetFor(this.current);
    if (target && this.latched !== this.current) {
      this.held += delta;
      if (this.held >= target.dwell) {
        this.latched = this.current;
        this.held = 0;
        target.press();
        gazeRuntime.presses++;
      }
    } else {
      this.held = 0;
    }
    accessRuntime.gazeOnStage = this.onStage();
    gazeRuntime.target = this.current;
    gazeRuntime.progress = target ? Math.min(1, this.held / target.dwell) : 0;

    // The reticle sits on what is looked at (or a little way ahead), facing the viewer.
    this.reticle.position.copy(this.head).addScaledVector(this.dir, this.hitDistance * 0.98);
    this.reticle.quaternion.copy(head.getWorldQuaternion(this.reticle.quaternion));
    this.reticle.scale.setScalar(this.hitDistance * RETICLE_SCALE);
    const p = gazeRuntime.progress;
    this.fill.scale.setScalar(Math.max(0.001, p));
    this.fill.visible = p > 0;
    this.ring.material.color.setHex(accessRuntime.highContrast ? 0xffffff : 0xf6e3bd);
  }

  /** Whether the centre of the view falls on the stage (the wall or the paper screen). */
  private onStage(): boolean {
    const n = stageRuntime.normal;
    const facing = this.dir.dot(n);
    if (facing > -0.05) return false;
    const t = this.hit.copy(stageRuntime.center).sub(this.head).dot(n) / facing;
    if (t <= 0) return false;
    this.hit.copy(this.head).addScaledVector(this.dir, t).sub(stageRuntime.center);
    return Math.abs(this.hit.dot(stageRuntime.right)) <= stageRuntime.width * 0.5 && Math.abs(this.hit.dot(stageRuntime.up)) <= stageRuntime.height * 0.5;
  }

  private reset(): void {
    this.current = '';
    this.latched = '';
    this.held = 0;
    gazeRuntime.target = '';
    gazeRuntime.progress = 0;
  }

  /** The book, the lamp switch and the ghost hand, found once the scene exists. */
  private bindExtras(): void {
    const journal = this.queries.journals.entities.values().next().value as Entity | undefined;
    if (journal?.object3D && !this.extra.has('journal')) {
      this.extra.set('journal', {
        object: journal.object3D,
        dwell: DWELL_SECONDS,
        press: () => {
          journal.setValue(ShadowJournal, 'open', !journal.getValue(ShadowJournal, 'open'));
          playClick(journal.object3D?.position);
        },
      });
    }
    const lamp = this.queries.lamps.entities.values().next().value as Entity | undefined;
    this.switchObj ??= lamp?.object3D?.getObjectByName('lamp-switch');
    const stage = this.queries.stages.entities.values().next().value as Entity | undefined;
    if (this.switchObj && stage && !this.extra.has('lamp-switch')) {
      this.extra.set('lamp-switch', {
        object: this.switchObj,
        dwell: DWELL_SECONDS,
        press: () => {
          stage.setValue(Stage, 'lampOn', !stage.getValue(Stage, 'lampOn'));
          playClick(this.switchObj?.getWorldPosition(this.hit));
        },
      });
    }
    this.hintObj ??= this.world.scene.getObjectByName('show-me-hint');
    const story = this.queries.stories.entities.values().next().value as Entity | undefined;
    if (this.hintObj && stage && story && !this.extra.has('ghost-hand')) {
      this.extra.set('ghost-hand', {
        object: this.hintObj,
        dwell: SHAPE_DWELL_SECONDS,
        press: () => {
          // Stands in for the requested shape, exactly as a recognised hand would.
          if (!story.getValue(StoryState, 'hintVisible')) return;
          const shape = story.getValue(StoryState, 'hintShape');
          if (!shape || stage.getValue(ShapeRecognizer, 'matchedHand') !== Hands.None) return;
          stage.setValue(ShapeRecognizer, 'matchedHand', Hands.Right);
          stage.setValue(ShapeRecognizer, 'matchedShape', shape as never);
          stage.setValue(ShapeRecognizer, 'twoHanded', false);
          gazeRuntime.shapes++;
        },
      });
    }
  }

  private targetFor(id: string): Target | undefined {
    if (!id) return undefined;
    const extra = this.extra.get(id);
    if (extra) return extra;
    const t = gazeTargets.get(id);
    return t ? { object: t.object, press: t.press, dwell: DWELL_SECONDS } : undefined;
  }

  /** The nearest visible target the view's centre passes through ('' if none). */
  private pick(): string {
    let best = '';
    let bestDistance = Infinity;
    const consider = (id: string, d: number) => {
      if (d < bestDistance) {
        bestDistance = d;
        best = id;
      }
    };
    this.raycaster.ray.copy(this.ray);
    for (const [id, t] of gazeTargets) {
      if (!shown(t.object)) continue;
      this.hits.length = 0;
      t.object.raycast(this.raycaster, this.hits);
      for (const h of this.hits) consider(id, h.distance);
    }
    const test = (id: string, object: Object3D) => {
      if (!shown(object)) return;
      // The ghost hand only counts while it is showing (a shape is being asked for).
      if (id === 'ghost-hand' && !(object as Mesh).visible) return;
      this.box.setFromObject(object);
      if (this.box.isEmpty()) return;
      // A little margin: flat buttons are thin, and a steady head is not perfectly still.
      this.box.expandByScalar(0.004);
      if (!this.ray.intersectBox(this.box, this.hit)) return;
      consider(id, this.hit.distanceTo(this.head));
    };
    for (const [id, t] of this.extra) test(id, t.object);
    this.hitDistance = best ? bestDistance : IDLE_DISTANCE;
    return best;
  }
}

type UIKitLike = Object3D & { isVisible?: { peek(): boolean } };

/**
 * Visible, along with every ancestor. UIKit elements keep their own meshes
 * hidden (they are drawn as instanced panels) and say instead through their
 * isVisible signal.
 */
function shown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) {
    const ui = (o as UIKitLike).isVisible;
    if (ui ? !ui.peek() : !o.visible) return false;
  }
  return true;
}
