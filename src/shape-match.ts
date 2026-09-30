import { createSystem, Entity, Vector3 } from '@iwsdk/core';
import { classify, computeFeatures, FEATURE_COUNT, MatchResult } from './hand-features.js';
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

/** Free Stage: every shape that can be performed, mapped to its character. */
const FREE_ACCEPT: Readonly<Record<string, string>> = {
  [ShapeIds.Rabbit]: ShapeIds.Rabbit,
  [ShapeIds.Ears]: ShapeIds.Rabbit,
  [ShapeIds.Fish]: ShapeIds.Fish,
  [ShapeIds.Dog]: ShapeIds.Dog,
  [ShapeIds.Bird]: ShapeIds.Bird,
  [ShapeIds.Snail]: ShapeIds.Snail,
  [ShapeIds.Swan]: ShapeIds.Swan,
};

interface HandEval {
  shape: string;
  inLight: boolean;
  curl: number;
  score: number;
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
  private features = new Float32Array(FEATURE_COUNT);
  private result: MatchResult = { id: ShapeIds.None, score: 0 };
  private palm = new Vector3();
  private hit = new Vector3();
  private sinceMatch = 0;
  private candidate: string = ShapeIds.None;
  private left: HandEval = { shape: ShapeIds.None, inLight: false, curl: 1, score: 0 };
  private right: HandEval = { shape: ShapeIds.None, inLight: false, curl: 1, score: 0 };

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
      const requested = (shape: string): string => {
        if (shape === ShapeIds.None) return ShapeIds.None;
        if (shape === t1 || (a1 !== ShapeIds.None && shape === a1)) return t1;
        if (shape === t2 || (a2 !== ShapeIds.None && shape === a2)) return t2;
        return free ? (FREE_ACCEPT[shape] ?? ShapeIds.None) : ShapeIds.None;
      };
      const rightTarget = this.right.inLight ? requested(this.right.shape) : ShapeIds.None;
      const leftTarget = this.left.inLight ? requested(this.left.shape) : ShapeIds.None;
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
    if (!hand.tracked) return;
    computeFeatures(hand.joints, this.features);
    classify(this.features, this.result);
    out.curl = (this.features[1] + this.features[2] + this.features[3] + this.features[4]) / 4;
    if (this.result.score >= 1 - tolerance) out.shape = this.result.id;
    out.score = this.result.score;
    if (stageRuntime.ready && stageRuntime.lampOn) {
      // Palm centre: midway between the wrist and the middle-finger knuckle.
      const j = hand.joints;
      this.palm.set((j[0] + j[33]) * 0.5, (j[1] + j[34]) * 0.5, (j[2] + j[35]) * 0.5);
      out.inLight = projectToStage(this.palm, this.hit) > 0 && isOnStage(this.hit);
    }
  }

  /**
   * Two-hand shapes: both hands in the light, wrists side by side, and either
   * both open (the bird) or both cupped (holding the light).
   */
  private detectPair(): string | null {
    const l = handRuntime.left;
    const r = handRuntime.right;
    if (!l.tracked || !r.tracked || !this.left.inLight || !this.right.inLight) return null;
    const dx = l.joints[0] - r.joints[0];
    const dy = l.joints[1] - r.joints[1];
    const dz = l.joints[2] - r.joints[2];
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) >= BIRD_WRIST_GAP) return null;
    if (this.left.curl <= BIRD_MAX_CURL && this.right.curl <= BIRD_MAX_CURL) return ShapeIds.Bird;
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
