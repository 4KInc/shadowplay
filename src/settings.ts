import { createSystem, Entity, Quaternion, UIKit, UIKitMLAsset, Vector3 } from '@iwsdk/core';
import { loadSettings, saveSettings } from './journal-store.js';
import {
  HintModes,
  Settings,
  ShadowJournal,
  ShapeRecognizer,
  Stage,
  StoryState,
  ToleranceLevels,
} from './shadowplay-components.js';
import { playClick } from './sfx.js';
import { palette } from './panel-palette.js';
import { accessRuntime, stageRuntime, uiPresses } from './stage-runtime.js';

const PANEL_NODE = 'settings-panel';
/** Authored panel width in metres (UIKit cm / 100). */
const PANEL_WIDTH = 0.38;
/** Enlarge the authored panel so its text is legible at wall distance. */
const READABLE_SCALE = 1.7;
/** How far the panel sits below the stage centre, as a fraction of the stage width (about 3 degrees at any distance). */
const PANEL_DROP = 0.09;
/** Stage width per metre at the usual 33 degrees (the reference the panel is sized against). */
const WIDTH_AT_ONE_METER = 2 * Math.tan((16.5 * Math.PI) / 180);
/** Below this horizontal field of view the panel goes over the stage rather than beside it. */
const NARROW_FOV = 75;

const TOLERANCE_VALUE: Readonly<Record<string, number>> = {
  [ToleranceLevels.Strict]: 0.2,
  [ToleranceLevels.Normal]: 0.3,
  [ToleranceLevels.Forgiving]: 0.4,
  [ToleranceLevels.VeryForgiving]: 0.5,
};
const HINT_AFTER: Readonly<Record<string, number>> = {
  [HintModes.Off]: -1,
  [HintModes.Delayed]: 15,
  [HintModes.Always]: 0,
};
const TOLERANCE_BUTTONS: readonly [string, string][] = [
  ['tol-strict', ToleranceLevels.Strict],
  ['tol-normal', ToleranceLevels.Normal],
  ['tol-forgiving', ToleranceLevels.Forgiving],
  ['tol-very-forgiving', ToleranceLevels.VeryForgiving],
];
const HINT_BUTTONS: readonly [string, string][] = [
  ['hint-off', HintModes.Off],
  ['hint-delayed', HintModes.Delayed],
  ['hint-always', HintModes.Always],
];

const CHAPTER_BUTTONS: readonly [string, string, string][] = [
  ['chap-prologue', 'prologue', 'the Prologue'],
  ['chap-ch1', 'ch1', 'Chapter One'],
  ['chap-ch2', 'ch2', 'Chapter Two'],
  ['chap-ch3', 'ch3', 'Chapter Three'],
  ['chap-ch4', 'ch4', 'Chapter Four'],
  ['chap-ch5', 'ch5', 'Chapter Five'],
];
/** The story library (public/story/library.json): browse with the arrows, start with "Tell this story". */
interface LibraryStory {
  id: string;
  title: string;
  script: string;
  minutes: number;
  /** Stories told in chapters say so (each chapter is short, and the story resumes at the last one). */
  chapters?: number;
  blurb: string;
}
const MOTH_SCRIPT = 'story/the-moth.story.json';

/** Buttons with their own look (the rest are options and toggles). */
const REPLAY_BUTTONS = new Set(['replay-button']);

/**
 * Accessibility settings: a hands-first panel (pressed with hand rays) that
 * appears beside the open Shadow Journal. Applies recognition tolerance,
 * 'show me' timing and one-hand mode, persists them in IndexedDB, and asks
 * the story to replay from the Prologue.
 */
