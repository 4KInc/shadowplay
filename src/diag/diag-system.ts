import {
  CanvasTexture,
  createSystem,
  Entity,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  VisibilityState,
  XRMesh,
  XRPlane,
} from '@iwsdk/core';
import { ShapeRecognizer, Stage, StoryState } from '../shadowplay-components.js';
import { handRuntime, stageRuntime } from '../stage-runtime.js';
import { coachRuntime } from '../mo-coach.js';
import { FrameStats } from './frame-stats.js';
import { shadowMapSize } from '../quality-levels.js';
import { formatSessionId, newSessionId } from './session-id.js';
import { DropoutWatch } from '../tracking-watch.js';

/** Snapshot to the server every SNAPSHOT_MS; events within EVENT_FLUSH_MS. */
const SNAPSHOT_MS = 5000;
const EVENT_FLUSH_MS = 1000;
const OVERLAY_MS = 500;
const W = 1024;
/** 6 lines of readings under a band with the session id in large type. */
const BAND = 84;
const H = 300 + BAND;

type Item = Record<string, string | number | boolean | number[] | string[] | null>;

/** Headset tags a device-test URL may carry (`?diag&device=q3s`): the user agent cannot tell these apart. */
const DEVICE_TAGS: Readonly<Record<string, string>> = { q3: 'quest3', q3s: 'quest3s' };

/**
 * Which headset or device (an enum, nothing identifying). Quest 3S reports
 * "Quest 3" in its user agent, exactly like Quest 3, so the two are told apart
 * only by the URL tag; untagged, both are 'quest3-or-3s'.
 */
function deviceClass(): string {
  const ua = navigator.userAgent;
  const tag = DEVICE_TAGS[new URLSearchParams(location.search).get('device') ?? ''];
  if (tag && /OculusBrowser|Quest/i.test(ua)) return tag;
  if (/Quest 3/i.test(ua)) return 'quest3-or-3s';
  if (/Quest Pro/i.test(ua)) return 'questpro';
  if (/Quest 2/i.test(ua)) return 'quest2';
  if (/OculusBrowser|Quest/i.test(ua)) return 'quest';
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'desktop';
}


const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Device diagnostics, only with ?diag (never registered otherwise). A small
 * panel under the stage shows frame times, quality, hands and recognition,
 * room detection, placement, session frame rate, heap and startup timings;
 * the same numbers are sent to /api/diag every 5 s and on key events (stage
 * placed, quality step-down, story beat, recognition trigger, visibility,
 * errors), so a headset session leaves data to act on. Numbers and short ids
 * only: no audio, video, names or family codes.
 */
