/**
 * Canvas drawing for stage captions and the 'show me' ghost hand. Kept free of
 * ECS so the art can be tweaked in isolation.
 */
export const CAPTION_W = 1024;
export const CAPTION_H = 192;

const FONT = 'italic 500 50px Georgia, "Times New Roman", serif';

function wrap(g: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u)) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/** Warm serif caption on a soft dark backing, legible on any real wall. */
export function drawCaption(g: CanvasRenderingContext2D, text: string): void {
  g.clearRect(0, 0, CAPTION_W, CAPTION_H);
  if (!text) return;
  g.font = FONT;
  const lines = wrap(g, text, CAPTION_W - 120);
  const lineH = 58;
  const blockH = lines.length * lineH + 36;
  const widest = Math.max(...lines.map((l) => g.measureText(l).width));
  const w = Math.min(CAPTION_W - 16, widest + 90);
  const x = (CAPTION_W - w) / 2;
  const y = (CAPTION_H - blockH) / 2;

  g.save();
  g.shadowColor = 'rgba(5, 3, 10, 0.9)';
  g.shadowBlur = 28;
  g.fillStyle = 'rgba(10, 7, 16, 0.72)';
  g.beginPath();
  g.roundRect(x, y, w, blockH, 30);
  g.fill();
  g.restore();

  g.fillStyle = '#f6e3bd';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    g.fillText(l, CAPTION_W / 2, y + 18 + lineH * (i + 0.5));
  });
}

export const HINT_SIZE = 512;

function capsule(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, r: number): void {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const nx = Math.cos(a + Math.PI / 2) * r;
  const ny = Math.sin(a + Math.PI / 2) * r;
  g.beginPath();
  g.moveTo(x1 + nx, y1 + ny);
  g.lineTo(x2 + nx, y2 + ny);
  g.arc(x2, y2, r, a + Math.PI / 2, a - Math.PI / 2, true);
  g.lineTo(x1 - nx, y1 - ny);
  g.arc(x1, y1, r, a - Math.PI / 2, a + Math.PI / 2, true);
  g.closePath();
  g.fill();
  g.stroke();
}

function ghostStyle(g: CanvasRenderingContext2D): void {
  g.lineWidth = 8;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255, 176, 84, 1)';
  g.fillStyle = 'rgba(255, 232, 196, 0.8)';
  g.shadowColor = 'rgba(255, 170, 80, 0.8)';
  g.shadowBlur = 24;
}

function hintLabel(g: CanvasRenderingContext2D, text: string): void {
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(246, 227, 189, 0.95)';
  g.font = 'italic 600 40px Georgia, serif';
  g.textAlign = 'center';
  g.fillText(text, 256, 40);
}

/** Flat hand seen from the side, fingers pointing right. */
function flatHand(g: CanvasRenderingContext2D, ox: number, oy: number, thumbUp: boolean): void {
  capsule(g, ox + 20, oy + 40, ox + 250, oy + 40, 36); // fingers together
  g.beginPath();
  g.roundRect(ox - 70, oy, 150, 100, 40); // palm
  g.fill();
  g.stroke();
  if (thumbUp) capsule(g, ox - 10, oy + 10, ox + 20, oy - 110, 22); // thumb up (ear)
  else capsule(g, ox - 20, oy + 70, ox + 120, oy + 70, 20); // thumb tucked
  capsule(g, ox - 110, oy + 50, ox - 60, oy + 50, 44); // wrist
}

/** Ghost hand demonstrating a shape (rabbit, fish, dog or the two-hand bird). */
export function drawHandHint(g: CanvasRenderingContext2D, shape: string): void {
  g.clearRect(0, 0, HINT_SIZE, HINT_SIZE);
  ghostStyle(g);
  if (shape === 'fish') {
    flatHand(g, 150, 220, false);
    hintLabel(g, 'flat, thumb tucked');
    return;
  }
  if (shape === 'dog') {
    flatHand(g, 150, 250, true);
    hintLabel(g, 'flat, thumb up');
    return;
  }
  if (shape === 'bird') {
    // Two open hands side by side, thumbs hooked together at the centre.
    for (const side of [-1, 1]) {
      const cx = 256 + side * 70;
      g.beginPath();
      g.roundRect(cx - 50, 300, 100, 110, 36);
      g.fill();
      g.stroke();
      for (let f = 0; f < 4; f++) {
        const bx = cx - 38 + f * 25;
        capsule(g, bx, 305, bx + side * (40 + f * 18), 130 + f * 12, 14);
      }
    }
    capsule(g, 200, 330, 312, 330, 16);
    hintLabel(g, 'two hands, side by side');
    return;
  }
  drawRabbitHand(g);
}

/**
 * Ghost hand demonstrating the rabbit: index + middle up as ears, ring and
 * pinky curled, thumb reaching across to touch them.
 */
function drawRabbitHand(g: CanvasRenderingContext2D): void {

  capsule(g, 222, 270, 196, 86, 25); // index (ear)
  capsule(g, 270, 262, 286, 70, 26); // middle (ear)
  g.beginPath();
  g.roundRect(170, 240, 170, 170, 60); // palm
  g.fill();
  g.stroke();
  capsule(g, 318, 280, 338, 330, 23); // ring, curled
  capsule(g, 340, 318, 350, 360, 20); // pinky, curled
  capsule(g, 178, 380, 320, 322, 24); // thumb meeting the ring finger
  capsule(g, 220, 400, 250, 490, 48); // wrist

  hintLabel(g, 'like this');
}
