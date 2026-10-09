import { createSystem, Entity } from '@iwsdk/core';
import { FIXTURES } from './hand-poses.js';
import { RecognitionLab, ShapeRecognizer, WebcamHands } from './shadowplay-components.js';

const LABELS = [...new Set(FIXTURES.map((f) => f.label))];

/**
 * Development tools on top of the camera hands (dev builds only): keyboard
 * shortcuts for recognition-lab sessions with several people at one laptop
 * (W camera, L lab label, R record a trial, E export) and a small overlay
 * showing what each hand reads as.
 */
export class WebcamHandsSystem extends createSystem({
  webcams: { required: [WebcamHands] },
  labs: { required: [RecognitionLab] },
  recognizers: { required: [ShapeRecognizer] },
}) {
  private overlay: HTMLDivElement | null = null;
  private labelIndex = 0;

  init(): void {
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('keydown', onKey);
      this.overlay?.remove();
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat || e.metaKey || e.ctrlKey) return;
    const cam = first(this.queries.webcams.entities);
    const lab = first(this.queries.labs.entities);
    const key = e.key.toLowerCase();
    if (key === 'w' && cam) cam.setValue(WebcamHands, 'enabled', !cam.getValue(WebcamHands, 'enabled'));
    if (!lab) return;
    if (key === 'l') {
      this.labelIndex = (this.labelIndex + 1) % LABELS.length;
      lab.setValue(RecognitionLab, 'label', LABELS[this.labelIndex]);
    }
    if (key === 'r') lab.setValue(RecognitionLab, 'recording', true);
    if (key === 'e') lab.setValue(RecognitionLab, 'exportRequested', true);
  }

  update(): void {
    const cam = first(this.queries.webcams.entities);
    if (cam) this.updateOverlay(cam);
  }

  private updateOverlay(cam: Entity): void {
    const lab = first(this.queries.labs.entities);
    const rec = first(this.queries.recognizers.entities);
    const enabled = Boolean(cam.getValue(WebcamHands, 'enabled'));
    if (!enabled) {
      this.overlay?.remove();
      this.overlay = null;
      return;
    }
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      Object.assign(this.overlay.style, {
        position: 'fixed', left: '12px', bottom: '12px', zIndex: '1000', padding: '8px 10px',
        background: 'rgba(16,12,24,0.85)', color: '#f6e3bd', font: '12px/1.45 ui-monospace, monospace',
        borderRadius: '8px', whiteSpace: 'pre', pointerEvents: 'none',
      });
      document.body.appendChild(this.overlay);
    }
    const shape = (side: 'left' | 'right') =>
      rec?.getValue(ShapeRecognizer, side === 'left' ? 'leftShape' : 'rightShape') || '-';
    this.overlay.textContent = [
      `camera: ${cam.getValue(WebcamHands, 'status') || 'on'}  [W]`,
      `hands: left ${shape('left')}   right ${shape('right')}`,
      `lab label: ${lab?.getValue(RecognitionLab, 'label') || '(none)'}  [L]   record [R]   export [E]`,
      `${lab?.getValue(RecognitionLab, 'status') ?? ''}`,
    ].join('\n');
  }
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
