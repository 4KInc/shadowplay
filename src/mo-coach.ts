import {
  CanvasTexture,
  createSystem,
  Entity,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { coachFacts, localLine } from './coach-facts.js';
import { Moth, Settings, ShapeRecognizer, StoryState, StoryStatuses } from './shadowplay-components.js';
import { accessRuntime, handRuntime, stageRuntime } from './stage-runtime.js';

/** Seconds into a shape request when Mo offers each tip (at most three per request). */
const TIP_AT = [9, 21, 33] as const;
/** How long a tip stays up, seconds. */
const TIP_SECONDS = 6;
const W = 1024;
const H = 320;

/** For tests and diagnostics: Mo's last tip, where it came from, and how many so far. */
export const coachRuntime = { line: '', source: '' as '' | 'ai' | 'local', tips: 0, facts: [] as string[], ms: 0 };

function drawBubble(g: CanvasRenderingContext2D, text: string, highContrast: boolean): void {
  g.clearRect(0, 0, W, H);
  if (!text) return;
  g.font = highContrast ? '700 54px "Helvetica Neue", Arial, sans-serif' : 'italic 600 54px Georgia, "Times New Roman", serif';
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > W - 120 && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 3);
  const lineH = 62;
  const boxH = shown.length * lineH + 40;
  const boxW = Math.min(W - 20, Math.max(...shown.map((l) => g.measureText(l).width)) + 80);
  const x = 10;
  const y = H - boxH - 34;
  g.fillStyle = highContrast ? '#000000' : 'rgba(246, 227, 189, 0.95)';
  g.strokeStyle = highContrast ? '#ffffff' : '#b8863b';
  g.lineWidth = highContrast ? 5 : 3;
  g.beginPath();
  g.roundRect(x, y, boxW, boxH, 28);
  // The tail, pointing down-left toward Mo.
  g.moveTo(x + 40, y + boxH);
  g.lineTo(x + 18, H - 4);
  g.lineTo(x + 78, y + boxH);
  g.fill();
  g.stroke();
  g.fillStyle = highContrast ? '#ffffff' : '#1a1320';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  shown.forEach((l, i) => g.fillText(l, x + 40, y + 20 + lineH * (i + 0.5)));
}

/**
 * Mo the coach (an agent in the story): watches a shape request, and when the
 * player is stuck she flies in with one short tip about what to change ("curl
 * your ring finger down"), in a speech bubble beside her on the stage. What she
 * knows comes from the hand tracker (coach-facts.ts: the shape and a few fixed
 * fact ids, nothing about the person); the words are written by Claude on the
 * server when it is available there (/api/coach), or by the app itself.
 * Saying "help" with voice commands asks her at once.
 */
