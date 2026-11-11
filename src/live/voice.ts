import { VOICE_RATE } from './protocol.js';

/** 20 ms of audio per packet. */
const CHUNK = VOICE_RATE / 50;
/** Playback waits for this much audio before starting (and after running dry). */
const PRIME = VOICE_RATE / 10;
/** The safety margin the adaptive buffer keeps: the least audio that sat queued over the last window. */
const MARGIN = Math.round(VOICE_RATE * 0.04);
/** Window (in output samples) over which the queue's low point is measured. */
const WINDOW = VOICE_RATE * 2;
/** Hard cap: more queued than this (a long stall, then a burst) skips straight to PRIME. */
const MAX_QUEUED = Math.round(VOICE_RATE * 0.6);

const WORKLETS = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(${CHUNK}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0; }
    }
    return true;
  }
}
// Adaptive jitter buffer: start after PRIME; every WINDOW, the lowest the queue fell is
// audio that was never needed, so trim it (down to MARGIN), mostly in quiet moments and
// otherwise one sample in 24 (about 4% faster, not noticeable in speech). Delay grows
// only as much as the network's jitter needs and shrinks again when it calms.
class Playback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(${VOICE_RATE * 2});
    this.read = 0; this.write = 0; this.size = 0; this.primed = false; this.hearing = false;
    this.low = Infinity; this.counted = 0; this.trim = 0; this.n = 0;
    this.port.onmessage = (e) => {
      const pcm = e.data;
      for (let i = 0; i < pcm.length; i++) {
        if (this.size === this.ring.length) { this.read = (this.read + 1) % this.ring.length; this.size--; }
        this.ring[this.write] = pcm[i] / 0x8000;
        this.write = (this.write + 1) % this.ring.length;
        this.size++;
      }
      if (this.size > ${MAX_QUEUED}) {
        const drop = this.size - ${PRIME};
        this.read = (this.read + drop) % this.ring.length;
        this.size -= drop;
        this.low = Infinity; this.counted = 0; this.trim = 0;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!this.primed && this.size >= ${PRIME}) { this.primed = true; this.low = Infinity; this.counted = 0; }
    let level = 0;
    for (let i = 0; i < out.length; i++) {
      if (this.primed && this.size > 0) {
        let v = this.ring[this.read];
        this.read = (this.read + 1) % this.ring.length;
        this.size--;
        // Trim: skip quiet samples freely, loud ones sparingly.
        if (this.trim > 0 && this.size > ${MARGIN} && (Math.abs(v) < 0.01 || ++this.n % 24 === 0)) {
          this.trim--;
          v = this.ring[this.read];
          this.read = (this.read + 1) % this.ring.length;
          this.size--;
        }
        out[i] = v;
        level = Math.max(level, Math.abs(v));
        if (this.size < this.low) this.low = this.size;
      } else {
        out[i] = 0;
        this.primed = false;
      }
    }
    if (this.primed && (this.counted += out.length) >= ${WINDOW}) {
      this.trim = Math.max(0, this.low - ${MARGIN});
      this.low = Infinity; this.counted = 0;
    }
    const hearing = level > 0.02;
    if (hearing !== this.hearing) { this.hearing = hearing; this.port.postMessage(hearing); }
    return true;
  }
}
registerProcessor('sp-capture', Capture);
registerProcessor('sp-playback', Playback);
`;

/** Loudness that counts as speech for the timing stats (PCM16 peak). */
const LOUD = 1600;
const MAX_EDGES = 1024;

/**
 * Voice counters for simulation scripts: packets each way, and the times
 * (ms since epoch) speech started at this mic and started arriving from the
 * other side, so two pages on one machine can measure mouth-to-ear delay.
 */
export const voiceStats = { sent: 0, received: 0, sentEdges: [] as number[], heardEdges: [] as number[] };
let micLoud = false;

function edge(list: number[]): void {
  list.push(Date.now());
  if (list.length > MAX_EDGES) list.shift();
}

/**
 * Live voice: the person's microphone (only after they switch talking on) as
 * 16 kHz PCM packets, and the other person's voice played through a small
 * jitter buffer. Echo cancellation is left to the browser.
 */
export class LiveVoice {
  private ctx: AudioContext | null = null;
  private ready: Promise<void> | null = null;
  private playback: AudioWorkletNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private mic: MediaStream | null = null;
  /** The player stepped away (Quest menu, headset off): no talking or listening until they return. */
  private away = false;
  hearing = false;

  private async context(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: VOICE_RATE });
      const url = URL.createObjectURL(new Blob([WORKLETS], { type: 'application/javascript' }));
      this.ready = this.ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    }
    await this.ready;
    if (this.ctx.state === 'suspended' && !this.away) await this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  /** Open the microphone and stream packets to `onChunk`. */
  async startMic(onChunk: (pcm: Int16Array) => void): Promise<void> {
    if (this.mic) return;
    const ctx = await this.context();
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.source = ctx.createMediaStreamSource(this.mic);
    this.capture = new AudioWorkletNode(ctx, 'sp-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    this.capture.port.onmessage = (e) => {
      const pcm = e.data as Int16Array;
      let peak = 0;
      for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
      if (peak > LOUD !== micLoud) {
        micLoud = peak > LOUD;
        if (micLoud) edge(voiceStats.sentEdges);
      }
      voiceStats.sent++;
      onChunk(pcm);
    };
    this.source.connect(this.capture);
  }

  stopMic(): void {
    this.source?.disconnect();
    this.capture?.port.close();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.source = null;
    this.capture = null;
    this.mic = null;
  }

  get micOpen(): boolean {
    return this.mic !== null;
  }

  /**
   * Pause both directions while the player is away: the suspended context stops
   * the microphone being sent and the other voice being played. What the other
   * person says meanwhile is dropped, not saved up.
   */
  setAway(isAway: boolean): void {
    this.away = isAway;
    if (!this.ctx) return;
    if (isAway) void this.ctx.suspend().catch(() => undefined);
    else void this.ctx.resume().catch(() => undefined);
  }

  /** Queue the other person's voice. */
  play(pcm: Int16Array): void {
    voiceStats.received++;
    if (this.away) return;
    if (this.playback) {
      this.playback.port.postMessage(pcm);
      return;
    }
    // First packet: set up the player, then queue (one packet may be dropped while it loads).
    void this.context().then((ctx) => {
      if (this.playback || !this.ctx) return;
      this.playback = new AudioWorkletNode(ctx, 'sp-playback', { numberOfInputs: 0, outputChannelCount: [1] });
      this.playback.port.onmessage = (e) => {
        this.hearing = Boolean(e.data);
        if (this.hearing) edge(voiceStats.heardEdges);
      };
      this.playback.connect(ctx.destination);
      this.playback.port.postMessage(pcm);
    });
  }

  dispose(): void {
    this.stopMic();
    this.playback?.disconnect();
    this.playback = null;
    this.hearing = false;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.ready = null;
  }
}
