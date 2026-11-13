import { createSystem, Entity, Vector3 } from '@iwsdk/core';
import { HandCasterSystem } from './hand-caster.js';
import { FIXTURES, HandPose, localJoints, PoseFixture, toWorld } from './hand-poses.js';
import {
  DemoDirector,
  DeskLamp,
  PuppetStates,
  ShadowPuppet,
  StoryState,
} from './shadowplay-components.js';
import { loadStoryScript, StoryBeat } from './story-script.js';
import { handOverride, JOINT_COUNT, stageRuntime } from './stage-runtime.js';

/** Hands sit this far from the lamp towards the stage (1/magnification). */
const REST_REACH = 0.22;
/** Closer to the lamp for grow beats (bigger shadow). */
const GROW_REACH = { fish: 0.12, dog: 0.08 } as const;
/** Lamp slide (m along stage right) that sweeps the light onto the hidden hollow. */
const LAMP_SEARCH = -0.11;
/** Seconds to ease between hand targets. */
const EASE = 1.6;
const SEED = 37;
/** Carry steering: how fast the hand corrects towards the target (per second). */
const STEER = 2.5;

type V = [number, number, number];

interface Performance {
  fixture: PoseFixture | null;
  u: number;
  v: number;
  reach: number;
  sway: boolean;
}

/**
 * Development tool: performs the story with synthetic hands so a run can be
 * screen-recorded from the emulator (the competition accepts simulator
 * footage). It reads the current beat and plays it like a careful player:
 * leads Mo with a fingertip, forms each requested shape on its outline, keeps
 * a living creature held through narration, carries, grows, flies, slides the
 * lamp to search, and opens the hands to continue or let the light go.
 * Keys in dev builds: D play/stop, B Chapter Three ending, H show hands.
 * Never shipped.
 */
