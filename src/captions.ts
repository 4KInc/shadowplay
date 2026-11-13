import {
  CanvasTexture,
  createSystem,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { CAPTION_H, CAPTION_W, drawCaption, drawHandHint, HINT_SIZE } from './caption-art.js';
import { ShapeRecognizer, StoryState } from './shadowplay-components.js';
import { stageRuntime, trackingRuntime } from './stage-runtime.js';

const FADE_PER_SECOND = 4;
const NUDGE_W = 1024;
const NUDGE_H = 120;
/** Hands keep dropping out of tracking during a shape request (usually too little light). */
const LIGHT_HINT = 'Hands lost — try turning a light on';

const NUDGE_TEXT: Record<string, string> = {
  almost: 'Almost! Hold it still...',
  light: 'Bring your hand into the lamplight.',
};

/** A small amber pill with one short line (recognition nudges). */
function drawNudge(g: CanvasRenderingContext2D, text: string): void {
  g.clearRect(0, 0, NUDGE_W, NUDGE_H);
  if (!text) return;
  g.font = 'italic 600 48px Georgia, "Times New Roman", serif';
  const w = Math.min(NUDGE_W - 8, g.measureText(text).width + 80);
  const x = (NUDGE_W - w) / 2;
  g.fillStyle = 'rgba(224, 162, 74, 0.92)';
  g.beginPath();
  g.roundRect(x, 12, w, NUDGE_H - 24, (NUDGE_H - 24) / 2);
  g.fill();
  g.fillStyle = '#1a1320';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, NUDGE_W / 2, NUDGE_H / 2 + 2);
}

function canvasQuad(width: number, height: number, name: string) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(1, 1), material);
  mesh.name = name;
  mesh.renderOrder = 20;
  return { canvas, g: canvas.getContext('2d')!, texture, material, mesh };
}

/**
 * Narration captions at the bottom of the stage (never at the edges of view),
 * cross-faded when the text changes, plus the 'show me' ghost-hand hint.
 */
export class CaptionSystem extends createSystem({
  stories: { required: [StoryState] },
  recognizers: { required: [ShapeRecognizer] },
}) {
  private caption = canvasQuad(CAPTION_W, CAPTION_H, 'story-caption');
  private hint = canvasQuad(HINT_SIZE, HINT_SIZE, 'show-me-hint');
  private nudge = canvasQuad(NUDGE_W, NUDGE_H, 'recognition-nudge');
  private nudgeShown = '';
  private nudgeLevel = 0;
  private shown = '';
  private pending = '';
  private hintLevel = 0;
  private time = 0;
  private quat = new Quaternion();
  private yAxis = new Vector3(0, 1, 0);
  private attached = false;
  private hintShape = '';

  init(): void {
    this.cleanupFuncs.push(() => {
      for (const q of [this.caption, this.hint, this.nudge]) {
        q.mesh.removeFromParent();
        q.texture.dispose();
        q.material.dispose();
        q.mesh.geometry.dispose();
      }
    });
  }

  update(delta: number): void {
    this.time += delta;
    const story = this.queries.stories.entities.values().next().value;
    const root = story?.object3D;
    if (!story || !root) return;
    if (!this.attached) {
      root.add(this.caption.mesh, this.hint.mesh, this.nudge.mesh);
      this.attached = true;
    }
    root.visible = stageRuntime.ready;
    if (!stageRuntime.ready) return;

    // Follow the stage: the story root sits on the stage plane, facing the player.
    const n = stageRuntime.normal;
    root.quaternion.copy(this.quat.setFromAxisAngle(this.yAxis, Math.atan2(n.x, n.z)));
    root.position.copy(stageRuntime.center).addScaledVector(n, 0.02);

    this.updateCaption(story.getValue(StoryState, 'caption') ?? '', delta);
    const shape = story.getValue(StoryState, 'hintShape') ?? 'rabbit';
    if (shape !== this.hintShape) {
      this.hintShape = shape;
      drawHandHint(this.hint.g, shape);
      this.hint.texture.needsUpdate = true;
    }
    this.updateHint(Boolean(story.getValue(StoryState, 'hintVisible')), delta);
    const rec = this.queries.recognizers.entities.values().next().value;
    const nudge = trackingRuntime.lightHint ? LIGHT_HINT : (NUDGE_TEXT[rec?.getValue(ShapeRecognizer, 'nudge') ?? 'none'] ?? '');
    this.updateNudge(nudge, delta);
  }

  /** The recognition nudge sits just above the caption, fading in and out. */
  private updateNudge(text: string, delta: number): void {
    if (text && text !== this.nudgeShown) {
      this.nudgeShown = text;
      drawNudge(this.nudge.g, text);
      this.nudge.texture.needsUpdate = true;
    }
    const target = text ? 1 : 0;
    this.nudgeLevel += Math.sign(target - this.nudgeLevel) * Math.min(Math.abs(target - this.nudgeLevel), delta * FADE_PER_SECOND);
    this.nudge.material.opacity = this.nudgeLevel;
    const w = stageRuntime.width * 0.5;
    const h = (w * NUDGE_H) / NUDGE_W;
    this.nudge.mesh.scale.set(w, h, 1);
    this.nudge.mesh.position.set(0, -stageRuntime.height * 0.5 + h * 0.9, 0.003);
    this.nudge.mesh.visible = this.nudgeLevel > 0.001;
  }

  private updateCaption(text: string, delta: number): void {
    const m = this.caption.material;
    this.pending = text;
    if (this.pending !== this.shown) {
      m.opacity = Math.max(0, m.opacity - delta * FADE_PER_SECOND);
      if (m.opacity === 0) {
        this.shown = this.pending;
        drawCaption(this.caption.g, this.shown);
        this.caption.texture.needsUpdate = true;
      }
    } else if (this.shown) {
      m.opacity = Math.min(1, m.opacity + delta * FADE_PER_SECOND);
    }
    const w = stageRuntime.width * 0.95;
    const h = (w * CAPTION_H) / CAPTION_W;
    this.caption.mesh.scale.set(w, h, 1);
    this.caption.mesh.position.set(0, -stageRuntime.height * 0.5 - h * 0.2, 0);
    this.caption.mesh.visible = m.opacity > 0.001;
  }

  private updateHint(visible: boolean, delta: number): void {
    const target = visible ? 1 : 0;
    this.hintLevel += Math.sign(target - this.hintLevel) * Math.min(Math.abs(target - this.hintLevel), delta * 2);
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 2.4);
    this.hint.material.opacity = this.hintLevel * pulse;
    const size = stageRuntime.height * 0.8;
    this.hint.mesh.scale.set(size, size, 1);
    this.hint.mesh.position.set(
      -stageRuntime.width * 0.3,
      Math.sin(this.time * 1.6) * size * 0.03,
      0.002,
    );
    this.hint.mesh.visible = this.hintLevel > 0.001;
  }
}
