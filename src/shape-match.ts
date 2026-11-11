import { createSystem, Entity, Vector3 } from '@iwsdk/core';
import { acceptScore, classify, computeFeatures, MatchResult, templateScore } from './hand-features.js';
import { Hands, ShapeIds, ShapeRecognizer } from './shadowplay-components.js';
import { classifyPair, HoldState, isHiddenPair, JointSmoother, PairHand, requested, stepHold } from './recognition-rules.js';
import { handRuntime, HandSample, isOnStage, projectToStage, stageRuntime } from './stage-runtime.js';

/** Player tolerance plus assist never goes beyond this. */
const MAX_TOLERANCE = 0.6;
/** "Almost": within this much of the acceptance score... */
const NUDGE_MARGIN = 0.12;
/** ...for this long (s) before the nudge shows; it lingers this long after. */
const NUDGE_AFTER = 1.2;
const NUDGE_LINGER = 1.5;
/** A silhouette match older than this no longer counts. */
const SILHOUETTE_FRESH_MS = 600;

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
  private hold: HoldState = { candidate: ShapeIds.None, sinceMatch: 0 };
  /** Per-hand smoothed joints for recognition (raw joints still drive the shadows). */
  private smoothL = new JointSmoother();
  private smoothR = new JointSmoother();
  private pairL: PairHand = { joints: new Float32Array(0), features: new Float32Array(0), curl: 1, shape: ShapeIds.None, best: ShapeIds.None };
  private pairR: PairHand = { joints: new Float32Array(0), features: new Float32Array(0), curl: 1, shape: ShapeIds.None, best: ShapeIds.None };
  private nudgeKind = 'none';
  private nudgeFor = 0;
  private nudgeShownFor = 0;
  private lastNudge = 'none';
  private left: HandEval = { shape: ShapeIds.None, inLight: false, curl: 1, score: 0, silhouette: '' };
  private right: HandEval = { shape: ShapeIds.None, inLight: false, curl: 1, score: 0, silhouette: '' };

  update(delta: number): void {
    for (const entity of this.queries.recognizers.entities) {
      // The player's setting plus the story's assist ladder (each written by its owner).
      const tolerance = Math.min(
        MAX_TOLERANCE,
        (entity.getValue(ShapeRecognizer, 'tolerance') ?? 0.3) + (entity.getValue(ShapeRecognizer, 'assistTolerance') ?? 0),
      );
      this.evaluate(handRuntime.left, tolerance, this.left);
      this.evaluate(handRuntime.right, tolerance, this.right);
      // Hidden two-hand creatures (deer, crocodile) exist in Free Stage, or when a
      // story asks for one; otherwise they must not steal a requested bird or cup.
      const wantsHidden =
        isHiddenPair(entity.getValue(ShapeRecognizer, 'target')) ||
        isHiddenPair(entity.getValue(ShapeRecognizer, 'altTarget')) ||
        isHiddenPair(entity.getValue(ShapeRecognizer, 'target2')) ||
        isHiddenPair(entity.getValue(ShapeRecognizer, 'altTarget2'));
      const pair = this.detectPair(Boolean(entity.getValue(ShapeRecognizer, 'freeMode')) || wantsHidden);
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

      this.updateNudge(entity, t1, free, target !== ShapeIds.None, tolerance, delta);
      const held = stepHold(this.hold, entity.getValue(ShapeRecognizer, 'heldFor') ?? 0, target, delta);
      entity.setValue(ShapeRecognizer, 'heldFor', held);
      if (held >= (entity.getValue(ShapeRecognizer, 'holdSeconds') ?? 0.5)) {
        entity.setValue(ShapeRecognizer, 'matchedHand', rightTarget !== ShapeIds.None ? Hands.Right : Hands.Left);
        entity.setValue(ShapeRecognizer, 'matchedShape', this.hold.candidate as never);
        entity.setValue(ShapeRecognizer, 'twoHanded', twoHanded && this.hold.candidate === pair);
      }
    }
  }

  private evaluate(hand: HandSample, tolerance: number, out: HandEval): void {
    out.shape = ShapeIds.None;
    out.inLight = false;
    out.curl = 1;
    out.score = 0;
    out.silhouette = '';
    hand.jointShape = '';
    const smoother = hand === handRuntime.left ? this.smoothL : this.smoothR;
    const joints = smoother.update(hand.tracked ? hand.joints : null);
    if (!joints) return;
    const f = hand.features;
    computeFeatures(joints, f);
    classify(f, this.result);
    hand.jointBest = this.result.id;
    hand.jointScore = this.result.score;
    out.curl = (f[1] + f[2] + f[3] + f[4]) / 4;
    if (this.result.score >= acceptScore(this.result.id, tolerance)) out.shape = this.result.id;
    hand.jointShape = out.shape === ShapeIds.None ? '' : out.shape;
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
   * A gentle nudge for a requested one-hand shape that is nearly there for a
   * moment: close but below the threshold ('almost'), or right but outside the
   * lamplight ('light'). Never in Free Stage; cleared as soon as it matches.
   */
  private updateNudge(entity: Entity, t1: string, free: boolean, accepted: boolean, tolerance: number, delta: number): void {
    let kind = 'none';
    if (!free && t1 !== ShapeIds.None && !accepted && entity.getValue(ShapeRecognizer, 'matchedHand') === Hands.None) {
      const accept = acceptScore(t1, tolerance);
      kind = this.handNudge(handRuntime.left, this.left, t1, accept, kind);
      kind = this.handNudge(handRuntime.right, this.right, t1, accept, kind);
    }
    if (kind === this.nudgeKind && kind !== 'none') this.nudgeFor += delta;
    else if (kind !== 'none') {
      this.nudgeKind = kind;
      this.nudgeFor = delta;
    } else {
      this.nudgeFor = 0;
      this.nudgeKind = 'none';
    }
    // Shown after a steady moment, held briefly once the hand moves on (no flicker).
    if (this.nudgeKind !== 'none' && this.nudgeFor >= NUDGE_AFTER) this.nudgeShownFor = NUDGE_LINGER;
    else this.nudgeShownFor = Math.max(0, this.nudgeShownFor - delta);
    if (accepted) this.nudgeShownFor = 0;
    const show = this.nudgeShownFor > 0 ? (this.nudgeKind === 'none' ? this.lastNudge : this.nudgeKind) : 'none';
    if (show !== 'none') this.lastNudge = show;
    if (entity.getValue(ShapeRecognizer, 'nudge') !== show) entity.setValue(ShapeRecognizer, 'nudge', show as never);
  }

  private handNudge(hand: HandSample, ev: HandEval, t1: string, accept: number, kind: string): string {
    if (!hand.tracked) return kind;
    const score = templateScore(hand.features, t1);
    if (score >= accept && !ev.inLight) return 'light';
    if (kind === 'none' && ev.inLight && score >= accept - NUDGE_MARGIN && score < accept) return 'almost';
    return kind;
  }

  /** Two-hand shapes (recognition-rules.ts), both hands tracked and in the light. */
  private detectPair(hidden: boolean): string | null {
    const l = handRuntime.left;
    const r = handRuntime.right;
    if (!l.tracked || !r.tracked || !this.left.inLight || !this.right.inLight) return null;
    this.pairL.joints = this.smoothL.joints;
    this.pairL.features = l.features;
    this.pairL.curl = this.left.curl;
    this.pairL.shape = this.left.shape;
    this.pairL.best = l.jointBest;
    this.pairR.joints = this.smoothR.joints;
    this.pairR.features = r.features;
    this.pairR.curl = this.right.curl;
    this.pairR.shape = this.right.shape;
    this.pairR.best = r.jointBest;
    return classifyPair(this.pairL, this.pairR, hidden);
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