export class DemoDirectorSystem extends createSystem({
  directors: { required: [DemoDirector] },
  stories: { required: [StoryState] },
  lamps: { required: [DeskLamp] },
  puppets: { required: [ShadowPuppet] },
}) {
  private beats = new Map<string, StoryBeat>();
  private loadedScript = '';
  private loading = false;
  private time = 0;
  private held: PoseFixture | null = null;
  private target: Performance = { fixture: null, u: 0, v: 0, reach: REST_REACH, sway: false };
  private u = 0;
  private v = 0;
  private reach = REST_REACH;
  private local = new Map<string, { right: V[] | null; left: V[] | null }>();
  private joints = { left: new Float32Array(JOINT_COUNT * 3), right: new Float32Array(JOINT_COUNT * 3) };
  private wrist = new Vector3();
  private base = new Vector3();
  private lampStart = new Vector3();
  private lampMoved = 0;
  private wasPlaying = false;
  private beatId = '';
  /** Seconds in the current beat (personas react to it). */
  private beatTime = 0;
  private persona = 'perfect';
  /** The current beat asks for a shape (personas act only then). */
  private asking = false;

  init(): void {
    // D play/stop, B switch the Chapter Three ending, H show/hide the capsule hands.
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      const d = first(this.queries.directors.entities);
      if (!d) return;
      const key = e.key.toLowerCase();
      if (key === 'd') d.setValue(DemoDirector, 'playing', !d.getValue(DemoDirector, 'playing'));
      if (key === 'b') d.setValue(DemoDirector, 'branch', d.getValue(DemoDirector, 'branch') === 'dog' ? 'bird' : 'dog');
      if (key === 'h') {
        d.setValue(DemoDirector, 'showHands', !d.getValue(DemoDirector, 'showHands'));
        const hands = this.world.getSystem(HandCasterSystem);
        if (hands) hands.config.showCasters.value = Boolean(d.getValue(DemoDirector, 'showHands'));
      }
    };
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKey));
  }

  update(delta: number): void {
    const director = first(this.queries.directors.entities);
    const story = first(this.queries.stories.entities);
    if (!director || !story) return;
    const playing = Boolean(director.getValue(DemoDirector, 'playing'));
    const script = story.getValue(StoryState, 'script') ?? '';
    if (playing && script !== this.loadedScript && !this.loading) this.load(script);
    if (playing !== this.wasPlaying) this.toggle(director, playing);
    if (!playing || this.beats.size === 0 || !stageRuntime.ready) return;
    this.time += delta;

    const beatId = story.getValue(StoryState, 'beatId') ?? '';
    if (beatId !== this.beatId) {
      this.beatId = beatId;
      this.beatTime = 0;
    }
    this.beatTime += delta;
    this.persona = director.getValue(DemoDirector, 'persona') ?? 'perfect';
    const beat = this.beats.get(beatId);
    this.direct(beat, director);
    this.actPersona(beat);
    if (beat?.type === 'carry') this.steer(beat.toU + 0.08, (beat.minV ?? -0.05) + 0.08, delta);
    this.ease(delta);
    this.pose();
    director.setValue(DemoDirector, 'status', `${beatId}: ${this.target.fixture?.label ?? 'hands resting'}`);
  }

  /** Beats by id from every story loaded so far (ids are unique across the library). */
  private load(path: string): void {
    this.loading = true;
    loadStoryScript(path)
      .then((script) => {
        for (const b of script.beats) this.beats.set(b.id, b);
        this.loadedScript = path;
      })
      .finally(() => (this.loading = false));
  }

  private toggle(director: Entity, playing: boolean): void {
    this.wasPlaying = playing;
    const hands = this.world.getSystem(HandCasterSystem);
    if (hands) hands.config.showCasters.value = playing && Boolean(director.getValue(DemoDirector, 'showHands'));
    if (!playing) {
      if (handOverride.source === 'director') {
        handOverride.active = false;
        handOverride.left = handOverride.right = null;
      }
      this.held = null;
      director.setValue(DemoDirector, 'status', 'stopped');
    }
  }

  private fixture(label: string): PoseFixture | null {
    return FIXTURES.find((f) => f.label === label) ?? null;
  }


  /** Decide what the hands should do for this beat. */
  private direct(beat: StoryBeat | undefined, director: Entity): void {
    const t = this.target;
    const w = stageRuntime.width;
    const h = stageRuntime.height;
    t.sway = false;
    if (!beat) return;
    // After the storm search, slide the lamp back home, as a player would.
    if (beat.type !== 'reveal' && this.lampMoved > 0) this.slideLamp(-1);
    switch (beat.type) {
      case 'follow':
        this.held = null;
        t.fixture = this.fixture('open');
        // Low enough that the (magnified) fingertip shadow stays on the stage.
        t.u = 0.02;
        t.v = -0.05;
        t.reach = REST_REACH;
        t.sway = true;
        return;
      case 'request':
      case 'choice': {
        let shape = '';
        let ou = 0;
        let ov = 0;
        if (beat.type === 'request') {
          shape = beat.shape;
          ou = beat.outlineU ?? 0;
          ov = beat.outlineV ?? 0;
        } else {
          const want = director.getValue(DemoDirector, 'branch') ?? 'dog';
          const option = beat.options.find((o) => o.shape === want) ?? beat.options[0];
          shape = option.shape;
          ou = option.outlineU ?? 0;
          ov = option.outlineV ?? 0;
        }
        this.held = this.fixture(shape);
        t.fixture = this.held;
        // Shadow offset = hand offset x magnification, so aim the hand at the outline.
        t.reach = REST_REACH;
        t.u = ou * w * REST_REACH;
        t.v = ov * h * REST_REACH;
        return;
      }
      case 'grow':
        t.fixture = this.held;
        t.reach = this.held?.label === 'dog' ? GROW_REACH.dog : GROW_REACH.fish;
        t.u = 0;
        t.v = 0;
        return;
      case 'carry':
        // Position is steered closed-loop from the creature's real place on the wall (see steer()).
        t.fixture = this.held;
        return;
      case 'reveal':
        this.held = null;
        t.fixture = null;
        this.slideLamp();
        return;
      case 'continue':
      case 'letgo':
        this.held = beat.type === 'letgo' ? null : this.held;
        t.fixture = this.fixture('open');
        t.reach = REST_REACH;
        t.u = 0;
        t.v = 0;
        return;
      case 'release':
        this.held = null;
        t.fixture = null;
        return;
      case 'freestage':
      case 'end':
        this.held = null;
        t.fixture = null;
        return;
      default:
        // Narration and staging beats: keep holding the shape until the story's
        // release beat (re-forming it if the creature slipped away), like a player.
        t.fixture = this.held;
    }
  }

  /** Bend the careful performance into a more human one (bot playtests). */
  private actPersona(beat: StoryBeat | undefined): void {
    this.asking = Boolean(beat && (beat.type === 'request' || beat.type === 'choice'));
    if (!beat || (beat.type !== 'request' && beat.type !== 'choice')) return;
    const t = this.target;
    const asked = t.fixture?.label ?? '';
    switch (this.persona) {
      case 'slow':
        // An open hand in the light, thinking, for a long while.
        if (this.beatTime < 25) t.fixture = this.fixture('open');
        break;
      case 'wrong':
        if (this.beatTime < 12) t.fixture = this.fixture(asked === 'dog' ? 'rabbit' : 'dog');
        break;
      case 'wanderer':
        // Gone (to fetch a teddy) for half a minute.
        if (this.beatTime < 30) t.fixture = null;
        break;
    }
  }

  /**
   * Closed-loop carry: read where the living creature actually is on the stage
   * and nudge the hand until its shadow reaches the target, like a player
   * watching the wall.
   */
  private steer(targetU: number, targetV: number, delta: number): void {
    let obj = null;
    for (const p of this.queries.puppets.entities) {
      if (p.getValue(ShadowPuppet, 'state') === PuppetStates.Alive) obj = p.object3D;
    }
    if (!obj) return;
    const c = stageRuntime.center;
    const r = stageRuntime.right;
    const u = ((obj.position.x - c.x) * r.x + (obj.position.z - c.z) * r.z) / stageRuntime.width;
    const v = (obj.position.y - c.y) / stageRuntime.height;
    const k = Math.min(1, STEER * delta) * this.reach;
    this.target.u = Math.max(-0.2, Math.min(0.2, this.target.u + (targetU - u) * stageRuntime.width * k));
    this.target.v = Math.max(-0.15, Math.min(0.2, this.target.v + (targetV - v) * stageRuntime.height * k));
  }

  /** Slide the lamp along the desk (towards the hollow tree, or back home with dir -1). */
  private slideLamp(dir = 1): void {
    const lamp = first(this.queries.lamps.entities)?.object3D;
    if (!lamp) return;
    if (this.lampMoved === 0 && dir > 0) this.lampStart.copy(lamp.position);
    this.lampMoved = Math.max(0, Math.min(1, this.lampMoved + 0.008 * dir));
    lamp.position.copy(this.lampStart).addScaledVector(stageRuntime.right, LAMP_SEARCH * this.lampMoved);
  }

  private ease(delta: number): void {
    const k = Math.min(1, delta / EASE * 3);
    this.u += (this.target.u - this.u) * k;
    this.v += (this.target.v - this.v) * k;
    this.reach += (this.target.reach - this.reach) * k;
  }

  /** Write the posed joints into the hand override (or rest the hands). */
  private pose(): void {
    const fx = this.target.fixture;
    handOverride.active = true;
    handOverride.source = 'director';
    // 'dim': in a dark room tracking keeps dropping (0.35 s of every 0.8 s, too often for a shape to be
    // held for half a second) during the first 12 s of a request; then a light goes on and it holds.
    const flicker = this.persona === 'dim' && this.asking && this.beatTime < 12 && this.time % 0.8 < 0.35;
    if (!fx || flicker) {
      handOverride.left = handOverride.right = null;
      return;
    }
    const scale = this.persona === 'small' ? 0.75 : 1;
    const key = `${fx.label}@${scale}`;
    let cached = this.local.get(key);
    if (!cached) {
      const make = (pose: HandPose | null, s: number) => (pose ? localJoints(pose, scale, SEED + s) : null);
      cached = { right: make(fx.right, 0), left: make(fx.left, 1000) };
      this.local.set(key, cached);
    }
    const swayU = this.target.sway ? Math.sin(this.time * 0.5) * 0.015 : 0;
    const swayV = this.target.sway ? Math.sin(this.time * 0.8) * 0.01 : 0;
    this.base
      .copy(stageRuntime.bulb)
      .lerp(stageRuntime.center, this.reach)
      .addScaledVector(stageRuntime.up, -0.06 * (this.reach / REST_REACH) + this.v + swayV)
      .addScaledVector(stageRuntime.right, this.u + swayU);
    const place = (side: 'left' | 'right', local: V[] | null, at?: [number, number]) => {
      if (!local) return null;
      this.wrist
        .copy(this.base)
        .addScaledVector(stageRuntime.right, at?.[0] ?? 0)
        .addScaledVector(stageRuntime.up, at?.[1] ?? 0);
      return toWorld(local, side, this.wrist, stageRuntime.right, stageRuntime.up, stageRuntime.normal, this.joints[side]);
    };
    handOverride.right = place('right', cached.right, fx.rightAt);
    handOverride.left = place('left', cached.left, fx.leftAt);
    if (this.persona === 'shaky') {
      // A 6 Hz tremor of the whole hand (about 1 cm) plus a few millimetres of jitter per joint.
      const tremor = Math.sin(this.time * 2 * Math.PI * 6) * 0.01;
      for (const joints of [handOverride.right, handOverride.left]) {
        if (!joints) continue;
        for (let i = 0; i < joints.length; i++) joints[i] += tremor * (i % 3 === 1 ? 1 : 0.5) + (Math.random() - 0.5) * 0.006;
      }
    }
  }
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
