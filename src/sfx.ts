/**
 * Placeholder sound, synthesised with Web Audio (no audio files, so no
 * licensing). Replace with commissioned audio later. Sounds can be placed in
 * the room (HRTF panners) so they come from where things happen: chimes from
 * the character on the wall, the click and hum from the lamp on the desk. The
 * context is created lazily; entering XR counts as the required user gesture.
 */
import { away, onAway } from './away.js';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended' && !away.now) void ctx.resume();
  return ctx;
}

// Silence the lamp hum and effects while the player is away (Quest menu, headset off).
onAway((isAway) => {
  if (!ctx) return;
  if (isAway) void ctx.suspend().catch(() => undefined);
  else void ctx.resume().catch(() => undefined);
});

/** True once the browser lets audio play (after a user gesture such as entering XR). */
export function audioRunning(): boolean {
  return ctx?.state === 'running';
}

/** Where a sound goes: an HRTF panner at `pos`, or straight out when unplaced. */
function output(a: AudioContext, pos?: Point3): AudioNode {
  if (!pos) return a.destination;
  const panner = a.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 0.6;
  panner.rolloffFactor = 1;
  panner.positionX.value = pos.x;
  panner.positionY.value = pos.y;
  panner.positionZ.value = pos.z;
  panner.connect(a.destination);
  return panner;
}

function tone(freq: number, start: number, duration: number, gain: number, type: OscillatorType, pos?: Point3): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const amp = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp).connect(output(a, pos));
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/** Keep the Web Audio listener on the viewer's head. */
export function setListener(p: Point3, forward: Point3, up: Point3): void {
  if (!ctx || ctx.state !== 'running') return;
  const l = ctx.listener;
  if (l.positionX) {
    const t = ctx.currentTime;
    l.positionX.setTargetAtTime(p.x, t, 0.02);
    l.positionY.setTargetAtTime(p.y, t, 0.02);
    l.positionZ.setTargetAtTime(p.z, t, 0.02);
    l.forwardX.setTargetAtTime(forward.x, t, 0.02);
    l.forwardY.setTargetAtTime(forward.y, t, 0.02);
    l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
    l.upX.setTargetAtTime(up.x, t, 0.02);
    l.upY.setTargetAtTime(up.y, t, 0.02);
    l.upZ.setTargetAtTime(up.z, t, 0.02);
  } else {
    l.setPosition(p.x, p.y, p.z);
    l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}

/** Lamp switch click (from the lamp). */
export function playClick(pos?: Point3): void {
  tone(1800, 0, 0.03, 0.12, 'square', pos);
  tone(900, 0.012, 0.04, 0.08, 'square', pos);
}

/** Music-box chime when a creature comes alive (from the creature). */
export function playChime(pos?: Point3): void {
  tone(1046.5, 0, 0.9, 0.12, 'sine', pos);
  tone(1318.5, 0.09, 0.9, 0.1, 'sine', pos);
  tone(1568, 0.18, 1.2, 0.09, 'sine', pos);
}

/** Soft rising note when a page is added to the journal. */
export function playSoftRise(pos?: Point3): void {
  tone(523.25, 0, 0.5, 0.06, 'triangle', pos);
  tone(784, 0.12, 0.7, 0.05, 'triangle', pos);
}

const MUSIC_BOX = [659.25, 783.99, 987.77, 783.99, 880, 659.25, 587.33, 783.99];

/** One note of the placeholder Free Stage music-box loop (from the stage). */
export function playMusicBoxNote(step: number, pos?: Point3): void {
  tone(MUSIC_BOX[step % MUSIC_BOX.length], 0, 1.4, 0.035, 'sine', pos);
}

export interface Hum {
  setPosition(p: Point3): void;
  /** 0..1 lamp brightness. */
  setLevel(level: number): void;
}

/** The lamp's faint warm hum: two quiet sines through one panner at the bulb. */
export function startLampHum(): Hum | null {
  const a = audio();
  if (!a || a.state !== 'running') return null;
  const panner = output(a, { x: 0, y: 0, z: 0 }) as PannerNode;
  const amp = a.createGain();
  amp.gain.value = 0;
  amp.connect(panner);
  for (const [freq, g] of [
    [110, 1],
    [220, 0.35],
  ] as const) {
    const osc = a.createOscillator();
    const og = a.createGain();
    osc.frequency.value = freq;
    og.gain.value = g;
    osc.connect(og).connect(amp);
    osc.start();
  }
  return {
    setPosition(p) {
      const t = a.currentTime;
      panner.positionX.setTargetAtTime(p.x, t, 0.05);
      panner.positionY.setTargetAtTime(p.y, t, 0.05);
      panner.positionZ.setTargetAtTime(p.z, t, 0.05);
    },
    setLevel(level) {
      amp.gain.setTargetAtTime(0.012 * level, a.currentTime, 0.3);
    },
  };
}
