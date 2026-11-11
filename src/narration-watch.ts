/**
 * Watches a narration clip that should be playing. A clip can stall (a slow or
 * dropped download, or a play() cut off by a quick pause and resume) and then
 * never report that it ended, which would leave the story waiting on silence
 * until its safety limit (about 25 s). If the playback position has not moved
 * for STALL_SECONDS: retry the clip once, then give up so the line finishes
 * on its caption and reading time.
 */
export const STALL_SECONDS = 3;

export type StallAction = 'ok' | 'retry' | 'give-up';

export class StallWatch {
  private lastTime = -1;
  private still = 0;
  private retried = false;

  /** A new clip (or the line was stopped): start watching afresh. */
  reset(): void {
    this.lastTime = -1;
    this.still = 0;
    this.retried = false;
  }

  /** Call each frame while the clip should be playing (not while paused). */
  step(delta: number, currentTime: number): StallAction {
    if (currentTime !== this.lastTime) {
      this.lastTime = currentTime;
      this.still = 0;
      return 'ok';
    }
    // One long frame (returning from a hidden session) must not count as a stall.
    this.still += Math.min(delta, 0.25);
    if (this.still < STALL_SECONDS) return 'ok';
    this.still = 0;
    if (!this.retried) {
      this.retried = true;
      return 'retry';
    }
    return 'give-up';
  }
}
