/**
 * Hand-tracking dropouts as a light-level signal. WebXR gives no tracking
 * confidence, but in a dim room hands flicker: tracking drops and comes back
 * within moments. A hand taken out of view on purpose stays gone longer, so
 * only short losses count. Several within a few seconds means "struggling".
 */
/** A loss shorter than this, then tracked again, is a flicker. */
export const FLICKER_MAX_SECONDS = 1.5;
/** Flickers are counted over this many seconds... */
export const FLICKER_WINDOW_SECONDS = 10;
/** ...and this many in the window means the hands are struggling. */
export const FLICKERS_STRUGGLING = 3;

const RING = 32;

export class DropoutWatch {
  /** Flickers since the last reset (diagnostics count them per story beat). */
  flickers = 0;
  private time = 0;
  private lost = { left: -1, right: -1 };
  private wasTracked = { left: false, right: false };
  private ring = new Float64Array(RING).fill(-Infinity);
  private head = 0;

  reset(): void {
    this.flickers = 0;
    this.ring.fill(-Infinity);
    this.lost.left = this.lost.right = -1;
  }

  /** Advance by `delta` seconds with each hand's tracking state; returns whether the hands are struggling. */
  step(delta: number, left: boolean, right: boolean): boolean {
    this.time += Math.min(delta, 0.25);
    this.hand('left', left);
    this.hand('right', right);
    return this.struggling();
  }

  struggling(): boolean {
    let recent = 0;
    for (let i = 0; i < RING; i++) if (this.time - this.ring[i] <= FLICKER_WINDOW_SECONDS) recent++;
    return recent >= FLICKERS_STRUGGLING;
  }

  private hand(side: 'left' | 'right', tracked: boolean): void {
    if (this.wasTracked[side] && !tracked) this.lost[side] = this.time;
    if (!this.wasTracked[side] && tracked && this.lost[side] >= 0) {
      if (this.time - this.lost[side] <= FLICKER_MAX_SECONDS) {
        this.flickers++;
        this.ring[this.head] = this.time;
        this.head = (this.head + 1) % RING;
      }
      this.lost[side] = -1;
    }
    this.wasTracked[side] = tracked;
  }
}
