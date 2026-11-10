import type { Entity } from '@iwsdk/core';
import { deleteRecording, loadRecording } from './journal-store.js';
import type { Performance } from './performance/format.js';
import { sendReply } from './performance/sharing.js';
import { PerformanceRecorder } from './shadowplay-components.js';

/** A goodnight is short. */
const MAX_SECONDS = 20;

export interface ReplyDeps {
  recorder(): Entity | undefined;
  /** Camera on or off for the child's hands (asks a grown-up first if needed). */
  camera(on: boolean, then?: () => void): void;
  /** Every creature free to wake while the child plays. */
  freeMode(on: boolean): void;
}

/**
 * 'Send a goodnight back': after a story from someone far away, the child
 * makes a shadow creature (and, if a grown-up allows, says goodnight out
 * loud) for up to 20 seconds. Only hand positions and the optional voice
 * are sent, attached to the story's private code, to the storyteller alone.
 */
export class ReplySheet {
  private sheet: HTMLDivElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private recordedId = '';
  private wait: ReturnType<typeof setInterval> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Recorder while a goodnight is being recorded (so closing mid-way can stop it). */
  private recording: Entity | null = null;
  private lastIdBefore = '';
  private deps: ReplyDeps;
  private code: string;
  private to: string;
  private from: string;

  constructor(deps: ReplyDeps, code: string, to: string, from: string) {
    this.deps = deps;
    this.code = code;
    this.to = to || 'them';
    this.from = from;
    this.sheet = document.createElement('div');
    this.sheet.className = 'sp-sheet';
    this.sheet.setAttribute('role', 'dialog');
    this.sheet.setAttribute('aria-label', 'Send a goodnight back');
    document.body.appendChild(this.sheet);
    this.showStart();
  }

  private render(html: string): void {
    this.sheet.innerHTML = `<div class="sp-panel">${html}</div>`;
  }

  private on(act: string, fn: () => void): void {
    this.sheet.querySelector(`[data-act="${act}"]`)?.addEventListener('click', fn);
  }

  private showStart(): void {
    this.render(`
      <p class="sp-title">Send a goodnight back to ${escape(this.to)}</p>
      <p>Make a shadow creature in the light and say goodnight. You have ${MAX_SECONDS} seconds.</p>
      <p class="sp-note">For grown-ups: your child's hand movements (never video) and, if you switch it on, their voice
      are sent only to ${escape(this.to)}, with this story's private code.</p>
      <div class="sp-row">
        <button class="sp-btn" data-act="voice" aria-pressed="false">Say it out loud</button>
        <button class="sp-btn on" data-act="start">Start</button>
        <button class="sp-btn" data-act="cancel">Not now</button>
      </div>`);
    let voice = false;
    const voiceBtn = this.sheet.querySelector<HTMLButtonElement>('[data-act="voice"]')!;
    this.on('voice', () => {
      voice = !voice;
      voiceBtn.classList.toggle('on', voice);
      voiceBtn.setAttribute('aria-pressed', String(voice));
    });
    this.on('cancel', () => this.close());
    // The camera may need a grown-up's permission first; recording starts once it is allowed.
    this.on('start', () => this.deps.camera(true, () => this.record(voice)));
  }

  private record(voice: boolean): void {
    const rec = this.deps.recorder();
    if (!rec) return this.close();
    const before = rec.getValue(PerformanceRecorder, 'lastId') ?? '';
    this.deps.freeMode(true);
    rec.setValue(PerformanceRecorder, 'title', `A goodnight from ${this.from || 'your family'}`);
    rec.setValue(PerformanceRecorder, 'performer', this.from);
    rec.setValue(PerformanceRecorder, 'withVoice', voice);
    rec.setValue(PerformanceRecorder, 'recording', true);
    this.recording = rec;
    this.lastIdBefore = before;
    let left = MAX_SECONDS;
    // The sheet steps aside so the stage is visible; a small bar keeps time.
    this.sheet.classList.add('sp-recording');
    this.render(`<div class="sp-row"><span class="sp-status" data-left>Recording... ${left}</span>
      <button class="sp-btn on" data-act="stop">Done</button></div>`);
    const label = this.sheet.querySelector('[data-left]')!;
    this.tick = setInterval(() => {
      left--;
      label.textContent = `Recording... ${Math.max(0, left)}`;
    }, 1000);
    const stop = () => this.stop(rec, before);
    this.on('stop', stop);
    this.timer = setTimeout(stop, MAX_SECONDS * 1000);
  }

  private stop(rec: Entity, before: string): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.tick) clearInterval(this.tick);
    this.timer = this.tick = null;
    rec.setValue(PerformanceRecorder, 'recording', false);
    this.recording = null;
    this.deps.freeMode(false);
    this.deps.camera(false);
    this.sheet.classList.remove('sp-recording');
    this.render('<p class="sp-title">Saving your goodnight...</p>');
    // The recorder saves asynchronously (voice included); wait for the new recording.
    const started = Date.now();
    this.wait = setInterval(() => {
      const id = rec.getValue(PerformanceRecorder, 'lastId') ?? '';
      if (id && id !== before) {
        this.stopWaiting();
        this.recordedId = id;
        this.showSend();
      } else if (Date.now() - started > 15000) {
        this.stopWaiting();
        this.render(`<p class="sp-title">That goodnight could not be saved.</p>
          <div class="sp-row"><button class="sp-btn" data-act="cancel">Close</button></div>`);
        this.on('cancel', () => this.close());
      }
    }, 100);
  }

  private showSend(): void {
    this.render(`
      <p class="sp-title">Send it to ${escape(this.to)}?</p>
      <div class="sp-row">
        <button class="sp-btn on" data-act="send">Send</button>
        <button class="sp-btn" data-act="again">Try again</button>
        <button class="sp-btn" data-act="cancel">Cancel</button>
      </div>
      <div class="sp-note" aria-live="polite"></div>`);
    this.on('send', () => void this.send());
    this.on('again', () => {
      void deleteRecording(this.recordedId);
      this.showStart();
    });
    this.on('cancel', () => {
      void deleteRecording(this.recordedId);
      this.close();
    });
  }

  private async send(): Promise<void> {
    const note = this.sheet.querySelector('.sp-note');
    if (note) note.textContent = 'Sending...';
    try {
      const perf = await loadRecording<Performance>(this.recordedId);
      if (!perf) throw new Error('The goodnight was not saved.');
      await sendReply(this.code, perf);
      // It was for them, not for this device's story list.
      await deleteRecording(this.recordedId);
      this.render(`<p class="sp-title">Sent! ${escape(this.to)} will see it on their wall. Goodnight.</p>`);
      this.closeTimer = setTimeout(() => this.close(), 3500);
    } catch (error) {
      if (note) note.textContent = (error as Error).message;
    }
  }

  private stopWaiting(): void {
    if (this.wait) clearInterval(this.wait);
    this.wait = null;
  }

  /** Full teardown, whenever the sheet goes: timers, and a recording or camera left running. */
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.tick) clearInterval(this.tick);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.timer = this.tick = this.closeTimer = null;
    this.stopWaiting();
    if (this.recording) {
      const rec = this.recording;
      rec.setValue(PerformanceRecorder, 'recording', false);
      // The half-made goodnight is saved a moment later; it was never meant to be kept.
      const before = this.lastIdBefore;
      setTimeout(() => {
        const id = rec.getValue(PerformanceRecorder, 'lastId') ?? '';
        if (id && id !== before) void deleteRecording(id);
      }, 3000);
      this.recording = null;
      this.deps.freeMode(false);
      this.deps.camera(false);
    }
    this.sheet.remove();
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
