import { ShapeIds } from './shadowplay-components.js';

/** Every Shadow Journal page, in book order. Hidden ones show as '?' until found. */
export const CREATURES: readonly { id: string; name: string; rig: string | null }[] = [
  { id: 'rabbit', name: 'Rabbit', rig: ShapeIds.Rabbit },
  { id: 'fish', name: 'Fish', rig: ShapeIds.Fish },
  { id: 'dog', name: 'Dog', rig: ShapeIds.Dog },
  { id: 'bird', name: 'Bird', rig: ShapeIds.Bird },
  { id: 'snail', name: 'Snail', rig: ShapeIds.Snail },
  { id: 'swan', name: 'Swan', rig: ShapeIds.Swan },
  { id: 'deer', name: 'Deer', rig: ShapeIds.Deer },
  { id: 'crocodile', name: 'Crocodile', rig: ShapeIds.Crocodile },
];

export const PAGE_W = 1024;
export const PAGE_H = 640;
export const SLOT_COLUMNS = 4;

/** Slot centre in page pixels. */
export function slotCenter(index: number): { x: number; y: number } {
  const col = index % SLOT_COLUMNS;
  const row = Math.floor(index / SLOT_COLUMNS);
  return { x: 140 + col * 248, y: 215 + row * 230 };
}

/** Paper page with title, slot frames and labels (silhouettes are 3D overlays). */
export function drawJournalPage(g: CanvasRenderingContext2D, discovered: ReadonlySet<string>): void {
  const grad = g.createRadialGradient(PAGE_W / 2, PAGE_H / 2, 80, PAGE_W / 2, PAGE_H / 2, 620);
  grad.addColorStop(0, '#f3e6c8');
  grad.addColorStop(1, '#d9c294');
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(0, 0, PAGE_W, PAGE_H, 28);
  g.fill();

  g.fillStyle = '#2a2036';
  g.textAlign = 'center';
  g.font = 'italic 600 52px Georgia, "Times New Roman", serif';
  g.fillText('Shadow Journal', PAGE_W / 2, 72);
  g.font = 'italic 400 28px Georgia, serif';
  const found = CREATURES.filter((c) => discovered.has(c.id)).length;
  g.fillText(`${found} of ${CREATURES.length} creatures found`, PAGE_W / 2, 112);

  CREATURES.forEach((c, i) => {
    const { x, y } = slotCenter(i);
    g.strokeStyle = 'rgba(42, 32, 54, 0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(x - 105, y - 80, 210, 160, 18);
    g.stroke();
    const known = discovered.has(c.id);
    g.fillStyle = known ? '#2a2036' : 'rgba(42, 32, 54, 0.45)';
    g.font = 'italic 500 30px Georgia, serif';
    g.fillText(known ? c.name : '? ? ?', x, y + 112);
    if (!known) {
      g.font = '600 90px Georgia, serif';
      g.fillStyle = 'rgba(42, 32, 54, 0.22)';
      g.fillText('?', x, y + 30);
    }
  });
}
