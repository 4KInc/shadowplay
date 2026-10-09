import { createSystem, Entity, UIKit, UIKitMLAsset } from '@iwsdk/core';
import { LiveSession, PerformanceRecorder } from '../shadowplay-components.js';
import { playClick } from '../sfx.js';

const PANEL_NODE = 'settings-panel';
const ON = { backgroundColor: '#e0a24a', borderColor: '#f2c47a' };
const OFF = { backgroundColor: '#2b2338', borderColor: '#4a3d5c' };
const DIM = { backgroundColor: '#1d1826', borderColor: '#2e2639' };
const INK = '#1a1320';
const CREAM = '#f6e3bd';
const MUTED = '#6b5f7a';

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
}) {
  private controls = new Map<string, Control>();
  private status: UIKit.Text | undefined;
  private bound = false;
  private shown = '';
  private lastLive = '';
  private lastRec = '';
  private message = 'Record a bedtime story, or go live with your family.';

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
        handler();
      };
      button.addEventListener('click', click);
      this.cleanupFuncs.push(() => button.removeEventListener('click', click));
    };
    on('record-button', 'record-label', () => {
      if (live.getValue(LiveSession, 'role') !== 'off') return;
      rec.setValue(PerformanceRecorder, 'recording', !rec.getValue(PerformanceRecorder, 'recording'));
    });
    on('send-button', 'send-label', () => {
      if (rec.getValue(PerformanceRecorder, 'lastId') && !rec.getValue(PerformanceRecorder, 'recording')) {
        rec.setValue(PerformanceRecorder, 'shareRequested', true);
      }
    });
    on('live-button', 'live-label', () => {
      if (rec.getValue(PerformanceRecorder, 'recording')) return;
      live.setValue(LiveSession, 'role', live.getValue(LiveSession, 'role') === 'off' ? 'host' : 'off');
    });
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
    const liveStatus = live.getValue(LiveSession, 'status') ?? '';
    const recStatus = rec.getValue(PerformanceRecorder, 'status') ?? '';
    const key = `${recording}|${seconds}|${hasStory}|${role}|${talk}|${liveStatus}|${recStatus}`;
    if (key === this.shown) return;
    this.shown = key;

    const isLive = role !== 'off';
    this.set('record-button', recording ? `Stop recording ${clock(seconds)}` : 'Record a story', recording ? 'on' : isLive ? 'dim' : 'off');
    this.set('send-button', 'Send to family', hasStory && !recording ? 'off' : 'dim');
    this.set('live-button', isLive ? 'End live story' : 'Go live', isLive ? 'on' : recording ? 'dim' : 'off');
    this.set('talk-button', `Talk: ${talk ? 'On' : 'Off'}`, talk ? 'on' : isLive ? 'off' : 'dim');
    // Whichever news is newest.
    if (liveStatus !== this.lastLive && liveStatus) this.message = liveStatus;
    else if (recStatus !== this.lastRec && recStatus) this.message = recStatus;
    this.lastLive = liveStatus;
    this.lastRec = recStatus;
    this.status?.setProperties({ text: this.message });
  }

  private set(id: string, text: string, state: 'on' | 'off' | 'dim'): void {
    const c = this.controls.get(id);
    if (!c) return;
    c.button.setProperties(state === 'on' ? ON : state === 'dim' ? DIM : OFF);
    c.label?.setProperties({ text, color: state === 'on' ? INK : state === 'dim' ? MUTED : CREAM });
  }
}

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
