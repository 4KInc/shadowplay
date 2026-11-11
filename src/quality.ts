import { createSystem, VisibilityState } from '@iwsdk/core';
import { SilhouetteMatcher, Stage } from './shadowplay-components.js';

/**
 * Frames are "slow" when their average is 3% longer than the display's refresh
 * interval: at 72 Hz that is 14.3 ms (70 fps) against 13.9, just clear of jitter.
 * On a headset the interval comes from XRSession.frameRate. When the browser
 * does not report it, or in the emulator (which claims 72 Hz on a 60 Hz desktop),
 * it is the rate measured at the end of warm-up, so a desktop is not mistaken
 * for a slow headset.
 */
export const SLOW_MARGIN = 1.03;
export const SLOW_FRAME = SLOW_MARGIN / 72;
/** How long frames must stay slow before stepping down (fast enough that a judge never sits through it). */
export const SLOW_SECONDS = 1.5;
/** Ignore the first seconds of a session (loading, shader compiles, the first placement). */
const WARMUP_SECONDS = 4;
/** After a step, wait this long for the new level to show its effect before judging again. */
const SETTLE_SECONDS = 1;
export const MAX_QUALITY_LEVEL = 3;
/** IWER, the browser XR emulator, leaves this global (it also spoofs the Quest user agent). */
const EMULATED = typeof window !== 'undefined' && 'IWER_DEVICE' in window;

/**
 * Adaptive quality: in XR, while the frame-time average stays slow, step down
 * one level at a time (never back up within a session, to avoid flicker).
 *   1  512 px shadow map; shadow surface trimmed to the lit area
 *   2  no room-dimming layer; silhouette readbacks at 2.5 Hz
 *   3  256 px shadow map; half the storm's raindrops (last resort)
 */
export class QualitySystem extends createSystem({
  stages: { required: [Stage] },
  matchers: { required: [SilhouetteMatcher] },
}) {
  private avg = 1 / 72;
  private slowFor = 0;
  private sessionTime = 0;
  private settle = 0;
  private inXR = false;
  /** Seconds per frame at the display's refresh rate (0 until known). */
  private nominal = 0;

  init(): void {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        this.inXR = state !== VisibilityState.NonImmersive;
        this.sessionTime = 0;
        this.slowFor = 0;
        this.avg = 1 / 72;
        this.nominal = 0;
      }),
    );
  }

  update(delta: number): void {
    if (!this.inXR || delta <= 0 || delta > 0.5) return;
    this.sessionTime += delta;
    // About a quarter-second average: quick to notice dropped frames, deaf to one-off hitches.
    this.avg += (delta - this.avg) * 0.08;
    if (this.sessionTime < WARMUP_SECONDS) return;
    if (!this.nominal) {
      // The emulator reports 72 Hz whatever the desktop draws at; only a real device's rate counts.
      const rate = !EMULATED ? (this.world.xrSession as (XRSession & { frameRate?: number }) | null)?.frameRate : undefined;
      this.nominal = rate && rate > 0 ? 1 / rate : Math.max(1 / 72, this.avg);
    }
    if (this.settle > 0) {
      this.settle -= delta;
      return;
    }
    this.slowFor = this.avg > this.nominal * SLOW_MARGIN ? this.slowFor + delta : 0;
    if (this.slowFor < SLOW_SECONDS) return;
    this.slowFor = 0;
    this.settle = SETTLE_SECONDS;
    for (const stage of this.queries.stages.entities) {
      const level = stage.getValue(Stage, 'quality') ?? 0;
      if (level >= MAX_QUALITY_LEVEL) return;
      stage.setValue(Stage, 'quality', level + 1);
      if (level + 1 >= 2) {
        for (const m of this.queries.matchers.entities) m.setValue(SilhouetteMatcher, 'rateHz', 2.5);
      }
    }
  }
}