export class MoCoachSystem extends createSystem({
  stories: { required: [StoryState] },
  recognizers: { required: [ShapeRecognizer] },
  moths: { required: [Moth] },
  settings: { required: [Settings] },
}) {
  private canvas = document.createElement('canvas');
  private g = this.canvas.getContext('2d')!;
  private texture = new CanvasTexture(this.canvas);
  private material = new MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0, depthWrite: false });
  private bubble = new Mesh(new PlaneGeometry(1, H / W), this.material);
  private entity: Entity | undefined;
  private beat = '';
  private waited = 0;
  private given = 0;
  private showFor = 0;
  private asking = false;
  private generation = 0;
  /** null until /api/coach has said whether AI tips are available here. */
  private aiAvailable: boolean | null = null;
  private drawnContrast = false;
  private mothPos = new Vector3();
  private quat = new Quaternion();
  private yAxis = new Vector3(0, 1, 0);

  init(): void {
    this.canvas.width = W;
    this.canvas.height = H;
    this.texture.colorSpace = SRGBColorSpace;
    this.bubble.name = 'mo-tip';
    this.bubble.renderOrder = 22;
    this.bubble.visible = false;
    this.entity = this.world.createTransformEntity(this.bubble);
    fetch('/api/coach')
      .then((r) => (r.ok ? (r.json() as Promise<{ available?: boolean }>) : { available: false }))
      .then((s) => (this.aiAvailable = Boolean(s.available)))
      .catch(() => (this.aiAvailable = false));
    this.cleanupFuncs.push(() => {
      this.texture.dispose();
      this.material.dispose();
      this.bubble.geometry.dispose();
      this.entity?.dispose();
    });
  }

  update(delta: number): void {
    const story = this.queries.stories.entities.values().next().value as Entity | undefined;
    const rec = this.queries.recognizers.entities.values().next().value as Entity | undefined;
    if (!story || !rec) return;
    const beat = story.getValue(StoryState, 'beatId') ?? '';
    if (beat !== this.beat) {
      this.beat = beat;
      this.waited = 0;
      this.given = 0;
      this.generation++;
      this.asking = false;
      this.showFor = Math.min(this.showFor, 0.6);
    }
    const target = rec.getValue(ShapeRecognizer, 'target') ?? 'none';
    const waiting = target !== 'none' && story.getValue(StoryState, 'status') === StoryStatuses.Playing && rec.getValue(ShapeRecognizer, 'matchedHand') === 'none';
    if (waiting) this.waited += delta;
    const due = this.given < TIP_AT.length && this.waited >= TIP_AT[this.given];
    if (waiting && !this.asking && (due || accessRuntime.coachRequested)) this.ask(target, story, rec);
    accessRuntime.coachRequested = false;

    this.showFor = Math.max(0, this.showFor - delta);
    const target01 = this.showFor > 0 && stageRuntime.ready ? 1 : 0;
    this.material.opacity += Math.sign(target01 - this.material.opacity) * Math.min(Math.abs(target01 - this.material.opacity), delta * 3);
    this.bubble.visible = this.material.opacity > 0.01;
    if (accessRuntime.highContrast !== this.drawnContrast) {
      this.drawnContrast = accessRuntime.highContrast;
      drawBubble(this.g, coachRuntime.line, this.drawnContrast);
      this.texture.needsUpdate = true;
    }
    if (this.bubble.visible) this.place();
  }

  /** Ask for one tip about the shape being requested. */
  private ask(target: string, story: Entity, rec: Entity): void {
    const shape = story.getValue(StoryState, 'hintShape') || target;
    const oneHand = Boolean(rec.getValue(ShapeRecognizer, 'oneHand'));
    const facts = coachFacts(shape, handRuntime.left, handRuntime.right, oneHand);
    const attempt = this.given++;
    const generation = this.generation;
    const t0 = performance.now();
    const say = (line: string, source: 'ai' | 'local') => {
      this.asking = false;
      if (generation !== this.generation) return;
      coachRuntime.line = line;
      coachRuntime.source = source;
      coachRuntime.facts = facts;
      coachRuntime.ms = Math.round(performance.now() - t0);
      coachRuntime.tips++;
      drawBubble(this.g, line, accessRuntime.highContrast);
      this.texture.needsUpdate = true;
      this.showFor = TIP_SECONDS;
    };
    this.asking = true;
    if (!this.aiAvailable) return say(localLine(shape, facts), 'local');
    fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shape, facts, attempt }),
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ line?: string; source?: 'ai' | 'local' }>) : null))
      .then((r) => (r?.line ? say(r.line, r.source === 'ai' ? 'ai' : 'local') : say(localLine(shape, facts), 'local')))
      .catch(() => say(localLine(shape, facts), 'local'));
  }

  /** Beside Mo, on the stage, facing the player (above the stage centre if Mo is away). */
  private place(): void {
    const moth = this.queries.moths.entities.values().next().value as Entity | undefined;
    const mo = moth?.object3D;
    const r = stageRuntime;
    if (mo && mo.visible) mo.getWorldPosition(this.mothPos);
    else this.mothPos.copy(r.center).addScaledVector(r.up, r.height * 0.15);
    // About as large as the captions: ~4 cm letters on a wall 2 m away.
    const w = r.width * 0.7;
    this.bubble.scale.setScalar(w);
    this.bubble.position
      .copy(this.mothPos)
      .addScaledVector(r.right, w * 0.5 + r.width * 0.02)
      .addScaledVector(r.up, w * (H / W) * 0.5 + r.height * 0.03)
      .addScaledVector(r.normal, 0.03);
    this.bubble.quaternion.copy(this.quat.setFromAxisAngle(this.yAxis, Math.atan2(r.normal.x, r.normal.z)));
  }
}
