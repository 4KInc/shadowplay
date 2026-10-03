import { createSystem, VisibilityState } from '@iwsdk/core';
import { SilhouetteMatcher, Stage } from './shadowplay-components.js';

/** Frame-time average (seconds) above which quality steps down: below ~66 fps. */
const SLOW_FRAME = 1 / 66;
/** How long frames must stay slow before stepping down. */
const SLOW_SECONDS = 3;
/** Ignore the first seconds of a session (loading, shader compiles). */
const WARMUP_SECONDS = 4;

/**
 * Adaptive quality without device measurements: in XR, if the frame-time
 * average stays slow, step down once per level (never back up within a
 * session, to avoid flicker). Level 1: 512 px shadow map. Level 2: also drop
 * the full-screen room-dimming layer and halve silhouette readbacks.
 */
export class QualitySystem extends createSystem({
  stages: { required: [Stage] },
  matchers: { required: [SilhouetteMatcher] },
}) {
  private avg = 1 / 72;
  private slowFor = 0;
  private sessionTime = 0;
  private inXR = false;

  init(): void {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        this.inXR = state !== VisibilityState.NonImmersive;
        this.sessionTime = 0;
        this.slowFor = 0;
      }),
    );
  }

  update(delta: number): void {
    if (!this.inXR || delta <= 0 || delta > 0.5) return;
    this.sessionTime += delta;
    if (this.sessionTime < WARMUP_SECONDS) return;
    this.avg += (delta - this.avg) * 0.05;
    this.slowFor = this.avg > SLOW_FRAME ? this.slowFor + delta : 0;
    if (this.slowFor < SLOW_SECONDS) return;
    this.slowFor = 0;
    for (const stage of this.queries.stages.entities) {
      const level = stage.getValue(Stage, 'quality') ?? 0;
      if (level >= 2) return;
      stage.setValue(Stage, 'quality', level + 1);
      if (level + 1 >= 2) {
        for (const m of this.queries.matchers.entities) m.setValue(SilhouetteMatcher, 'rateHz', 2.5);
      }
    }
  }
}
