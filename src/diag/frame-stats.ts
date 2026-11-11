/**
 * Rolling frame-time statistics over a time window, without allocating per
 * frame: a ring of frame times, sorted into a scratch array only when read.
 * Pure (no imports), so it is unit-tested directly by Node.
 */
export class FrameStats {
  private times: Float32Array;
  private scratch: Float32Array;
  private head = 0;
  private count = 0;
  private windowMs: number;

  /** `capacity` frames is enough for the window at the highest frame rate (120 Hz x 5 s = 600). */
  constructor(windowMs = 5000, capacity = 720) {
    this.windowMs = windowMs;
    this.times = new Float32Array(capacity);
    this.scratch = new Float32Array(capacity);
  }

  /** Add one frame's duration (ms). Older frames beyond the window are dropped on read. */
  push(ms: number): void {
    if (!(ms > 0) || ms > 1000) return;
    this.times[this.head] = ms;
    this.head = (this.head + 1) % this.times.length;
    if (this.count < this.times.length) this.count++;
  }

  /** Average, 95th percentile and worst frame time (ms) of the most recent `windowMs`, and the frame rate. */
  read(out: { avg: number; p95: number; worst: number; fps: number; frames: number }): typeof out {
    // Walk back from the newest frame until the window is full.
    let total = 0;
    let n = 0;
    for (let i = 1; i <= this.count; i++) {
      const ms = this.times[(this.head - i + this.times.length) % this.times.length];
      if (total + ms > this.windowMs && n > 0) break;
      this.scratch[n++] = ms;
      total += ms;
    }
    if (n === 0) {
      out.avg = out.p95 = out.worst = out.fps = out.frames = 0;
      return out;
    }
    const sorted = this.scratch.subarray(0, n).sort();
    out.avg = total / n;
    out.p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
    out.worst = sorted[n - 1];
    out.fps = 1000 / out.avg;
    out.frames = n;
    return out;
  }

  reset(): void {
    this.head = this.count = 0;
  }
}
