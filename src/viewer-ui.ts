import { createSystem, Entity } from '@iwsdk/core';
import { listRecordings } from './journal-store.js';
import type { Performance } from './performance/format.js';
import { fetchStory } from './performance/sharing.js';
import { LiveSession, PerformancePlayer, WebcamHands } from './shadowplay-components.js';
import { family, FamilyNames } from './family.js';
import { viewerMode } from './viewer-mode.js';

const CONSENT_KEY = 'shadowplay.cameraConsent';

const CSS = `
.sp-viewer { position: fixed; left: 0; right: 0; bottom: 0; z-index: 900; padding: 12px 16px calc(14px + env(safe-area-inset-bottom, 0px));
  font: 16px/1.35 Georgia, 'Times New Roman', serif; color: #f6e3bd; pointer-events: none; }
.sp-viewer * { box-sizing: border-box; }
.sp-viewer [hidden] { display: none !important; }
/* While a story plays: a compact pill in the corner, so the stage captions stay visible. */
.sp-viewer.playing .sp-panel { width: max-content; margin: 0 0 0 auto; padding: 8px; }
.sp-viewer.playing .sp-title, .sp-viewer.playing .sp-status { display: none; }
.sp-panel { pointer-events: auto; max-width: 760px; margin: 0 auto; background: rgba(18, 13, 26, 0.88);
  border: 1px solid #6b4f2a; border-radius: 18px; padding: 14px; backdrop-filter: blur(6px); }
.sp-title { font-style: italic; color: #f2c47a; font-size: 18px; margin: 0 0 10px; }
.sp-list { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; scroll-snap-type: x mandatory; }
.sp-card { scroll-snap-align: start; flex: 0 0 min(240px, 70vw); text-align: left; background: #2b2338; color: #f6e3bd;
  border: 1px solid #4a3d5c; border-radius: 14px; padding: 12px; font: inherit; cursor: pointer; }
.sp-card b { display: block; color: #f2c47a; margin-bottom: 4px; }
.sp-card small { color: #bfae8e; }
.sp-empty { color: #bfae8e; font-style: italic; }
.sp-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.sp-btn { min-height: 56px; min-width: 56px; padding: 0 20px; border-radius: 28px; border: 2px solid #e0a24a;
  background: #3a2716; color: #f2c47a; font: inherit; font-size: 18px; cursor: pointer; }
.sp-btn.on { background: #e0a24a; color: #1a1320; }
.sp-status { flex: 1 1 200px; color: #f6e3bd; }
.sp-turn { pointer-events: none; position: fixed; left: 50%; top: calc(18px + env(safe-area-inset-top, 0px)); transform: translateX(-50%);
  z-index: 901; padding: 12px 22px; border-radius: 26px; background: #e0a24a; color: #1a1320; font: italic 600 22px Georgia, serif;
  box-shadow: 0 6px 24px rgba(0,0,0,0.45); }
.sp-sheet { pointer-events: auto; position: fixed; inset: 0; z-index: 950; display: flex; align-items: flex-end; justify-content: center;
  background: rgba(8, 6, 12, 0.6); padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
.sp-sheet .sp-panel { max-width: 520px; }
.sp-sheet p { margin: 0 0 12px; }
.sp-code { display: flex; gap: 8px; margin-top: 10px; }
.sp-code input { flex: 1 1 auto; min-height: 48px; border-radius: 24px; border: 1px solid #6b4f2a; background: #1d1826;
  color: #f6e3bd; font: inherit; padding: 0 16px; }
.sp-note { color: #bfae8e; font-size: 14px; margin-top: 6px; min-height: 1.2em; }
.sp-card.new { border-color: #e0a24a; box-shadow: 0 0 0 2px rgba(224,162,74,0.5); }
.sp-viewer.playing .sp-code, .sp-viewer.playing .sp-note { display: none; }
.sp-wait { pointer-events: none; position: fixed; left: 50%; top: calc(18px + env(safe-area-inset-top, 0px)); transform: translateX(-50%);
  z-index: 901; max-width: calc(100vw - 32px); padding: 10px 20px; border-radius: 24px; background: rgba(43, 35, 56, 0.94);
  border: 1px solid #6b4f2a; color: #f6e3bd; font: italic 18px Georgia, serif; text-align: center; }
.sp-goodnight { position: fixed; inset: 0; z-index: 940; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 24px; text-align: center; background: radial-gradient(circle at 50% 40%, rgba(58, 39, 22, 0.92), rgba(8, 6, 12, 0.96));
  font-family: Georgia, 'Times New Roman', serif; cursor: pointer; animation: sp-fade 1.6s ease-out; }
.sp-goodnight b { font-size: clamp(30px, 8vw, 56px); font-style: italic; font-weight: 600; color: #f2c47a; }
.sp-goodnight span { font-size: clamp(18px, 4.5vw, 26px); color: #f6e3bd; }
.sp-goodnight small { margin-top: 18px; color: #8f7f66; font-size: 14px; }
@keyframes sp-fade { from { opacity: 0; } to { opacity: 1; } }
`;

