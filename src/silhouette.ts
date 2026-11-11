import {
  Color,
  createSystem,
  Entity,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector3,
  WebGLRenderTarget,
} from '@iwsdk/core';
import { loadRecordedTemplates, saveRecordedTemplates } from './journal-store.js';
import { SilhouetteMatcher, ShapeRecognizer } from './shadowplay-components.js';
import {
  decodeMask,
  encodeMask,
  iou,
  normalizeMask,
  NORM_CELLS,
  SilhouetteTemplate,
} from './silhouette-mask.js';
import {
  handRuntime,
  HandSample,
  isOnStage,
  projectToStage,
  SILHOUETTE_LAYER,
  stageRuntime,
} from './stage-runtime.js';

const SIZE = 64;
/** Half-width (m) of the region around the palm the silhouette camera frames. */
const FRAME_HALF = 0.15;
/** Ignore readbacks with too few lit pixels (hand barely in view). */
const MIN_PIXELS = 24;

type Side = 'left' | 'right';

interface Lane {
  side: Side;
  target: WebGLRenderTarget;
  pixels: Uint8Array;
  mask: Uint8Array;
  pending: boolean;
  litPixels: number;
}

interface Template {
  shape: string;
  mask: Uint8Array;
}

/**
 * Recognition method 2 (the brief): a few times per second each hand's shadow
 * casters are rendered from the lamp into a tiny 64x64 target, read back
 * asynchronously (WebGL2 pixel buffer + fence, so the frame never stalls),
 * normalised to a 32x32 mask and compared with silhouette templates by
 * intersection over union. Matches at or above the threshold are published on
 * the hand sample for the shape matcher to fuse with joint-angle matching.
 * Setting `recordShape` captures the next in-light shadow as a new template.
 */
