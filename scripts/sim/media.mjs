// Fake microphone audio for simulated family members (Chrome --use-file-for-fake-audio-capture).
// beeps.wav: a 1 kHz beep (250 ms) every 2 s: sharp onsets for measuring voice delay.
// speech-<name>.wav: a spoken line from macOS text-to-speech, when `say` is available.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MEDIA_DIR = join(process.cwd(), 'node_modules/.cache/shadowplay-sim');

function wav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export function beeps() {
  const file = join(MEDIA_DIR, 'beeps.wav');
  if (existsSync(file)) return file;
  mkdirSync(MEDIA_DIR, { recursive: true });
  const rate = 48000, seconds = 20, out = new Float32Array(rate * seconds);
  for (let i = 0; i < out.length; i++) {
    const t = (i / rate) % 2;
    out[i] = t < 0.25 ? Math.sin(2 * Math.PI * 1000 * (i / rate)) * 0.6 : 0;
  }
  writeFileSync(file, wav(out, rate));
  return file;
}

export function speech(name, text) {
  const file = join(MEDIA_DIR, `speech-${name}.wav`);
  if (existsSync(file)) return file;
  mkdirSync(MEDIA_DIR, { recursive: true });
  try {
    const aiff = file.replace(/\.wav$/, '.aiff');
    execFileSync('say', ['-o', aiff, text]);
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@48000', '-c', '1', aiff, file]);
    return file;
  } catch {
    return beeps();
  }
}