/**
 * The family viewer: a phone/tablet page for watching a bedtime story a
 * parent recorded, and joining in with your own hands through the camera
 * (only after a grown-up allows it; frames stay on the device).
 */
export class ViewerUISystem extends createSystem({
  players: { required: [PerformancePlayer] },
  webcams: { required: [WebcamHands] },
  sessions: { required: [LiveSession] },
}) {
  private root: HTMLDivElement | null = null;
  private list: HTMLDivElement | null = null;
  private controls: HTMLDivElement | null = null;
  private status: HTMLDivElement | null = null;
  private turn: HTMLDivElement | null = null;
  private pauseBtn: HTMLButtonElement | null = null;
  private joinBtn: HTMLButtonElement | null = null;
  private lastPlaying: boolean | null = null;
  private lastStatus = '';
  private form: HTMLFormElement | null = null;
  private note: HTMLDivElement | null = null;
  private liveControls: HTMLDivElement | null = null;
  private liveStatus: HTMLDivElement | null = null;
  private talkBtn: HTMLButtonElement | null = null;
  private handsBtn: HTMLButtonElement | null = null;
  private lastLive: boolean | null = null;
  private waitBanner: HTMLDivElement | null = null;
  private lastLiveStatus = '';
  /** What the camera is for right now: joining in to a replay, or showing hands in a live story. */
  private cameraFor: 'replay' | 'live' = 'replay';
  /** Names of the story playing now, for the goodnight card. */
  private playingNames: FamilyNames | null = null;
  /** Most recently opened shared story (highlighted in the list). */
  private highlight = '';

  private style: HTMLStyleElement | null = null;

  init(): void {
    if (import.meta.env.DEV) {
      const onKey = (e: KeyboardEvent) => {
        if (e.repeat || e.metaKey || e.ctrlKey || e.key.toLowerCase() !== 'v') return;
        viewerMode.on = !viewerMode.on;
      };
      window.addEventListener('keydown', onKey);
      this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKey));
    }
    this.cleanupFuncs.push(() => this.teardownUI());
  }

  private teardownUI(): void {
    this.style?.remove();
    this.style = null;
    this.root?.remove();
    this.root = null;
    this.turn?.remove();
    this.turn = null;
    this.waitBanner?.remove();
    this.waitBanner = null;
    this.lastPlaying = null;
  }

  private build(): void {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    const root = document.createElement('div');
    root.className = 'sp-viewer';
    root.innerHTML = `
      <div class="sp-panel">
        <p class="sp-title">Bedtime stories</p>
        <div class="sp-list" aria-label="Stories"></div>
        <form class="sp-code" autocomplete="off">
          <input name="code" placeholder="Family code, e.g. lantern-otter-moss-417" aria-label="Family code" />
          <button class="sp-btn" type="submit">Open</button>
          <button class="sp-btn" type="button" data-act="live">Join live</button>
        </form>
        <div class="sp-note" aria-live="polite"></div>
        <div class="sp-row sp-controls" hidden>
          <button class="sp-btn" data-act="pause" aria-label="Pause">Pause</button>
          <button class="sp-btn" data-act="join" aria-label="Join in with your hands">Join in</button>
          <button class="sp-btn" data-act="stop" aria-label="Stop">Stop</button>
          <div class="sp-status" aria-live="polite"></div>
        </div>
        <div class="sp-row sp-live" hidden>
          <button class="sp-btn" data-act="talk" aria-label="Talk">Talk</button>
          <button class="sp-btn" data-act="hands" aria-label="Show my hands">My hands</button>
          <button class="sp-btn" data-act="leave" aria-label="Leave the live story">Leave</button>
          <div class="sp-status sp-live-status" aria-live="polite"></div>
        </div>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.list = root.querySelector('.sp-list');
    this.controls = root.querySelector('.sp-controls');
    this.status = root.querySelector('.sp-status');
    this.pauseBtn = root.querySelector('[data-act="pause"]');
    this.joinBtn = root.querySelector('[data-act="join"]');
    root.querySelector('[data-act="stop"]')?.addEventListener('click', () => this.performanceEntity()?.setValue(PerformancePlayer, 'playing', false));
    this.pauseBtn?.addEventListener('click', () => {
      const p = this.performanceEntity();
      p?.setValue(PerformancePlayer, 'paused', !p.getValue(PerformancePlayer, 'paused'));
    });
    this.joinBtn?.addEventListener('click', () => this.toggleJoin());
    this.liveControls = root.querySelector('.sp-live');
    this.liveStatus = root.querySelector('.sp-live-status');
    this.talkBtn = root.querySelector('[data-act="talk"]');
    this.handsBtn = root.querySelector('[data-act="hands"]');
    this.talkBtn?.addEventListener('click', () => {
      const live = this.liveEntity();
      live?.setValue(LiveSession, 'talk', !live.getValue(LiveSession, 'talk'));
    });
    this.handsBtn?.addEventListener('click', () => this.toggleCamera('live'));
    root.querySelector('[data-act="leave"]')?.addEventListener('click', () => this.liveEntity()?.setValue(LiveSession, 'role', 'off'));
    root.querySelector('[data-act="live"]')?.addEventListener('click', () => {
      const input = this.form?.querySelector('input');
      if (input?.value.trim()) this.joinLive(input.value);
      else if (this.note) this.note.textContent = 'Type the family code first.';
    });
    this.form = root.querySelector('.sp-code');
    this.note = root.querySelector('.sp-note');
    this.form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.form?.querySelector('input');
      if (input?.value.trim()) void this.openCode(input.value);
    });
    // The list is filled here; update() only refreshes it after a story ends.
    this.lastPlaying = false;
    void this.refreshList();
    // A shared link (?watch=CODE) brings the story straight in.
    const params = new URLSearchParams(location.search);
    const code = params.get('watch');
    if (code) void this.openCode(code);
    // A live link (?live=CODE): one tap to join (which also lets the browser play the voice).
    const liveCode = params.get('live');
    if (liveCode) this.offerLive(liveCode);
  }

  private liveEntity(): Entity | undefined {
    return first(this.queries.sessions.entities);
  }

  private joinLive(code: string): void {
    const live = this.liveEntity();
    if (!live) return;
    this.performanceEntity()?.setValue(PerformancePlayer, 'playing', false);
    live.setValue(LiveSession, 'joinCode', code.trim());
    live.setValue(LiveSession, 'role', 'guest');
    if (this.note) this.note.textContent = '';
  }

  private offerLive(code: string): void {
    const sheet = document.createElement('div');
    sheet.className = 'sp-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Join the live story');
    sheet.innerHTML = `
      <div class="sp-panel">
        <p class="sp-title">A bedtime story is starting</p>
        <p>Someone who loves you is about to tell a shadow story, live.</p>
        <div class="sp-row">
          <button class="sp-btn on" data-act="join-live">Join the story</button>
          <button class="sp-btn" data-act="no">Not now</button>
        </div>
      </div>`;
    document.body.appendChild(sheet);
    sheet.querySelector('[data-act="join-live"]')?.addEventListener('click', () => {
      sheet.remove();
      this.joinLive(code);
    });
    sheet.querySelector('[data-act="no"]')?.addEventListener('click', () => sheet.remove());
  }

  private performanceEntity(): Entity | undefined {
    return first(this.queries.players.entities);
  }

  /** Fetch a shared story by family code and put it at the front of the list. */
  private async openCode(code: string): Promise<void> {
    if (this.note) this.note.textContent = 'Opening your story...';
    try {
      const perf = await fetchStory(code);
      this.highlight = perf.id;
      if (this.note) this.note.textContent = `"${perf.title}" is here. Tap it to watch.`;
      await this.refreshList();
    } catch (error) {
      if (this.note) this.note.textContent = (error as Error).message;
    }
  }

  private async refreshList(): Promise<void> {
    if (!this.list) return;
    const recordings = (await listRecordings<Performance>()).sort(
      (a, b) => Number(b.id === this.highlight) - Number(a.id === this.highlight) || b.createdAt - a.createdAt,
    );
    this.list.replaceChildren();
    if (recordings.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sp-empty';
      empty.textContent = 'No stories yet. When someone records a bedtime story for you, it will appear here.';
      this.list.appendChild(empty);
      return;
    }
    for (const r of recordings) {
      const card = document.createElement('button');
      card.className = 'sp-card';
      const minutes = Math.max(1, Math.round(r.durationMs / 60000));
      card.innerHTML = `<b></b><span></span><br><small></small>`;
      card.querySelector('b')!.textContent = r.title;
      card.querySelector('span')!.textContent = r.performer ? `from ${r.performer}` : '';
      card.querySelector('small')!.textContent = `${minutes} min · ${new Date(r.createdAt).toLocaleDateString()}`;
      card.setAttribute('aria-label', `Watch ${r.title}${r.performer ? ` from ${r.performer}` : ''}`);
      if (r.id === this.highlight) card.classList.add('new');
      card.addEventListener('click', () => this.watch(r.id));
      this.list.appendChild(card);
    }
  }

  private watch(id: string): void {
    const p = this.performanceEntity();
    if (!p) return;
    p.setValue(PerformancePlayer, 'recordingId', id);
    p.setValue(PerformancePlayer, 'paused', false);
    p.setValue(PerformancePlayer, 'playing', true);
  }

  /** Join in: needs the camera, which a grown-up must allow once on this device. */
  private toggleJoin(): void {
    this.toggleCamera('replay');
  }

  private toggleCamera(purpose: 'replay' | 'live'): void {
    const on = !this.cameraOn();
    if (on && !this.hasConsent()) {
      this.askConsent(purpose);
      return;
    }
    this.setCamera(on, purpose);
  }

  private cameraOn(): boolean {
    return Boolean(first(this.queries.webcams.entities)?.getValue(WebcamHands, 'enabled'));
  }

  private setCamera(on: boolean, purpose: 'replay' | 'live' = this.cameraFor): void {
    this.cameraFor = purpose;
    if (purpose === 'replay') this.performanceEntity()?.setValue(PerformancePlayer, 'joinIn', on);
    for (const w of this.queries.webcams.entities) w.setValue(WebcamHands, 'enabled', on);
  }

  private hasConsent(): boolean {
    try {
      return localStorage.getItem(CONSENT_KEY) === 'yes';
    } catch {
      return false;
    }
  }

  private askConsent(purpose: 'replay' | 'live'): void {
    const sheet = document.createElement('div');
    sheet.className = 'sp-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Allow the camera');
    sheet.innerHTML = `
      <div class="sp-panel">
        <p class="sp-title">For grown-ups: allow the camera?</p>
        <p>To join in, Shadowplay uses this device's camera to see your child's hands and turn them into shadows.
        The video stays on this device. Nothing is recorded or sent.</p>
        <div class="sp-row">
          <button class="sp-btn on" data-act="yes">Allow camera</button>
          <button class="sp-btn" data-act="no">Not now</button>
        </div>
      </div>`;
    document.body.appendChild(sheet);
    sheet.querySelector('[data-act="yes"]')?.addEventListener('click', () => {
      try {
        localStorage.setItem(CONSENT_KEY, 'yes');
      } catch {
        // Private mode: ask again next time.
      }
      sheet.remove();
      this.setCamera(true, purpose);
    });
    sheet.querySelector('[data-act="no"]')?.addEventListener('click', () => sheet.remove());
  }

  update(): void {
    if (viewerMode.on && !this.root) this.build();
    if (!viewerMode.on && this.root) this.teardownUI();
    if (!this.root) return;
    const p = this.performanceEntity();
    if (!p) return;
    const playing = Boolean(p.getValue(PerformancePlayer, 'playing'));
    if (playing !== this.lastPlaying) {
      this.lastPlaying = playing;
      if (this.list) this.list.hidden = playing;
      if (this.controls) this.controls.hidden = !playing;
      this.root.classList.toggle('playing', playing || Boolean(this.lastLive));
      if (!playing) {
        if (p.getValue(PerformancePlayer, 'status') === 'Finished.' && this.playingNames) this.goodnight(this.playingNames);
        this.playingNames = null;
        // Story over: the camera goes off.
        if (p.getValue(PerformancePlayer, 'joinIn')) this.setCamera(false, 'replay');
        void this.refreshList();
      }
    }
    if (playing && family.current !== family.own) this.playingNames ??= { ...family.current };
    this.updateLive();
    // Touch the DOM only when something changed.
    const pauseLabel = p.getValue(PerformancePlayer, 'paused') ? 'Play' : 'Pause';
    if (this.pauseBtn && this.pauseBtn.textContent !== pauseLabel) this.pauseBtn.textContent = pauseLabel;
    const joined = Boolean(p.getValue(PerformancePlayer, 'joinIn'));
    if (this.joinBtn && this.joinBtn.classList.contains('on') !== joined) this.joinBtn.classList.toggle('on', joined);
    const status = p.getValue(PerformancePlayer, 'status') ?? '';
    if (status !== this.lastStatus && this.status) {
      this.lastStatus = status;
      this.status.textContent = status;
    }
    // Your turn: a join-in moment in a replay, or the guest's turn in a live duet.
    const live = this.liveEntity();
    const liveTurn = live?.getValue(LiveSession, 'role') === 'guest' && live.getValue(LiveSession, 'turn') === 'guest';
    const yourTurn = Boolean(p.getValue(PerformancePlayer, 'inJoinIn')) || liveTurn;
    const turnText = liveTurn && !this.cameraOn() ? 'Your turn! Tap My hands to play.' : 'Your turn! Make the shape with your hands.';
    if (yourTurn && !this.turn) {
      this.turn = document.createElement('div');
      this.turn.className = 'sp-turn';
      document.body.appendChild(this.turn);
    } else if (!yourTurn && this.turn) {
      this.turn.remove();
      this.turn = null;
    }
    if (this.turn && this.turn.textContent !== turnText) this.turn.textContent = turnText;
  }

  /** The live-story row: shown while this device is a guest in a live story. */
  private updateLive(): void {
    const live = this.liveEntity();
    if (!live || !this.root) return;
    const on = live.getValue(LiveSession, 'role') === 'guest';
    if (on !== this.lastLive) {
      this.lastLive = on;
      if (this.liveControls) this.liveControls.hidden = !on;
      if (this.list) this.list.hidden = on || Boolean(this.lastPlaying);
      this.root.classList.toggle('playing', on || Boolean(this.lastPlaying));
      // Live story over: the camera goes off.
      if (!on && this.cameraFor === 'live' && this.cameraOn()) this.setCamera(false, 'live');
    }
    const status = live.getValue(LiveSession, 'status') ?? '';
    if (status !== this.lastLiveStatus) {
      this.lastLiveStatus = status;
      if (this.liveStatus) this.liveStatus.textContent = status;
      if (!on && status && this.note) this.note.textContent = status;
    }
    // Connection trouble or a storyteller who stepped away: say so where a child will see it.
    const waiting = on && !live.getValue(LiveSession, 'peerPresent');
    if (waiting && !this.waitBanner) {
      this.waitBanner = document.createElement('div');
      this.waitBanner.className = 'sp-wait';
      this.waitBanner.setAttribute('role', 'status');
      document.body.appendChild(this.waitBanner);
    } else if (!waiting && this.waitBanner) {
      this.waitBanner.remove();
      this.waitBanner = null;
    }
    if (this.waitBanner && this.waitBanner.textContent !== status) this.waitBanner.textContent = status;
    if (!on) return;
    const talking = Boolean(live.getValue(LiveSession, 'talk'));
    if (this.talkBtn && this.talkBtn.classList.contains('on') !== talking) {
      this.talkBtn.classList.toggle('on', talking);
      this.talkBtn.textContent = talking ? 'Talking' : 'Talk';
    }
    const hands = this.cameraOn();
    if (this.handsBtn && this.handsBtn.classList.contains('on') !== hands) this.handsBtn.classList.toggle('on', hands);
  }

  /** The end of a story someone recorded for you: their goodnight, by name. */
  private goodnight(names: FamilyNames): void {
    const card = document.createElement('div');
    card.className = 'sp-goodnight';
    card.setAttribute('role', 'dialog');
    card.innerHTML = '<b></b><span></span><small>Tap to close</small>';
    card.querySelector('b')!.textContent = names.child ? `Goodnight, ${names.child}.` : 'Goodnight.';
    card.querySelector('span')!.textContent = names.performer ? `Sweet dreams. Love, ${names.performer}` : 'Sweet dreams.';
    const close = () => card.remove();
    card.addEventListener('click', close);
    setTimeout(close, 12000);
    document.body.appendChild(card);
  }
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