export class SilhouetteSystem extends createSystem({
  matchers: { required: [SilhouetteMatcher] },
  recognizers: { required: [ShapeRecognizer] },
}) {
  private silCamera = new PerspectiveCamera(20, 1, 0.01, 6);
  private white = new MeshBasicMaterial({ color: 0xffffff });
  private black = new Color(0x000000);
  private savedClear = new Color();
  private lanes!: Record<Side, Lane>;
  private templates: Template[] = [];
  private recorded: { shape: string; mask: string }[] = [];
  private loaded = false;
  private loading = false;
  private timer = 0;
  private palm = new Vector3();
  private hit = new Vector3();

  init(): void {
    const lane = (side: Side): Lane => ({
      side,
      target: new WebGLRenderTarget(SIZE, SIZE, { depthBuffer: true }),
      pixels: new Uint8Array(SIZE * SIZE * 4),
      mask: new Uint8Array(NORM_CELLS),
      pending: false,
      litPixels: 0,
    });
    this.lanes = { left: lane('left'), right: lane('right') };
    this.cleanupFuncs.push(() => {
      this.lanes.left.target.dispose();
      this.lanes.right.target.dispose();
      this.white.dispose();
    });
  }

  update(delta: number): void {
    const matcher = first(this.queries.matchers.entities);
    if (!matcher) return;
    if (!this.loaded && !this.loading) this.load(matcher);
    if (!this.loaded || !matcher.getValue(SilhouetteMatcher, 'enabled') || !stageRuntime.ready) return;

    // Dev: '!clear' wipes the templates recorded on this device.
    const recordShape = matcher.getValue(SilhouetteMatcher, 'recordShape') ?? '';
    if (recordShape === '!clear') this.clearRecorded(matcher);
    // Nothing to compare against (the shipped state: no templates yet) and nothing to record:
    // skip the offscreen shadow renders and readbacks entirely.
    if (this.templates.length === 0 && !recordShape) {
      handRuntime.left.silhouetteShape = handRuntime.right.silhouetteShape = '';
      return;
    }

    this.timer += delta;
    const rate = matcher.getValue(SilhouetteMatcher, 'rateHz') ?? 5;
    if (this.timer < 1 / rate) return;
    this.timer = 0;
    for (const side of ['left', 'right'] as const) {
      const hand = handRuntime[side];
      const lane = this.lanes[side];
      if (lane.pending) continue;
      // Only shadows that actually fall on the lit stage are worth matching.
      if (!hand.tracked || hand.hideCasters || !stageRuntime.lampOn || !this.inLight(hand)) {
        hand.silhouetteShape = '';
        hand.silhouetteOverlap = 0;
        continue;
      }
      this.capture(lane, hand, matcher);
    }
  }

  private inLight(hand: HandSample): boolean {
    const j = hand.joints;
    this.palm.set((j[0] + j[33]) * 0.5, (j[1] + j[34]) * 0.5, (j[2] + j[35]) * 0.5);
    return projectToStage(this.palm, this.hit) > 0 && isOnStage(this.hit);
  }

  private clearRecorded(matcher: Entity): void {
    const recorded = new Set(this.recorded.map((t) => t.mask));
    this.templates = this.templates.filter((t) => !recorded.has(encodeMask(t.mask)));
    this.recorded = [];
    void saveRecordedTemplates(this.recorded);
    matcher.setValue(SilhouetteMatcher, 'recordShape', '');
    matcher.setValue(SilhouetteMatcher, 'lastRecorded', '');
    matcher.setValue(SilhouetteMatcher, 'templateCount', this.templates.length);
  }

  private load(matcher: Entity): void {
    this.loading = true;
    const url = `${import.meta.env.BASE_URL}silhouettes/templates.json`;
    Promise.all([
      fetch(url)
        .then((r) => (r.ok ? r.json() : { templates: [] }))
        .catch(() => ({ templates: [] })),
      loadRecordedTemplates(),
    ]).then(([bundled, recorded]) => {
      const list = (bundled as { templates: SilhouetteTemplate[] }).templates ?? [];
      for (const t of list) this.templates.push({ shape: t.shape, mask: decodeMask(t.mask) });
      this.recorded = recorded;
      for (const t of recorded) this.templates.push({ shape: t.shape, mask: decodeMask(t.mask) });
      matcher.setValue(SilhouetteMatcher, 'templateCount', this.templates.length);
      this.loaded = true;
    });
  }

  /** Render one hand's casters from the bulb, then read back asynchronously. */
  private capture(lane: Lane, hand: HandSample, matcher: Entity): void {
    const renderer = this.world.renderer;
    const j = hand.joints;
    this.palm.set((j[0] + j[33]) * 0.5, (j[1] + j[34]) * 0.5, (j[2] + j[35]) * 0.5);
    const cam = this.silCamera;
    cam.position.copy(stageRuntime.bulb);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.palm);
    const d = Math.max(0.05, cam.position.distanceTo(this.palm));
    cam.fov = (2 * Math.atan(FRAME_HALF / d) * 180) / Math.PI;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    cam.layers.set(SILHOUETTE_LAYER[lane.side]);

    // Offscreen pass: casters only, solid white on black, no XR cameras,
    // and without re-rendering the lamp's shadow map.
    const scene = this.world.scene;
    const xrEnabled = renderer.xr.enabled;
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevAutoShadow = renderer.shadowMap.autoUpdate;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.savedClear);
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    scene.overrideMaterial = this.white;
    renderer.setRenderTarget(lane.target);
    renderer.setClearColor(this.black, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    renderer.setClearColor(this.savedClear, prevAlpha);
    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = prevOverride;
    renderer.shadowMap.autoUpdate = prevAutoShadow;
    renderer.xr.enabled = xrEnabled;

    lane.pending = true;
    renderer
      .readRenderTargetPixelsAsync(lane.target, 0, 0, SIZE, SIZE, lane.pixels)
      .then(() => this.onPixels(lane, hand, matcher))
      .catch(() => undefined)
      .finally(() => {
        lane.pending = false;
      });
  }

  private onPixels(lane: Lane, hand: HandSample, matcher: Entity): void {
    lane.litPixels = normalizeMask(lane.pixels, SIZE, lane.mask);
    let best = '';
    let bestOverlap = 0;
    if (lane.litPixels >= MIN_PIXELS) {
      for (const t of this.templates) {
        const o = iou(lane.mask, t.mask);
        if (o > bestOverlap) {
          bestOverlap = o;
          best = t.shape;
        }
      }
    }
    // Forgiving recognition settings lower the overlap needed as well.
    const tolerance = first(this.queries.recognizers.entities)?.getValue(ShapeRecognizer, 'tolerance') ?? 0.3;
    const threshold = (matcher.getValue(SilhouetteMatcher, 'threshold') ?? 0.55) - (tolerance - 0.3) * 0.5;
    const matched = bestOverlap >= threshold ? best : '';
    hand.silhouetteBest = best;
    hand.silhouetteBestOverlap = bestOverlap;
    hand.silhouetteShape = matched;
    hand.silhouetteOverlap = bestOverlap;
    hand.silhouetteAt = performance.now();
    matcher.setValue(SilhouetteMatcher, lane.side === 'left' ? 'leftShape' : 'rightShape', matched);
    matcher.setValue(SilhouetteMatcher, lane.side === 'left' ? 'leftOverlap' : 'rightOverlap', bestOverlap);
    this.maybeRecord(lane, matcher);
  }

  /** Dev recorder: capture this shadow as a template, persist it, and log an export. */
  private maybeRecord(lane: Lane, matcher: Entity): void {
    const shape = matcher.getValue(SilhouetteMatcher, 'recordShape') ?? '';
    if (!shape || lane.litPixels < MIN_PIXELS) return;
    const mask = encodeMask(lane.mask);
    this.templates.push({ shape, mask: decodeMask(mask) });
    this.recorded.push({ shape, mask });
    void saveRecordedTemplates(this.recorded);
    matcher.setValue(SilhouetteMatcher, 'recordShape', '');
    matcher.setValue(SilhouetteMatcher, 'lastRecorded', `${shape} (${lane.side} hand)`);
    matcher.setValue(SilhouetteMatcher, 'templateCount', this.templates.length);
    console.info(
      '[shadowplay] silhouette template recorded; paste into public/silhouettes/templates.json:',
      JSON.stringify({ shape, mask, source: 'recorded' }),
    );
  }
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