export class SettingsSystem extends createSystem({
  settings: { required: [Settings] },
  recognizers: { required: [ShapeRecognizer] },
  stories: { required: [StoryState] },
  journals: { required: [ShadowJournal] },
  stages: { required: [Stage] },
}) {
  private panel: UIKitMLAsset | undefined;
  private buttons = new Map<string, UIKit.Container>();
  private oneHandLabel: UIKit.Text | undefined;
  private contrastLabel: UIKit.Text | undefined;
  private voiceLabel: UIKit.Text | undefined;
  private status: UIKit.Text | undefined;
  private loaded = false;
  private loading = false;
  private applied = '';
  /** What the story picker last showed. */
  private shownScript = '';
  private library: LibraryStory[] = [];
  /** Index of the story being looked at in the picker. */
  private browsing = 0;
  private storyTitle: UIKit.Text | undefined;
  private storyBlurb: UIKit.Text | undefined;
  private storyStart: UIKit.Text | undefined;
  /** Last unlock list shown on the chapter buttons. */
  private shownUnlocks: string | null = null;
  private quat = new Quaternion();
  private yAxis = new Vector3(0, 1, 0);

  update(): void {
    const settings = first(this.queries.settings.entities);
    if (!settings) return;
    if (!this.loaded && !this.loading) this.load(settings);
    if (!this.panel) this.bind(settings);
    if (!this.loaded) return;

    const tolerance = settings.getValue(Settings, 'tolerance') ?? ToleranceLevels.Normal;
    const hints = settings.getValue(Settings, 'hints') ?? HintModes.Delayed;
    const oneHand = Boolean(settings.getValue(Settings, 'oneHand'));
    const voice = Boolean(settings.getValue(Settings, 'placeholderVoice'));
    const highContrast = Boolean(settings.getValue(Settings, 'highContrast'));
    const key = `${tolerance}|${hints}|${oneHand}|${voice}|${highContrast}`;
    if (key !== this.applied) {
      accessRuntime.highContrast = highContrast;
      this.restyle();
      this.apply(tolerance, hints, oneHand, voice, highContrast);
      if (this.applied) void saveSettings({ tolerance, hints, oneHand, highContrast, placeholderVoice: voice });
      this.applied = key;
    }
    this.refreshStories();
    this.refreshChapters();
    this.place(settings);
  }

  /** The browsed story's name and blurb; the start button shows whether it is tonight's. */
  private refreshStories(): void {
    const script = first(this.queries.stories.entities)?.getValue(StoryState, 'script') ?? '';
    const key = `${script}|${this.browsing}|${this.library.length}`;
    if (key === this.shownScript || !this.panel) return;
    this.shownScript = key;
    const story = this.library[this.browsing];
    if (!story) return;
    const telling = story.script === script;
    this.storyTitle?.setProperties({ text: story.title });
    const length = story.chapters ? `${story.chapters} chapters, ${story.minutes} min` : `${story.minutes} min`;
    this.storyBlurb?.setProperties({ text: `${story.blurb} (${length})` });
    const p = palette();
    this.buttons.get('story-start')?.setProperties(telling ? p.selected : p.unselected);
    this.storyStart?.setProperties({ text: telling ? 'Telling this story tonight' : 'Tell this story', color: telling ? p.ink : p.cream });
    this.panel.getElementById('chapter-section')?.setProperties({ display: script === MOTH_SCRIPT ? 'flex' : 'none' });
  }

  private loadLibrary(): void {
    fetch(`${import.meta.env.BASE_URL}story/library.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ stories: LibraryStory[] }>) : null))
      .then((lib) => {
        this.library = lib?.stories ?? [];
        // Start browsing at tonight's story.
        const script = first(this.queries.stories.entities)?.getValue(StoryState, 'script') ?? '';
        this.browsing = Math.max(0, this.library.findIndex((s) => s.script === script));
        this.shownScript = '';
      })
      .catch(() => undefined);
  }

  /** Dim chapters the player has not reached yet. */
  private refreshChapters(): void {
    const unlocks = first(this.queries.stories.entities)?.getValue(StoryState, 'unlocked') ?? '';
    if (unlocks === this.shownUnlocks || this.buttons.size === 0) return;
    this.shownUnlocks = unlocks;
    const reached = unlocks.split(',');
    for (const [id, chapter] of CHAPTER_BUTTONS) {
      this.buttons.get(id)?.setProperties(reached.includes(chapter) ? palette().unselected : palette().locked);
    }
  }

  private load(settings: Entity): void {
    this.loading = true;
    loadSettings().then((stored) => {
      if (stored) {
        settings.setValue(Settings, 'tolerance', stored.tolerance as never);
        settings.setValue(Settings, 'hints', stored.hints as never);
        settings.setValue(Settings, 'oneHand', stored.oneHand);
        settings.setValue(Settings, 'highContrast', Boolean(stored.highContrast));
        settings.setValue(Settings, 'placeholderVoice', Boolean(stored.placeholderVoice));
      }
      this.loaded = true;
    });
  }

  private bind(settings: Entity): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>(PANEL_NODE);
    if (!panel) return;
    this.panel = panel;
    const on = (id: string, handler: () => void) => {
      const el = panel.getElementById<UIKit.Container>(id);
      if (!el) return;
      el.name = id;
      this.buttons.set(id, el);
      const click = () => {
        playClick(settings.object3D?.position);
        uiPresses.push(id);
        if (uiPresses.length > 50) uiPresses.shift();
        handler();
      };
      el.addEventListener('click', click);
      this.cleanupFuncs.push(() => el.removeEventListener('click', click));
    };
    for (const [id, value] of TOLERANCE_BUTTONS) on(id, () => settings.setValue(Settings, 'tolerance', value as never));
    for (const [id, value] of HINT_BUTTONS) on(id, () => settings.setValue(Settings, 'hints', value as never));
    on('one-hand-toggle', () => settings.setValue(Settings, 'oneHand', !settings.getValue(Settings, 'oneHand')));
    on('contrast-toggle', () => settings.setValue(Settings, 'highContrast', !settings.getValue(Settings, 'highContrast')));
    on('voice-toggle', () =>
      settings.setValue(Settings, 'placeholderVoice', !settings.getValue(Settings, 'placeholderVoice')),
    );
    for (const [id, chapter, name] of CHAPTER_BUTTONS) {
      on(id, () => {
        const story = first(this.queries.stories.entities);
        const unlocked = (story?.getValue(StoryState, 'unlocked') ?? '').split(',');
        if (!story || !unlocked.includes(chapter)) {
          this.status?.setProperties({ text: 'Reach this chapter in the story first.' });
          return;
        }
        for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'open', false);
        story.setValue(StoryState, 'jumpTo', chapter);
        this.status?.setProperties({ text: `Starting ${name}...` });
      });
    }
    const browse = (step: number) => {
      if (!this.library.length) return;
      this.browsing = (this.browsing + step + this.library.length) % this.library.length;
    };
    on('story-prev', () => browse(-1));
    on('story-next', () => browse(1));
    on('story-start', () => {
      const story = first(this.queries.stories.entities);
      const chosen = this.library[this.browsing];
      if (!story || !chosen || story.getValue(StoryState, 'followMode')) return;
      if (story.getValue(StoryState, 'script') === chosen.script) return;
      for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'open', false);
      story.setValue(StoryState, 'script', chosen.script);
      this.status?.setProperties({ text: `Starting "${chosen.title}"...` });
    });
    this.storyTitle = panel.getElementById<UIKit.Text>('story-title') ?? undefined;
    this.storyBlurb = panel.getElementById<UIKit.Text>('story-blurb') ?? undefined;
    this.storyStart = panel.getElementById<UIKit.Text>('story-start-label') ?? undefined;
    if (!this.library.length) this.loadLibrary();
    on('replace-stage-button', () => {
      // "Move stage here": close the journal and place the stage again, ahead of
      // wherever the player looks a moment from now (time to turn toward the spot).
      for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'open', false);
      for (const s of this.queries.stages.entities) s.setValue(Stage, 'replaceRequested', true);
      this.status?.setProperties({ text: 'Look where you want the stage...' });
    });
    on('replay-button', () => {
      settings.setValue(Settings, 'replayRequested', true);
      this.status?.setProperties({ text: 'Story restarted from the Prologue.' });
    });
    this.oneHandLabel = panel.getElementById<UIKit.Text>('one-hand-label') ?? undefined;
    this.status = panel.getElementById<UIKit.Text>('status-text') ?? undefined;
    if (this.oneHandLabel) this.oneHandLabel.name = 'one-hand-label';
    this.contrastLabel = panel.getElementById<UIKit.Text>('contrast-label') ?? undefined;
    if (this.contrastLabel) this.contrastLabel.name = 'contrast-label';
    this.voiceLabel = panel.getElementById<UIKit.Text>('voice-label') ?? undefined;
    if (this.voiceLabel) this.voiceLabel.name = 'voice-label';
    // The placeholder voice is a development aid only; production builds hide it.
    // Test-only (and hidden in development with ?clean, for submission stills).
    if (!import.meta.env.DEV || new URLSearchParams(location.search).has('clean')) panel.getElementById('voice-section')?.setProperties({ display: 'none' });
    if (this.status) this.status.name = 'status-text';
    this.applied = '';
    this.shownUnlocks = null;
    this.shownScript = '';
  }

  /**
   * Every button and the panel itself in the current palette (high contrast or
   * not); apply() then highlights the selected ones, and the story and chapter
   * rows are redrawn on the next update.
   */
  private restyle(): void {
    const p = palette();
    this.panel?.getElementById('settings-root')?.setProperties(p.root);
    for (const [id, el] of this.buttons) el.setProperties(REPLAY_BUTTONS.has(id) ? p.replay : p.unselected);
    this.shownScript = '';
    this.shownUnlocks = null;
  }

  private apply(tolerance: string, hints: string, oneHand: boolean, voice: boolean, highContrast: boolean): void {
    for (const r of this.queries.recognizers.entities) {
      r.setValue(ShapeRecognizer, 'tolerance', TOLERANCE_VALUE[tolerance] ?? 0.3);
      r.setValue(ShapeRecognizer, 'oneHand', oneHand);
    }
    for (const s of this.queries.stories.entities) {
      s.setValue(StoryState, 'hintAfterSeconds', HINT_AFTER[hints] ?? 15);
    }
    const p = palette();
    const pick = (on: boolean) => (on ? p.selected : p.unselected);
    for (const [id, value] of TOLERANCE_BUTTONS) this.buttons.get(id)?.setProperties(pick(value === tolerance));
    for (const [id, value] of HINT_BUTTONS) this.buttons.get(id)?.setProperties(pick(value === hints));
    this.buttons.get('one-hand-toggle')?.setProperties(pick(oneHand));
    this.buttons.get('contrast-toggle')?.setProperties(pick(highContrast));
    this.buttons.get('voice-toggle')?.setProperties(pick(voice));
    this.voiceLabel?.setProperties({ text: `Placeholder voice: ${voice ? 'On' : 'Off'}`, color: voice ? p.ink : p.cream });
    this.oneHandLabel?.setProperties({ text: `One-hand mode: ${oneHand ? 'On' : 'Off'}`, color: oneHand ? p.ink : p.cream });
    this.contrastLabel?.setProperties({ text: `High contrast: ${highContrast ? 'On' : 'Off'}`, color: highContrast ? p.ink : p.cream });
  }

  /** Beside the open journal page, to the right of the stage; tucked away otherwise. */
  private place(settings: Entity): void {
    const obj = settings.object3D;
    if (!obj) return;
    const open = Boolean(first(this.queries.journals.entities)?.getValue(ShadowJournal, 'open'));
    const show = open && stageRuntime.ready;
    obj.visible = show;
    if (!show) {
      obj.position.set(0, -10, 0);
      return;
    }
    // Readable from the seat: ~2.3 cm body text on a wall ~2 m away, scaled with the distance
    // (so the text keeps its size in view even where a narrow field of view shrinks the stage).
    const scale = READABLE_SCALE * Math.min(1.4, Math.max(0.6, (stageRuntime.distance * WIDTH_AT_ONE_METER) / 1.1));
    // A narrow field of view (below NARROW_FOV): over the middle of the stage, where it stays in view,
    // instead of beside it.
    const narrow = stageRuntime.fovH > 0 && stageRuntime.fovH < NARROW_FOV;
    const n = stageRuntime.normal;
    obj.quaternion.copy(this.quat.setFromAxisAngle(this.yAxis, Math.atan2(n.x, n.z)));
    obj.scale.setScalar(scale);
    obj.position
      .copy(stageRuntime.center)
      .addScaledVector(stageRuntime.right, narrow ? 0 : stageRuntime.width * 0.46 + (PANEL_WIDTH * scale) / 2 + 0.04)
      // About 3 degrees below eye level: looking down at a menu is easier than looking up.
      .addScaledVector(stageRuntime.up, -stageRuntime.distance * WIDTH_AT_ONE_METER * PANEL_DROP)
      .addScaledVector(n, narrow ? 0.06 : 0.04);
  }
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
