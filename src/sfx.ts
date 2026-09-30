/**
 * Placeholder sound effects synthesised with Web Audio (no audio files, so no
 * licensing). Replace with commissioned audio later. The context is created
 * lazily and resumed on use; entering XR counts as the required user gesture.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, duration: number, gain: number, type: OscillatorType = 'sine'): void {
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
  osc.connect(amp).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/** Lamp switch click. */
export function playClick(): void {
  tone(1800, 0, 0.03, 0.12, 'square');
  tone(900, 0.012, 0.04, 0.08, 'square');
}

/** Music-box chime when a creature comes alive. */
export function playChime(): void {
  tone(1046.5, 0, 0.9, 0.12);
  tone(1318.5, 0.09, 0.9, 0.1);
  tone(1568, 0.18, 1.2, 0.09);
}

/** Soft rising note when a beat the player caused completes. */
export function playSoftRise(): void {
  tone(523.25, 0, 0.5, 0.06, 'triangle');
  tone(784, 0.12, 0.7, 0.05, 'triangle');
}