export class DiagSystem extends createSystem({
  stages: { required: [Stage] },
  stories: { required: [StoryState] },
  recognizers: { required: [ShapeRecognizer] },
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
}) {
  private stats = new FrameStats(5000);
  private read = { avg: 0, p95: 0, worst: 0, fps: 0, frames: 0 };
  private session = newSessionId();
  private device = deviceClass();
  private gpu = '';
  private seq = 0;
  private queue: Item[] = [];
  private lastSnapshot = 0;
  private lastFlush = 0;
  private lastOverlay = 0;
  private visibility = 'non-immersive';
  private xrAt = 0;
  private placedAt = 0;
  private last = { mode: '', quality: -1, beat: '', matched: '', anchor: '', fixes: 0, tips: 0 };
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private texture = new CanvasTexture(this.canvas);
  private panel!: Mesh;
  /** Hand-tracking flickers in the current story beat, and its length so far. */
  private dropouts = new DropoutWatch();
  private beatSeconds = 0;
  /** The stage asks for 72 Hz on XR entry; its answer is reported once. */
  private rateReported = false;

  init(): void {
    this.canvas.width = W;
    this.canvas.height = H;
    this.texture.colorSpace = SRGBColorSpace;
    this.panel = new Mesh(
      new PlaneGeometry(1, H / W),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.panel.name = 'diag-panel';
    this.panel.renderOrder = 30;
    // The same id on the page itself, to note down before entering XR (and after leaving it).
    const badge = document.createElement('div');
    badge.className = 'sp-diag-badge';
    badge.textContent = `Diagnostics session ${formatSessionId(this.session)}`;
    badge.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:990;padding:10px 16px;border-radius:12px;background:rgba(10,8,16,0.88);' +
      "color:#f2c47a;font:bold 22px ui-monospace,Menlo,Consolas,monospace;border:1px solid #b8863b;pointer-events:none";
    document.body.appendChild(badge);
    this.cleanupFuncs.push(
      () => badge.remove(),
      this.world.visibilityState.subscribe((state) => (badge.hidden = state !== VisibilityState.NonImmersive)),
    );
    this.gpu = this.rendererName();

    const onError = (e: ErrorEvent) =>
      this.event({ e: 'error', message: String(e.message ?? ''), stack: String(e.error?.stack ?? ''), source: `${(e.filename ?? '').split('/').pop()}:${e.lineno ?? 0}` });
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | undefined;
      this.event({ e: 'error', message: String(r?.message ?? r ?? 'unhandled rejection'), stack: String(r?.stack ?? ''), source: 'promise' });
    };
    const onHide = () => {
      this.event({ e: 'page', state: document.visibilityState });
      this.flush(true);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    document.addEventListener('visibilitychange', onHide);
    this.cleanupFuncs.push(
      () => window.removeEventListener('error', onError),
      () => window.removeEventListener('unhandledrejection', onRejection),
      () => document.removeEventListener('visibilitychange', onHide),
      this.world.visibilityState.subscribe((state) => {
        this.visibility = state;
        if (state !== VisibilityState.NonImmersive && !this.xrAt) this.xrAt = performance.now();
        this.event({ e: 'vis', state });
      }),
      () => {
        this.panel.removeFromParent();
        this.texture.dispose();
      },
    );
    this.event({ e: 'start', loadMs: round(performance.now(), 0), url: location.pathname });
  }

  update(delta: number): void {
    this.dropouts.step(delta, handRuntime.left.tracked, handRuntime.right.tracked);
    this.beatSeconds += delta;
    if (!this.rateReported && stageRuntime.frameRateRequest) {
      this.rateReported = true;
      this.event({ e: 'rate', requested: 72, result: stageRuntime.frameRateRequest });
    }
    this.stats.push(delta * 1000);
    const now = performance.now();
    this.watch(now);
    if (now - this.lastOverlay >= OVERLAY_MS) {
      this.lastOverlay = now;
      this.drawOverlay();
    }
    if (now - this.lastSnapshot >= SNAPSHOT_MS) {
      this.lastSnapshot = now;
      this.queue.push(this.snapshot());
      this.flush(true);
    } else if (this.queue.length && now - this.lastFlush >= EVENT_FLUSH_MS) {
      this.flush(false);
    }
  }

  /** Key changes become events. */
  private watch(now: number): void {
    const stage = this.queries.stages.entities.values().next().value;
    const story = this.queries.stories.entities.values().next().value;
    const rec = this.queries.recognizers.entities.values().next().value;
    if (stage) {
      const mode = stage.getValue(Stage, 'mode') ?? '';
      if (mode !== this.last.mode) {
        this.last.mode = mode;
        if (mode !== 'pending') {
          if (this.xrAt && !this.placedAt && this.visibility !== VisibilityState.NonImmersive) this.placedAt = now;
          this.event({ e: 'placed', ...this.placement(stage) });
        }
        this.attachPanel(stage.object3D ?? null);
      }
      const quality = stage.getValue(Stage, 'quality') ?? 0;
      if (quality !== this.last.quality) {
        if (this.last.quality >= 0) this.event({ e: 'quality', level: quality, fps: round(this.stats.read(this.read).fps) });
        this.last.quality = quality;
      }
    }
    // The stage's room anchor: created, remembered, restored, or unavailable; and each correction.
    if (stageRuntime.anchor !== this.last.anchor || stageRuntime.anchorFixes !== this.last.fixes) {
      this.last.anchor = stageRuntime.anchor;
      this.last.fixes = stageRuntime.anchorFixes;
      if (stageRuntime.anchor) {
        this.event({
          e: 'anchor',
          state: stageRuntime.anchor,
          lastTime: stageRuntime.anchorFromLastTime,
          fixes: stageRuntime.anchorFixes,
          maxFixCm: stageRuntime.anchorMaxFixCm,
        });
      }
    }
    // Mo the coach gave a tip: which facts, AI or fixed words, how long it took.
    if (coachRuntime.tips !== this.last.tips) {
      this.last.tips = coachRuntime.tips;
      this.event({ e: 'coach', facts: coachRuntime.facts.slice(0, 2), source: coachRuntime.source, ms: coachRuntime.ms });
    }
    const beat = story?.getValue(StoryState, 'beatId') ?? '';
    if (beat && beat !== this.last.beat) {
      // Hand-tracking flickers during the beat that just ended (a dim-room signal).
      if (this.last.beat && this.dropouts.flickers > 0) {
        this.event({ e: 'dropouts', beat: this.last.beat, flickers: this.dropouts.flickers, seconds: round(this.beatSeconds) });
      }
      this.dropouts.reset();
      this.beatSeconds = 0;
      this.last.beat = beat;
      this.event({ e: 'beat', beat, script: (story?.getValue(StoryState, 'script') ?? '').replace(/^story\//, '') });
    }
    const matched = rec?.getValue(ShapeRecognizer, 'matchedShape') ?? 'none';
    if (matched !== this.last.matched) {
      if (matched !== 'none') {
        this.event({
          e: 'trigger',
          shape: matched,
          hand: rec?.getValue(ShapeRecognizer, 'matchedHand') ?? '',
          two: Boolean(rec?.getValue(ShapeRecognizer, 'twoHanded')),
          free: Boolean(rec?.getValue(ShapeRecognizer, 'freeMode')),
          target: rec?.getValue(ShapeRecognizer, 'target') ?? '',
        });
      }
      this.last.matched = matched;
    }
  }

  private placement(stage: Entity): Item {
    return {
      place: stage.getValue(Stage, 'mode') ?? '',
      wallW: round(stage.getValue(Stage, 'wallWidth') ?? 0, 2),
      wallD: round(stage.getValue(Stage, 'distance') ?? 0, 2),
      stageW: round(stage.getValue(Stage, 'width') ?? 0, 2),
      planes: this.queries.planes.entities.size,
      vplanes: this.verticalPlanes(),
      labels: this.planeLabels(),
      desk: stageRuntime.desk,
      fovH: stageRuntime.fovH,
      anchor: stageRuntime.anchor,
      anchorLast: stageRuntime.anchorFromLastTime,
      meshes: this.queries.meshes.entities.size,
    };
  }

  /**
   * Every plane label the headset reports, with its orientation and count
   * ("v wall 4", "v door frame 1", "h table 2", "v - 1" for no label), so label
   * handling can be checked against real rooms. Up to 16 kinds.
   */
  private planeLabels(): string[] {
    const counts = new Map<string, number>();
    for (const p of this.queries.planes.entities) {
      const plane = p.getValue(XRPlane, '_plane') as (XRPlane & { semanticLabel?: string }) | undefined;
      if (!plane) continue;
      const label = (plane.semanticLabel ?? '').toLowerCase().replace(/[^a-z0-9 _-]/g, '').slice(0, 40) || '-';
      const key = `${plane.orientation === 'vertical' ? 'v' : 'h'} ${label}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts].slice(0, 16).map(([k, n]) => `${k} ${n}`);
  }


  private verticalPlanes(): number {
    let n = 0;
    for (const p of this.queries.planes.entities) {
      if ((p.getValue(XRPlane, '_plane') as XRPlane | undefined)?.orientation === 'vertical') n++;
    }
    return n;
  }

  private snapshot(): Item {
    const r = this.stats.read(this.read);
    const stage = this.queries.stages.entities.values().next().value;
    const story = this.queries.stories.entities.values().next().value;
    const session = this.world.xrSession as (XRSession & { frameRate?: number; supportedFrameRates?: Float32Array }) | null;
    const quality = stage?.getValue(Stage, 'quality') ?? 0;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const hand = (h: typeof handRuntime.left) => ({
      t: h.tracked,
      shape: h.jointShape || h.silhouetteShape || '',
      score: round(h.jointScore, 2),
      sil: round(h.silhouetteOverlap, 2),
    });
    const l = hand(handRuntime.left);
    const rt = hand(handRuntime.right);
    return {
      k: 'snap',
      t: round(performance.now() / 1000, 1),
      fps: round(r.fps),
      avgMs: round(r.avg, 2),
      p95Ms: round(r.p95, 2),
      worstMs: round(r.worst, 2),
      quality,
      shadowMap: shadowMapSize(quality),
      lt: l.t, ls: l.shape, lsc: l.score, lsil: l.sil,
      rt: rt.t, rs: rt.shape, rsc: rt.score, rsil: rt.sil,
      ...(stage ? this.placement(stage) : {}),
      vis: this.visibility,
      rate: session?.frameRate ?? 0,
      rates: session?.supportedFrameRates ? Array.from(session.supportedFrameRates).slice(0, 8) : [],
      heapMB: mem ? round(mem.usedJSHeapSize / 1048576) : 0,
      xrMs: this.xrAt ? round(this.xrAt, 0) : 0,
      placedMs: this.placedAt ? round(this.placedAt - this.xrAt, 0) : 0,
      beat: story?.getValue(StoryState, 'beatId') ?? '',
      script: (story?.getValue(StoryState, 'script') ?? '').replace(/^story\//, ''),
    };
  }

  private event(fields: Item): void {
    this.queue.push({ k: 'ev', t: round(performance.now() / 1000, 2), ...fields });
    if (this.queue.length > 60) this.queue.splice(0, this.queue.length - 60);
  }

  private flush(force: boolean): void {
    if (!this.queue.length || (!force && performance.now() - this.lastFlush < EVENT_FLUSH_MS)) return;
    this.lastFlush = performance.now();
    const items = this.queue.splice(0, 40);
    const body = JSON.stringify({ v: 1, session: this.session, device: this.device, gpu: this.gpu, seq: this.seq++, items });
    void fetch(`${import.meta.env.BASE_URL}api/diag`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(
      () => undefined,
    );
  }

  private rendererName(): string {
    try {
      const gl = this.world.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      return name.replace(/[^\w .:/()+,-]/g, '').slice(0, 60);
    } catch {
      return '';
    }
  }

  /** The panel hangs just below the stage (and its captions), inside the comfortable view. */
  private attachPanel(stageObj: Object3D | null): void {
    if (!stageObj) return;
    const stage = this.queries.stages.entities.values().next().value;
    const stageW = stage?.getValue(Stage, 'width') ?? 1.2;
    const stageH = stageW * 0.62;
    const panelW = stageW;
    stageObj.add(this.panel);
    this.panel.scale.setScalar(panelW);
    // Below the stage (and the paper frame of the floating screen, 1.35 x its height).
    this.panel.position.set(0, -stageH * 0.675 - (panelW * H) / W / 2 - 0.03, 0.012);
  }

  private drawOverlay(): void {
    const g = this.ctx;
    const r = this.stats.read(this.read);
    const stage = this.queries.stages.entities.values().next().value;
    const rec = this.queries.recognizers.entities.values().next().value;
    const session = this.world.xrSession as (XRSession & { frameRate?: number }) | null;
    const quality = stage?.getValue(Stage, 'quality') ?? 0;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const hand = (h: typeof handRuntime.left, name: string) =>
      `${name} ${h.tracked ? 'on ' : 'off'} ${(h.jointShape || '-').padEnd(9)} ${h.jointScore.toFixed(2)} sil ${(h.silhouetteShape || '-').padEnd(8)} ${h.silhouetteOverlap.toFixed(2)}`;
    const lines = [
      `${r.fps.toFixed(1)} fps  avg ${r.avg.toFixed(1)}  p95 ${r.p95.toFixed(1)}  worst ${r.worst.toFixed(1)} ms   q${quality} shadow ${shadowMapSize(quality)}   rate ${session?.frameRate ?? '-'}`,
      hand(handRuntime.left, 'L'),
      hand(handRuntime.right, 'R'),
      `match ${rec?.getValue(ShapeRecognizer, 'matchedShape') ?? '-'}  target ${rec?.getValue(ShapeRecognizer, 'target') ?? '-'}  held ${(rec?.getValue(ShapeRecognizer, 'heldFor') ?? 0).toFixed(1)}s`,
      `planes ${this.queries.planes.entities.size} (vert ${this.verticalPlanes()})  meshes ${this.queries.meshes.entities.size}  ${stage?.getValue(Stage, 'mode') ?? '-'}  wall ${(stage?.getValue(Stage, 'wallWidth') ?? 0).toFixed(2)}m @ ${(stage?.getValue(Stage, 'distance') ?? 0).toFixed(2)}m  stage ${(stage?.getValue(Stage, 'width') ?? 0).toFixed(2)}m`,
      `${this.visibility}  heap ${mem ? (mem.usedJSHeapSize / 1048576).toFixed(0) + 'MB' : '-'}  xr ${this.xrAt ? (this.xrAt / 1000).toFixed(1) : '-'}s  placed +${this.placedAt ? ((this.placedAt - this.xrAt) / 1000).toFixed(1) : '-'}s  ${this.device}  ${this.session}`,
    ];
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(10, 8, 16, 0.78)';
    g.fillRect(0, 0, W, H);
    g.textBaseline = 'top';
    // The session id, large enough to read out from inside the headset.
    g.fillStyle = '#f2c47a';
    g.font = 'bold 56px ui-monospace, Menlo, Consolas, monospace';
    g.fillText(`SESSION ${formatSessionId(this.session)}`, 14, 14, W - 28);
    g.font = '26px ui-monospace, Menlo, Consolas, monospace';
    lines.forEach((line, i) => {
      g.fillStyle = i === 0 && r.fps > 0 && r.fps < 66 ? '#ff8a6a' : '#f6e3bd';
      g.fillText(line, 14, BAND + 14 + i * 46, W - 28);
    });
    this.texture.needsUpdate = true;
  }
}
