import { createSystem, Entity, Vector3 } from '@iwsdk/core';
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { WebcamHands } from './shadowplay-components.js';
import { handOverride, JOINT_COUNT, secondHands, stageRuntime } from './stage-runtime.js';
import { Landmark, landmarksToJoints } from './webcam-landmarks.js';

/** Model and runtime are served from our own origin (no third-party CDN at runtime). */
const MODEL_PATH = 'models/hand_landmarker.task';
const RUNTIME_PATH = 'vendor/mediapipe';
const DETECT_INTERVAL_MS = 33;
/** A hand not seen for this long counts as untracked. */
const LOST_MS = 300;
/** Typical wrist-to-middle-knuckle size in the image, for depth from apparent size. */
const NEUTRAL_SIZE = 0.18;

/**
 * Camera hands: the front camera of a phone, tablet or laptop tracks the
 * viewer's hands (MediaPipe, on-device) and drives the stage's hands, so a
 * child without a headset can cast shadows and bring creatures to life.
 * Starts only when `WebcamHands.enabled` is set by a deliberate action;
 * camera frames never leave the device and nothing is recorded.
 */
export class CameraHandsSystem extends createSystem({
  webcams: { required: [WebcamHands] },
}) {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private starting = false;
  private lastDetect = 0;
  private seenAt = { left: 0, right: 0 };
  private joints = { left: new Float32Array(JOINT_COUNT * 3), right: new Float32Array(JOINT_COUNT * 3) };
  private anchor = new Vector3();
  private wrist = new Vector3();

  init(): void {
    this.cleanupFuncs.push(() => this.shutdown());
  }

  update(): void {
    const cam = first(this.queries.webcams.entities);
    if (!cam) return;
    const enabled = Boolean(cam.getValue(WebcamHands, 'enabled'));
    if (enabled && !this.landmarker && !this.starting) void this.startup(cam);
    if (!enabled && (this.landmarker || this.stream)) this.shutdown();
    if (!enabled || !this.landmarker || !this.video || this.video.readyState < 2) return;
    if (!handOverride.cameraAllowed) return;

    const now = performance.now();
    if (now - this.lastDetect < DETECT_INTERVAL_MS) return;
    this.lastDetect = now;
    const result = this.landmarker.detectForVideo(this.video, now);
    let seen = 0;
    result.worldLandmarks.forEach((world, i) => {
      // MediaPipe labels handedness for a mirrored (selfie) image; ours is not.
      const side = result.handedness[i]?.[0]?.categoryName === 'Left' ? 'right' : 'left';
      this.place(side, world, result.landmarks[i]);
      this.seenAt[side] = now;
      seen++;
    });
    const left = now - this.seenAt.left < LOST_MS ? this.joints.left : null;
    const right = now - this.seenAt.right < LOST_MS ? this.joints.right : null;
    if (handOverride.cameraTarget === 'second') {
      secondHands.left = left;
      secondHands.right = right;
    } else {
      handOverride.active = true;
      handOverride.source = 'camera';
      handOverride.left = left;
      handOverride.right = right;
    }
    if (cam.getValue(WebcamHands, 'handsSeen') !== seen) cam.setValue(WebcamHands, 'handsSeen', seen);
  }

  /** Put a detected hand in the lamp light, where image position and size say it is. */
  private place(side: 'left' | 'right', world: Landmark[], image: Landmark[]): void {
    if (!stageRuntime.ready) return;
    const r = stageRuntime.right;
    const u = stageRuntime.up;
    const n = stageRuntime.normal;
    this.anchor.copy(stageRuntime.bulb).lerp(stageRuntime.center, 0.22).addScaledVector(u, -0.06);
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
    cam.setValue(WebcamHands, 'status', 'Starting the camera...');
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const base = import.meta.env.BASE_URL;
      const fileset = await vision.FilesetResolver.forVisionTasks(`${base}${RUNTIME_PATH}`);
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}${MODEL_PATH}`, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
      });
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      // Turned off while the permission prompt was open: release it.
      if (!cam.getValue(WebcamHands, 'enabled')) {
        this.shutdown();
        return;
      }
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = this.stream;
      // A small mirrored preview so children can see their hands.
      Object.assign(video.style, {
        position: 'fixed', right: '12px', top: '12px', width: '22vmin', zIndex: '1000',
        transform: 'scaleX(-1)', borderRadius: '12px', border: '3px solid #e0a24a',
      });
      document.body.appendChild(video);
      await video.play();
      this.video = video;
      cam.setValue(WebcamHands, 'status', 'Camera hands on.');
    } catch (error) {
      cam.setValue(WebcamHands, 'enabled', false);
      cam.setValue(WebcamHands, 'status', `Camera unavailable: ${(error as Error).message}`);
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
    if (secondHands.left === this.joints.left) secondHands.left = null;
    if (secondHands.right === this.joints.right) secondHands.right = null;
    if (handOverride.source === 'camera') {
      handOverride.active = false;
      handOverride.left = handOverride.right = null;
    }
  }
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
