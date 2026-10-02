/**
 * Silhouette masks for recognition method 2. A rendered shadow (RGBA, square)
 * is cropped to its bounding box and resampled into a NORM x NORM binary grid
 * with its aspect ratio preserved, so position and size on the wall don't
 * matter, only the shape. Masks are compared by intersection over union.
 */
export const NORM = 32;
export const NORM_CELLS = NORM * NORM;

export interface SilhouetteTemplate {
  shape: string;
  /** NORM*NORM bits as hex, row-major, top row first. */
  mask: string;
  source: 'recorded' | 'bundled';
}

/**
 * Normalise an RGBA buffer into `out` (0/1 per cell). Returns the number of
 * lit source pixels (0 when there is no shadow to compare).
 */
export function normalizeMask(rgba: Uint8Array, size: number, out: Uint8Array): number {
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (rgba[(y * size + x) * 4] > 127) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  out.fill(0);
  if (count === 0) return 0;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const side = Math.max(w, h);
  // Centre the box in a square so the aspect ratio survives the resample.
  const ox = minX - (side - w) / 2;
  const oy = minY - (side - h) / 2;
  for (let cy = 0; cy < NORM; cy++) {
    // WebGL rows run bottom-up; flip so row 0 of the mask is the top.
    const sy = Math.floor(oy + ((NORM - 1 - cy) + 0.5) * (side / NORM));
    for (let cx = 0; cx < NORM; cx++) {
      const sx = Math.floor(ox + (cx + 0.5) * (side / NORM));
      if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
      out[cy * NORM + cx] = rgba[(sy * size + sx) * 4] > 127 ? 1 : 0;
    }
  }
  return count;
}

export function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < NORM_CELLS; i++) {
    const x = a[i];
    const y = b[i];
    inter += x & y;
    union += x | y;
  }
  return union === 0 ? 0 : inter / union;
}

export function encodeMask(mask: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < NORM_CELLS; i += 4) {
    hex += ((mask[i] << 3) | (mask[i + 1] << 2) | (mask[i + 2] << 1) | mask[i + 3]).toString(16);
  }
  return hex;
}

export function decodeMask(hex: string, out = new Uint8Array(NORM_CELLS)): Uint8Array {
  for (let i = 0; i < hex.length && i * 4 < NORM_CELLS; i++) {
    const v = parseInt(hex[i], 16);
    out[i * 4] = (v >> 3) & 1;
    out[i * 4 + 1] = (v >> 2) & 1;
    out[i * 4 + 2] = (v >> 1) & 1;
    out[i * 4 + 3] = v & 1;
  }
  return out;
}
