import { createSystem, Entity, Vector3 } from '@iwsdk/core';
import { classify, computeFeatures, MatchResult } from './hand-features.js';
import { Hands, ShapeIds, ShapeRecognizer } from './shadowplay-components.js';
import { handRuntime, HandSample, isOnStage, projectToStage, stageRuntime } from './stage-runtime.js';

/** Flicker grace: brief tracking dropouts don't reset the hold timer. */
const GRACE_SECONDS = 0.15;
/**
 * Wrists this close together with both hands open read as a two-hand bird.
 * Side-by-side palms (not interlocked) put the wrists about a hand-width apart.
 */
const BIRD_WRIST_GAP = 0.22;
const BIRD_MAX_CURL = 0.35;
/** A silhouette match older than this no longer counts. */
const SILHOUETTE_FRESH_MS = 600;
/** Deer: hands may be further apart than the bird's (antlers either side of the head). */
const DEER_WRIST_GAP = 0.4;
const DEER_MIN_UP = 0.75;
const DEER_MIN_SPREAD = 0.5;
/** Crocodile: flat hands stacked, one wrist above the other. */
const CROC_MIN_DY = 0.03;
const CROC_MAX_DY = 0.2;
const CROC_MAX_SIDEWAYS = 0.12;
const CROC_MAX_SPREAD = 0.4;

/** Free Stage: every shape that can be performed, mapped to its character. */
const FREE_ACCEPT: Readonly<Record<string, string>> = {
  [ShapeIds.Rabbit]: ShapeIds.Rabbit,
  [ShapeIds.Ears]: ShapeIds.Rabbit,
  [ShapeIds.Fish]: ShapeIds.Fish,
  [ShapeIds.Dog]: ShapeIds.Dog,
  [ShapeIds.Bird]: ShapeIds.Bird,
  [ShapeIds.Snail]: ShapeIds.Snail,
  [ShapeIds.Swan]: ShapeIds.Swan,
  [ShapeIds.Deer]: ShapeIds.Deer,
  [ShapeIds.Crocodile]: ShapeIds.Crocodile,
};

interface HandEval {
  shape: string;
  inLight: boolean;
  curl: number;
  score: number;
  /** Fresh silhouette match ('' if none): method 2's opinion of this hand. */
  silhouette: string;
}

/**
 * Runs joint-angle matching every frame for both hands and, when a requested
 * shape (target or target2, or their accessibility alternatives) is held in the
 * lamp light for `holdSeconds`, records the matched hand and shape. Two open
 * hands side by side are reported as the two-hand bird.
 * Silhouette matching (method 2) is a later addition at ~5 Hz.
 */
