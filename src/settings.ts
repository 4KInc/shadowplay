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
import { stageRuntime } from './stage-runtime.js';

const PANEL_NODE = 'settings-panel';
/** Authored panel width in metres (UIKit cm / 100). */
const PANEL_WIDTH = 0.38;
/** Enlarge the authored panel so its text is legible at wall distance. */
const READABLE_SCALE = 1.7;

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
const LOCKED = { backgroundColor: '#1d1826', borderColor: '#2e2639', color: '#6b5f7a' };

const SELECTED = { backgroundColor: '#e0a24a', borderColor: '#f2c47a', color: '#1a1320' };
const UNSELECTED = { backgroundColor: '#2b2338', borderColor: '#4a3d5c', color: '#f6e3bd' };

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
  private voiceLabel: UIKit.Text | undefined;
  private status: UIKit.Text | undefined;
  private loaded = false;
  private loading = false;
  private applied = '';
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
    const key = `${tolerance}|${hints}|${oneHand}|${voice}`;
    if (key !== this.applied) {
      this.apply(tolerance, hints, oneHand, voice);
      if (this.applied) void saveSettings({ tolerance, hints, oneHand, placeholderVoice: voice });
      this.applied = key;
    }
    this.refreshChapters();
    this.place(settings);
  }

  /** Dim chapters the player has not reached yet. */
  private refreshChapters(): void {
    const unlocks = first(this.queries.stories.entities)?.getValue(StoryState, 'unlocked') ?? '';
    if (unlocks === this.shownUnlocks || this.buttons.size === 0) return;
    this.shownUnlocks = unlocks;
    const reached = unlocks.split(',');
    for (const [id, chapter] of CHAPTER_BUTTONS) {
      this.buttons.get(id)?.setProperties(reached.includes(chapter) ? UNSELECTED : LOCKED);
    }
  }

  private load(settings: Entity): void {
    this.loading = true;
    loadSettings().then((stored) => {
      if (stored) {
        settings.setValue(Settings, 'tolerance', stored.tolerance as never);
        settings.setValue(Settings, 'hints', stored.hints as never);
        settings.setValue(Settings, 'oneHand', stored.oneHand);
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
        handler();
      };
      el.addEventListener('click', click);
      this.cleanupFuncs.push(() => el.removeEventListener('click', click));
    };
    for (const [id, value] of TOLERANCE_BUTTONS) on(id, () => settings.setValue(Settings, 'tolerance', value as never));
    for (const [id, value] of HINT_BUTTONS) on(id, () => settings.setValue(Settings, 'hints', value as never));
    on('one-hand-toggle', () => settings.setValue(Settings, 'oneHand', !settings.getValue(Settings, 'oneHand')));
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
    on('replace-stage-button', () => {
      // Close the journal so the stage can be found again, then re-place it.
      for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'open', false);
      for (const s of this.queries.stages.entities) s.setValue(Stage, 'replaceRequested', true);
      this.status?.setProperties({ text: 'Looking for the wall ahead of you...' });
    });
    on('replay-button', () => {
      settings.setValue(Settings, 'replayRequested', true);
      this.status?.setProperties({ text: 'Story restarted from the Prologue.' });
    });
    this.oneHandLabel = panel.getElementById<UIKit.Text>('one-hand-label') ?? undefined;
    this.status = panel.getElementById<UIKit.Text>('status-text') ?? undefined;
    if (this.oneHandLabel) this.oneHandLabel.name = 'one-hand-label';
    this.voiceLabel = panel.getElementById<UIKit.Text>('voice-label') ?? undefined;
    if (this.voiceLabel) this.voiceLabel.name = 'voice-label';
    if (this.status) this.status.name = 'status-text';
    this.applied = '';
    this.shownUnlocks = null;
  }

  private apply(tolerance: string, hints: string, oneHand: boolean, voice: boolean): void {
    for (const r of this.queries.recognizers.entities) {
      r.setValue(ShapeRecognizer, 'tolerance', TOLERANCE_VALUE[tolerance] ?? 0.3);
      r.setValue(ShapeRecognizer, 'oneHand', oneHand);
    }
    for (const s of this.queries.stories.entities) {
      s.setValue(StoryState, 'hintAfterSeconds', HINT_AFTER[hints] ?? 15);
    }
    for (const [id, value] of TOLERANCE_BUTTONS) this.buttons.get(id)?.setProperties(value === tolerance ? SELECTED : UNSELECTED);
    for (const [id, value] of HINT_BUTTONS) this.buttons.get(id)?.setProperties(value === hints ? SELECTED : UNSELECTED);
    this.buttons.get('one-hand-toggle')?.setProperties(oneHand ? SELECTED : UNSELECTED);
    this.buttons.get('voice-toggle')?.setProperties(voice ? SELECTED : UNSELECTED);
    this.voiceLabel?.setProperties({
      text: `Placeholder voice: ${voice ? 'On' : 'Off'}`,
      color: voice ? '#1a1320' : '#f6e3bd',
    });
    this.oneHandLabel?.setProperties({
      text: `One-hand mode: ${oneHand ? 'On' : 'Off'}`,
      color: oneHand ? '#1a1320' : '#f6e3bd',
    });
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
    // Readable from the seat: ~2.3 cm body text on a wall ~2 m away, scaled with the stage.
    const scale = READABLE_SCALE * Math.min(1.4, Math.max(0.6, stageRuntime.width / 1.1));
    const n = stageRuntime.normal;
    obj.quaternion.copy(this.quat.setFromAxisAngle(this.yAxis, Math.atan2(n.x, n.z)));
    obj.scale.setScalar(scale);
    obj.position
      .copy(stageRuntime.center)
      .addScaledVector(stageRuntime.right, stageRuntime.width * 0.46 + (PANEL_WIDTH * scale) / 2 + 0.04)
      .addScaledVector(n, 0.04);
  }
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
