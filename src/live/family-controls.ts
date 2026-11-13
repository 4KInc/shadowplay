import { createSystem, Entity, UIKit, UIKitMLAsset } from '@iwsdk/core';
import { FamilyInbox, LiveSession, PerformanceRecorder } from '../shadowplay-components.js';
import { playClick } from '../sfx.js';
import { palette } from '../panel-palette.js';
import { accessRuntime, gazeTargets, uiPresses } from '../stage-runtime.js';
import { isDreamed, storyRuntime } from '../story-script.js';

/** A dreamed story lives only on this headset: recordings and Live carry library stories. */
const DREAMED_STAYS = "A dreamed story stays on this headset. Pick one from Tonight's story to record or go live.";

const PANEL_NODE = 'settings-panel';

interface Control {
  button: UIKit.Container;
  label: UIKit.Text | undefined;
}

/**
 * The 'For your family' controls at the top of the settings panel: record a
 * bedtime story and send it, or go live and talk. Everything starts from a
 * press by the parent; the microphone opens only for recording with voice or
 * when Talk is switched on.
 */
export class FamilyControlsSystem extends createSystem({
  recorders: { required: [PerformanceRecorder] },
  sessions: { required: [LiveSession] },
  inboxes: { required: [FamilyInbox] },
}) {
  private controls = new Map<string, Control>();
  private status: UIKit.Text | undefined;
  private bound = false;
  private shown = '';
  private lastLive = '';
  private lastRec = '';
  private message = 'Record a bedtime story, or go live with your family.';
  private lastUnwatched = 0;

  update(): void {
    const rec = first(this.queries.recorders.entities);
    const live = first(this.queries.sessions.entities);
    if (!rec || !live) return;
    if (!this.bound) this.bind(rec, live);
    if (!this.bound) return;
    this.refresh(rec, live);
  }

  private bind(rec: Entity, live: Entity): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>(PANEL_NODE);
    if (!panel) return;
    const on = (id: string, labelId: string, handler: () => void) => {
      const button = panel.getElementById<UIKit.Container>(id);
      if (!button) return;
      button.name = id;
      const label = panel.getElementById<UIKit.Text>(labelId) ?? undefined;
      if (label) label.name = labelId;
      this.controls.set(id, { button, label });
      const click = () => {
        playClick(rec.object3D?.position);
        uiPresses.push(id);
        if (uiPresses.length > 50) uiPresses.shift();
        handler();
      };
      button.addEventListener('click', click);
      gazeTargets.set(id, { object: button, press: click });
      this.cleanupFuncs.push(() => gazeTargets.delete(id));
      this.cleanupFuncs.push(() => button.removeEventListener('click', click));
    };
    on('record-button', 'record-label', () => {
      if (live.getValue(LiveSession, 'role') !== 'off') return;
      if (!rec.getValue(PerformanceRecorder, 'recording') && isDreamed(storyRuntime.script)) return this.say(DREAMED_STAYS);
      rec.setValue(PerformanceRecorder, 'recording', !rec.getValue(PerformanceRecorder, 'recording'));
    });
    on('send-button', 'send-label', () => {
      if (rec.getValue(PerformanceRecorder, 'lastId') && !rec.getValue(PerformanceRecorder, 'recording')) {
        rec.setValue(PerformanceRecorder, 'shareRequested', true);
      }
    });
    on('inbox-button', 'inbox-label', () => {
      if (rec.getValue(PerformanceRecorder, 'recording') || live.getValue(LiveSession, 'role') !== 'off') return;
      for (const inbox of this.queries.inboxes.entities) inbox.setValue(FamilyInbox, 'playRequested', true);
    });
    on('live-button', 'live-label', () => {
      if (rec.getValue(PerformanceRecorder, 'recording')) return;
      if (live.getValue(LiveSession, 'role') === 'off' && isDreamed(storyRuntime.script)) return this.say(DREAMED_STAYS);
      live.setValue(LiveSession, 'role', live.getValue(LiveSession, 'role') === 'off' ? 'host' : 'off');
    });
    on('duet-button', 'duet-label', () => live.setValue(LiveSession, 'duet', !live.getValue(LiveSession, 'duet')));
    on('talk-button', 'talk-label', () => {
      if (live.getValue(LiveSession, 'role') === 'off') return;
      live.setValue(LiveSession, 'talk', !live.getValue(LiveSession, 'talk'));
    });
    this.status = panel.getElementById<UIKit.Text>('family-status') ?? undefined;
    if (this.status) this.status.name = 'family-status';
    this.bound = this.controls.size > 0;
    this.shown = '';
  }

  private refresh(rec: Entity, live: Entity): void {
    const recording = Boolean(rec.getValue(PerformanceRecorder, 'recording'));
    const seconds = Math.floor(rec.getValue(PerformanceRecorder, 'seconds') ?? 0);
    const hasStory = Boolean(rec.getValue(PerformanceRecorder, 'lastId'));
    const role = live.getValue(LiveSession, 'role') ?? 'off';
    const talk = Boolean(live.getValue(LiveSession, 'talk'));
    const duet = Boolean(live.getValue(LiveSession, 'duet'));
    const turn = live.getValue(LiveSession, 'turn') ?? 'host';
    const liveStatus = live.getValue(LiveSession, 'status') ?? '';
    const recStatus = rec.getValue(PerformanceRecorder, 'status') ?? '';
    const inbox = this.queries.inboxes.entities.values().next().value;
    const unwatched = inbox?.getValue(FamilyInbox, 'unwatched') ?? 0;
    const from = inbox?.getValue(FamilyInbox, 'latestFrom') ?? '';
    const key = `${accessRuntime.highContrast}|${recording}|${seconds}|${hasStory}|${role}|${talk}|${duet}|${turn}|${unwatched}|${liveStatus}|${recStatus}`;
    if (key === this.shown) return;
    this.shown = key;

    const isLive = role !== 'off';
    this.set('record-button', recording ? `Stop recording ${clock(seconds)}` : 'Record a story', recording ? 'on' : isLive ? 'dim' : 'off');
    this.set('send-button', 'Send to family', hasStory && !recording ? 'off' : 'dim');
    this.set('inbox-button', unwatched ? `Goodnights (${unwatched})` : 'Goodnights', unwatched && !recording && !isLive ? 'on' : 'dim');
    this.set('live-button', isLive ? 'End live story' : 'Go live', isLive ? 'on' : recording ? 'dim' : 'off');
    this.set('talk-button', `Talk: ${talk ? 'On' : 'Off'}`, talk ? 'on' : isLive ? 'off' : 'dim');
    this.set('duet-button', turn === 'guest' ? 'Their turn' : `Take turns: ${duet ? 'On' : 'Off'}`, duet ? 'on' : 'off');
    // Whichever news is newest.
    if (unwatched > this.lastUnwatched) {
      this.message = `${from || 'Your family'} sent you a goodnight! Pinch Goodnights to watch.`;
    } else if (liveStatus !== this.lastLive && liveStatus) this.message = liveStatus;
    else if (recStatus !== this.lastRec && recStatus) this.message = recStatus;
    this.lastUnwatched = unwatched;
    this.lastLive = liveStatus;
    this.lastRec = recStatus;
    this.status?.setProperties({ text: this.message });
  }

  /** Show a line in the family status (repainted on the next update). */
  private say(text: string): void {
    this.message = text;
    this.shown = '';
  }

  private set(id: string, text: string, state: 'on' | 'off' | 'dim'): void {
    const c = this.controls.get(id);
    if (!c) return;
    const p = palette();
    const style = state === 'on' ? p.selected : state === 'dim' ? p.locked : p.unselected;
    c.button.setProperties({ backgroundColor: style.backgroundColor, borderColor: style.borderColor });
    c.label?.setProperties({ text, color: state === 'on' ? p.ink : state === 'dim' ? p.muted : p.cream });
  }
}

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