export class ShapeMatchSystem extends createSystem({
  recognizers: { required: [ShapeRecognizer] },
}) {
  private result: MatchResult = { id: ShapeIds.None, score: 0 };
  private palm = new Vector3();
  private hit = new Vector3();
  private sinceMatch = 0;
  private candidate: string = ShapeIds.None;
  private left: HandEval = { shape: ShapeIds.None, inLight: false, curl: 1, score: 0, silhouette: '' };
  private right: HandEval = { shape: ShapeIds.None, inLight: false, curl: 1, score: 0, silhouette: '' };

  update(delta: number): void {
    for (const entity of this.queries.recognizers.entities) {
      const tolerance = entity.getValue(ShapeRecognizer, 'tolerance') ?? 0.3;
      this.evaluate(handRuntime.left, tolerance, this.left);
      this.evaluate(handRuntime.right, tolerance, this.right);
      const pair = this.detectPair();
      const twoHanded = pair !== null;
      if (pair) this.left.shape = this.right.shape = pair;
      this.publish(entity);

      const t1 = entity.getValue(ShapeRecognizer, 'target') ?? ShapeIds.None;
      const t2 = entity.getValue(ShapeRecognizer, 'target2') ?? ShapeIds.None;
      const free = Boolean(entity.getValue(ShapeRecognizer, 'freeMode'));
      const oneHand = Boolean(entity.getValue(ShapeRecognizer, 'oneHand'));
      if (t1 === ShapeIds.None && t2 === ShapeIds.None && !free) {
        entity.setValue(ShapeRecognizer, 'heldFor', 0);
        continue;
      }
      if (entity.getValue(ShapeRecognizer, 'matchedHand') !== Hands.None) {
        // A live bird or cup upgrades to two hands when the second hand joins (and back).
        const live = entity.getValue(ShapeRecognizer, 'matchedShape');
        if (live === ShapeIds.Bird || live === ShapeIds.Cup) {
          entity.setValue(ShapeRecognizer, 'twoHanded', twoHanded);
        }
        continue;
      }

      const a1 = entity.getValue(ShapeRecognizer, 'altTarget') ?? ShapeIds.None;
      const a2 = entity.getValue(ShapeRecognizer, 'altTarget2') ?? ShapeIds.None;
      // A request is satisfied when either method (joint angles or silhouette) matches it.
      const rightTarget = this.right.inLight ? this.satisfies(this.right, t1, a1, t2, a2, free, oneHand) : ShapeIds.None;
      const leftTarget = this.left.inLight ? this.satisfies(this.left, t1, a1, t2, a2, free, oneHand) : ShapeIds.None;
      const target = rightTarget !== ShapeIds.None ? rightTarget : leftTarget;

      let held = entity.getValue(ShapeRecognizer, 'heldFor') ?? 0;
      if (target !== ShapeIds.None) {
        if (target !== this.candidate) held = 0;
        this.candidate = target;
        held += delta;
        this.sinceMatch = 0;
      } else {
        this.sinceMatch += delta;
        if (this.sinceMatch > GRACE_SECONDS) held = 0;
      }
      entity.setValue(ShapeRecognizer, 'heldFor', held);
      if (held >= (entity.getValue(ShapeRecognizer, 'holdSeconds') ?? 0.5)) {
        entity.setValue(ShapeRecognizer, 'matchedHand', rightTarget !== ShapeIds.None ? Hands.Right : Hands.Left);
        entity.setValue(ShapeRecognizer, 'matchedShape', this.candidate as never);
        entity.setValue(ShapeRecognizer, 'twoHanded', twoHanded && this.candidate === pair);
      }
    }
  }

  private evaluate(hand: HandSample, tolerance: number, out: HandEval): void {
    out.shape = ShapeIds.None;
    out.inLight = false;
    out.curl = 1;
    out.score = 0;
    out.silhouette = '';
    if (!hand.tracked) return;
    const f = hand.features;
    computeFeatures(hand.joints, f);
    classify(f, this.result);
    out.curl = (f[1] + f[2] + f[3] + f[4]) / 4;
    if (this.result.score >= 1 - tolerance) out.shape = this.result.id;
    out.score = this.result.score;
    // Method 2: any pose whose shadow matches a template counts, even when the
    // joint angles disagree (e.g. fingers arranged differently).
    if (hand.silhouetteShape !== '' && performance.now() - hand.silhouetteAt < SILHOUETTE_FRESH_MS) {
      out.silhouette = hand.silhouetteShape;
      if (out.shape === ShapeIds.None) {
        out.shape = hand.silhouetteShape;
        out.score = Math.max(out.score, hand.silhouetteOverlap);
      }
    }
    if (stageRuntime.ready && stageRuntime.lampOn) {
      // Palm centre: midway between the wrist and the middle-finger knuckle.
      const j = hand.joints;
      this.palm.set((j[0] + j[33]) * 0.5, (j[1] + j[34]) * 0.5, (j[2] + j[35]) * 0.5);
      out.inLight = projectToStage(this.palm, this.hit) > 0 && isOnStage(this.hit);
    }
  }

  private satisfies(
    e: HandEval,
    t1: string,
    a1: string,
    t2: string,
    a2: string,
    free: boolean,
    oneHand: boolean,
  ): string {
    const byJoints = requested(e.shape, t1, a1, t2, a2, free, oneHand);
    if (byJoints !== ShapeIds.None || e.silhouette === '') return byJoints;
    return requested(e.silhouette, t1, a1, t2, a2, free, oneHand);
  }

  /**
   * Two-hand shapes, both hands in the light. Most specific first:
   * deer (open, fingers up and spread), crocodile (flat hands stacked),
   * bird (open, wrists side by side), cup (both cupped, side by side).
   */
  private detectPair(): string | null {
    const l = handRuntime.left;
    const r = handRuntime.right;
    if (!l.tracked || !r.tracked || !this.left.inLight || !this.right.inLight) return null;
    const dx = l.joints[0] - r.joints[0];
    const dy = l.joints[1] - r.joints[1];
    const dz = l.joints[2] - r.joints[2];
    const gap = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const sideways = Math.sqrt(dx * dx + dz * dz);
    const lf = l.features;
    const rf = r.features;
    const open = this.left.curl <= BIRD_MAX_CURL && this.right.curl <= BIRD_MAX_CURL;
    if (
      open &&
      gap < DEER_WRIST_GAP &&
      lf[8] >= DEER_MIN_UP &&
      rf[8] >= DEER_MIN_UP &&
      lf[5] >= DEER_MIN_SPREAD &&
      rf[5] >= DEER_MIN_SPREAD
    ) {
      return ShapeIds.Deer;
    }
    if (
      open &&
      Math.abs(dy) >= CROC_MIN_DY &&
      Math.abs(dy) <= CROC_MAX_DY &&
      sideways <= CROC_MAX_SIDEWAYS &&
      lf[5] <= CROC_MAX_SPREAD &&
      rf[5] <= CROC_MAX_SPREAD
    ) {
      return ShapeIds.Crocodile;
    }
    if (gap >= BIRD_WRIST_GAP) return null;
    // Wings sit side by side: stacked hands are not a bird.
    if (open && sideways >= Math.abs(dy)) return ShapeIds.Bird;
    if (this.left.shape === ShapeIds.Cup && this.right.shape === ShapeIds.Cup) return ShapeIds.Cup;
    return null;
  }

  private publish(entity: Entity): void {
    entity.setValue(ShapeRecognizer, 'leftShape', this.left.shape as never);
    entity.setValue(ShapeRecognizer, 'leftScore', this.left.score);
    entity.setValue(ShapeRecognizer, 'leftInLight', this.left.inLight);
    entity.setValue(ShapeRecognizer, 'rightShape', this.right.shape as never);
    entity.setValue(ShapeRecognizer, 'rightScore', this.right.score);
    entity.setValue(ShapeRecognizer, 'rightInLight', this.right.inLight);
  }
}

/** Which requested shape (if any) a hand's shape satisfies. */
function requested(
  shape: string,
  t1: string,
  a1: string,
  t2: string,
  a2: string,
  free: boolean,
  oneHand: boolean,
): string {
  if (shape === ShapeIds.None) return ShapeIds.None;
  if (shape === t1 || (a1 !== ShapeIds.None && shape === a1)) return t1;
  if (shape === t2 || (a2 !== ShapeIds.None && shape === a2)) return t2;
  if (!free) return ShapeIds.None;
  if (oneHand && shape === ShapeIds.Open) return ShapeIds.Bird;
  return FREE_ACCEPT[shape] ?? ShapeIds.None;
}
