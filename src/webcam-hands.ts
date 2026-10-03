import { createSystem, Entity, Vector3 } from '@iwsdk/core';
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { FIXTURES } from './hand-poses.js';
import { RecognitionLab, ShapeRecognizer, WebcamHands } from './shadowplay-components.js';
import { handOverride, JOINT_COUNT, stageRuntime } from './stage-runtime.js';
import { Landmark, landmarksToJoints } from './webcam-landmarks.js';

/** Development tool only: registered in dev builds, never shipped. */
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const DETECT_INTERVAL_MS = 33;
/** A hand not seen for this long counts as untracked. */
const LOST_MS = 300;
/** Typical wrist-to-middle-knuckle size in the image, for depth from apparent size. */
const NEUTRAL_SIZE = 0.18;
const LABELS = [...new Set(FIXTURES.map((f) => f.label))];

/**
 * Drives the hands from the laptop webcam so real people can test recognition
 * and record silhouette templates without a headset. Keys (dev builds):
 * W toggle webcam, L cycle lab label, R record a trial, E export the report.
 */
export class WebcamHandsSystem extends createSystem({
  webcams: { required: [WebcamHands] },
  labs: { required: [RecognitionLab] },
  recognizers: { required: [ShapeRecognizer] },
}) {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private overlay: HTMLDivElement | null = null;
  private starting = false;
  private lastDetect = 0;
  private seenAt = { left: 0, right: 0 };
  private joints = { left: new Float32Array(JOINT_COUNT * 3), right: new Float32Array(JOINT_COUNT * 3) };
  private anchor = new Vector3();
  private wrist = new Vector3();
  private labelIndex = 0;

  init(): void {
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('keydown', onKey);
      this.shutdown();
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
    if (!cam) return;
    const enabled = Boolean(cam.getValue(WebcamHands, 'enabled'));
    if (enabled && !this.landmarker && !this.starting) void this.startup(cam);
    if (!enabled && (this.landmarker || this.stream)) this.shutdown();
    this.updateOverlay(cam);
    if (!enabled || !this.landmarker || !this.video || this.video.readyState < 2) return;

    const now = performance.now();
    if (now - this.lastDetect < DETECT_INTERVAL_MS) return;
    this.lastDetect = now;
    const result = this.landmarker.detectForVideo(this.video, now);
    let seen = 0;
    result.worldLandmarks.forEach((world, i) => {
      // MediaPipe labels handedness for a mirrored (selfie) image; ours is not.
      const label = result.handedness[i]?.[0]?.categoryName;
      const side = label === 'Left' ? 'right' : 'left';
      this.place(side, world, result.landmarks[i]);
      this.seenAt[side] = now;
      seen++;
    });
    handOverride.active = true;
    handOverride.source = 'webcam';
    handOverride.left = now - this.seenAt.left < LOST_MS ? this.joints.left : null;
    handOverride.right = now - this.seenAt.right < LOST_MS ? this.joints.right : null;
    cam.setValue(WebcamHands, 'handsSeen', seen);
  }

  /** Put a detected hand in the lamp light, where image position and size say it is. */
  private place(side: 'left' | 'right', world: Landmark[], image: Landmark[]): void {
    if (!stageRuntime.ready) return;
    const r = stageRuntime.right;
    const u = stageRuntime.up;
    const n = stageRuntime.normal;
    this.anchor.copy(stageRuntime.bulb).lerp(stageRuntime.poolCenter, 0.22).addScaledVector(u, -0.06);
    const size = Math.hypot(image[9].x - image[0].x, image[9].y - image[0].y);
    // Bigger in the image = closer to the camera = nearer the wall, further from the lamp.
    const depth = Math.max(-0.15, Math.min(0.15, -(size - NEUTRAL_SIZE) * 0.8));
    this.wrist
      .copy(this.anchor)
      .addScaledVector(r, -(image[0].x - 0.5) * 0.35)
      .addScaledVector(u, -(image[0].y - 0.5) * 0.35)
      .addScaledVector(n, depth);
    landmarksToJoints(world, this.wrist, r, u, n, this.joints[side]);
  }

  private async startup(cam: Entity): Promise<void> {
    this.starting = true;
    cam.setValue(WebcamHands, 'status', 'Starting webcam...');
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(
        `${import.meta.env.BASE_URL}node_modules/@mediapipe/tasks-vision/wasm`,
      );
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
      });
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      // Turned off while the camera permission prompt was open: release it.
      if (!cam.getValue(WebcamHands, 'enabled')) {
        this.shutdown();
        return;
      }
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = this.stream;
      Object.assign(video.style, {
        position: 'fixed', right: '12px', bottom: '12px', width: '200px', zIndex: '1000',
        transform: 'scaleX(-1)', borderRadius: '8px', border: '2px solid #b8863b',
      });
      document.body.appendChild(video);
      await video.play();
      this.video = video;
      cam.setValue(WebcamHands, 'status', 'Webcam hands on. Hold your hands up to the camera.');
    } catch (error) {
      cam.setValue(WebcamHands, 'enabled', false);
      cam.setValue(WebcamHands, 'status', `Webcam unavailable: ${(error as Error).message}`);
      this.shutdown();
    } finally {
      this.starting = false;
    }
  }

  private shutdown(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video?.remove();
    this.video = null;
    this.landmarker?.close();
    this.landmarker = null;
    if (handOverride.source === 'webcam') {
      handOverride.active = false;
      handOverride.left = handOverride.right = null;
    }
  }

  /** Small dev overlay: webcam status, lab label/status, and what each hand reads as. */
  private updateOverlay(cam: Entity): void {
    const lab = first(this.queries.labs.entities);
    const rec = first(this.queries.recognizers.entities);
    const enabled = Boolean(cam.getValue(WebcamHands, 'enabled'));
    if (!enabled && !this.overlay) return;
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
      `webcam: ${cam.getValue(WebcamHands, 'status') || (enabled ? 'on' : 'off')}  [W]`,
      `hands: left ${shape('left')}   right ${shape('right')}`,
      `lab label: ${lab?.getValue(RecognitionLab, 'label') || '(none)'}  [L]   record [R]   export [E]`,
      `${lab?.getValue(RecognitionLab, 'status') ?? ''}`,
    ].join('\n');
    if (!enabled && this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
