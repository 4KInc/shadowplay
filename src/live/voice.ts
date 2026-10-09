import { VOICE_RATE } from './protocol.js';

/** 20 ms of audio per packet. */
const CHUNK = VOICE_RATE / 50;
/** Playback waits for this much audio before starting (and after running dry): a small jitter buffer. */
const PRIME = VOICE_RATE / 10;

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
class Playback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(${VOICE_RATE * 2});
    this.read = 0; this.write = 0; this.size = 0; this.primed = false; this.hearing = false;
    this.port.onmessage = (e) => {
      const pcm = e.data;
      for (let i = 0; i < pcm.length; i++) {
        if (this.size === this.ring.length) { this.read = (this.read + 1) % this.ring.length; this.size--; }
        this.ring[this.write] = pcm[i] / 0x8000;
        this.write = (this.write + 1) % this.ring.length;
        this.size++;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!this.primed && this.size >= ${PRIME}) this.primed = true;
    let level = 0;
    for (let i = 0; i < out.length; i++) {
      if (this.primed && this.size > 0) {
        out[i] = this.ring[this.read];
        this.read = (this.read + 1) % this.ring.length;
        this.size--;
        level = Math.max(level, Math.abs(out[i]));
      } else {
        out[i] = 0;
        this.primed = false;
      }
    }
    const hearing = level > 0.02;
    if (hearing !== this.hearing) { this.hearing = hearing; this.port.postMessage(hearing); }
    return true;
  }
}
registerProcessor('sp-capture', Capture);
registerProcessor('sp-playback', Playback);
`;

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
  hearing = false;

  private async context(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: VOICE_RATE });
      const url = URL.createObjectURL(new Blob([WORKLETS], { type: 'application/javascript' }));
      this.ready = this.ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    }
    await this.ready;
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
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
    this.capture.port.onmessage = (e) => onChunk(e.data as Int16Array);
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

  /** Queue the other person's voice. */
  play(pcm: Int16Array): void {
    if (this.playback) {
      this.playback.port.postMessage(pcm);
      return;
    }
    // First packet: set up the player, then queue (one packet may be dropped while it loads).
    void this.context().then((ctx) => {
      if (this.playback || !this.ctx) return;
      this.playback = new AudioWorkletNode(ctx, 'sp-playback', { numberOfInputs: 0, outputChannelCount: [1] });
      this.playback.port.onmessage = (e) => (this.hearing = Boolean(e.data));
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
