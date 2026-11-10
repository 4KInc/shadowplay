import { createSystem, Entity } from '@iwsdk/core';
import { family } from '../family.js';
import { applyEvent, ApplyTargets, applyTargets } from '../performance/apply.js';
import { FRAME_STRIDE, readFrame, writeFrame } from '../performance/format.js';
import { storyTap, TapEvent } from '../performance/story-tap.js';
import {
  DeskLamp,
  HiddenProp,
  LiveSession,
  Moth,
  PerformancePlayer,
  Scenery,
  ShadowPuppet,
  ShapeRecognizer,
  Stage,
  StageActor,
  StoryState,
} from '../shadowplay-components.js';
import { isStoryScript, loadStoryScript, StoryBeat, storyRuntime } from '../story-script.js';
import { handOverride, handRuntime, JOINT_COUNT, secondHands, stageRuntime, xrSecond } from '../stage-runtime.js';
import { LiveConnection } from './connection.js';
import { HANDS_HZ, HEADER_BYTES, KIND_HANDS, KIND_VOICE, packBinary, PeerMessage, ServerMessage } from './protocol.js';
import { LiveVoice } from './voice.js';

/** A hand not heard from for this long (ms) disappears. */
const HAND_TIMEOUT_MS = 500;
/** How quickly received hands catch up with the latest packet (1/s). */
const SMOOTHING = 22;
/** Reconnect attempts after a dropped connection: delays (s), then give up. */
const RECONNECT_DELAYS = [1, 2, 3, 5, 8, 8, 8, 8];
/** A guest's turn passes back to the host after this long (s) without the guest's hands. */
const GUEST_IDLE_SECONDS = 12;

/** Received hands, eased between 20 Hz packets. */
class SmoothedHands {
  readonly left = new Float32Array(JOINT_COUNT * 3);
  readonly right = new Float32Array(JOINT_COUNT * 3);
  private targetL = new Float32Array(JOINT_COUNT * 3);
  private targetR = new Float32Array(JOINT_COUNT * 3);
  hasLeft = false;
  hasRight = false;
  private at = 0;

  receive(frame: Int16Array): void {
    const had = { left: this.hasLeft, right: this.hasRight };
    const got = readFrame(frame, 1, 0, this.targetL, this.targetR);
    // A hand that just appeared snaps into place instead of flying in.
    if (got.left && !had.left) this.left.set(this.targetL);
    if (got.right && !had.right) this.right.set(this.targetR);
    this.hasLeft = got.left;
    this.hasRight = got.right;
    this.at = performance.now();
  }

  step(delta: number): void {
    if (performance.now() - this.at > HAND_TIMEOUT_MS) this.hasLeft = this.hasRight = false;
    const a = 1 - Math.exp(-delta * SMOOTHING);
    if (this.hasLeft) ease(this.left, this.targetL, a);
    if (this.hasRight) ease(this.right, this.targetR, a);
  }

  clear(): void {
    this.hasLeft = this.hasRight = false;
  }
}

function ease(out: Float32Array, target: Float32Array, a: number): void {
  for (let i = 0; i < out.length; i++) out[i] += (target[i] - out[i]) * a;
}

/**
 * Live bedtime stories. The host (a parent in the headset) runs the story; the
 * guest's stage follows it beat by beat. Each side sends its hands 20 times a
 * second, so both shadows share both walls: on the guest's stage the host's
 * hands perform (driving the creatures) and the guest's own camera hands join
 * as a second pair; on the host's stage the guest's hands are the second pair.
 * Voice flows both ways once each person switches talking on.
 */
export class LiveSystem extends createSystem({
  sessions: { required: [LiveSession] },
  stories: { required: [StoryState] },
  players: { required: [PerformancePlayer] },
  recognizers: { required: [ShapeRecognizer] },
  puppets: { required: [ShadowPuppet] },
  lamps: { required: [DeskLamp] },
  moths: { required: [Moth] },
  scenery: { required: [Scenery] },
  actors: { required: [StageActor] },
  stages: { required: [Stage] },
  props: { required: [HiddenProp] },
}) {
  private conn: LiveConnection | null = null;
  private role: 'off' | 'host' | 'guest' = 'off';
  private voice = new LiveVoice();
  private remote = new SmoothedHands();
  private frame = new Int16Array(FRAME_STRIDE);
  private handsPacket = new ArrayBuffer(HEADER_BYTES + FRAME_STRIDE * 2);
  private handsView = new Int16Array(this.handsPacket, HEADER_BYTES);
  private sendEvery = 1 / HANDS_HZ;
  private sinceSend = 0;
  private pending: TapEvent[] = [];
  private targets!: ApplyTargets;
  private unsubscribeTap: (() => void) | null = null;
  private micStarting = false;
  private turn: 'host' | 'guest' = 'host';
  private beats: StoryBeat[] = [];
  private requests = 0;
  private guestIdle = 0;
  private hostScript = '';
  /** The room's code (host: from the server; guest: what they typed) and the host's resume token. */
  private roomCode = '';
  private token = '';
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** The server has accepted us at least once (so a drop is worth reconnecting). */
  private wasConnected = false;
  /** Host: the script last announced to the guest. */
  private sentScript = '';

  init(): void {
    this.targets = applyTargets(this.queries);
    new Uint8Array(this.handsPacket)[0] = KIND_HANDS;
    this.cleanupFuncs.push(() => this.leave(null, ''));
  }

  update(delta: number): void {
    const session = first(this.queries.sessions.entities);
    if (!session) return;
    const want = session.getValue(LiveSession, 'role') ?? 'off';
    if (want !== this.role) {
      if (this.role !== 'off') this.leave(session, '', false);
      if (want === 'host' || want === 'guest') this.start(session, want);
    }
    if (this.role === 'off') return;

    this.updateTalk(session);
    if (session.getValue(LiveSession, 'hearing') !== this.voice.hearing) {
      session.setValue(LiveSession, 'hearing', this.voice.hearing);
    }
    if (!stageRuntime.ready) return;
    // Host events wait until this stage is telling the host's story.
    const scriptReady = !this.hostScript || storyRuntime.script === this.hostScript;
    // At most one beat per frame (the story reads one enterBeat per update).
    while (scriptReady && this.pending.length) {
      const e = this.pending.shift()!;
      this.applyRemote(e);
      if (e.type === 'beat') break;
    }

    this.remote.step(delta);
    const peerHands = (this.remote.hasLeft ? 1 : 0) + (this.remote.hasRight ? 1 : 0);
    if (session.getValue(LiveSession, 'peerHands') !== peerHands) session.setValue(LiveSession, 'peerHands', peerHands);
    // Whoever's turn it is performs (their hands drive recognition and the
    // creatures); the other person's hands cast as the second pair.
    const remoteLeads = (this.role === 'guest') === (this.turn === 'host');
    if (remoteLeads) {
      handOverride.active = true;
      handOverride.source = 'live';
      handOverride.left = this.remote.hasLeft ? this.remote.left : null;
      handOverride.right = this.remote.hasRight ? this.remote.right : null;
    } else {
      if (this.role === 'host' && handOverride.source === 'live') this.releaseOverride();
      secondHands.left = this.remote.hasLeft ? this.remote.left : null;
      secondHands.right = this.remote.hasRight ? this.remote.right : null;
    }
    if (this.role === 'host' && this.turn === 'guest') {
      this.guestIdle = peerHands > 0 ? 0 : this.guestIdle + delta;
      if (this.guestIdle > GUEST_IDLE_SECONDS) {
        this.setTurn(session, 'host');
        session.setValue(LiveSession, 'status', 'Your turn again.');
      }
    }

    // Host switched stories: tell the guest before the new story's events arrive.
    if (this.role === 'host' && storyRuntime.script && storyRuntime.script !== this.sentScript && session.getValue(LiveSession, 'peerPresent')) {
      this.sendHello();
    }

    this.sinceSend += delta;
    if (this.sinceSend >= this.sendEvery && this.conn?.open && session.getValue(LiveSession, 'peerPresent')) {
      this.sinceSend = 0;
      this.sendHands();
    }
  }

  private start(session: Entity, role: 'host' | 'guest'): void {
    const code = session.getValue(LiveSession, 'joinCode') ?? '';
    if (role === 'guest' && !code.trim()) {
      session.setValue(LiveSession, 'role', 'off');
      session.setValue(LiveSession, 'status', 'Enter the family code to join.');
      return;
    }
    this.role = role;
    session.setValue(LiveSession, 'status', role === 'host' ? 'Opening a live story...' : 'Joining...');
    if (role === 'guest') {
      // Follow the host's story; the guest's own camera hands become the second pair.
      const story = first(this.queries.stories.entities);
      story?.setValue(StoryState, 'followMode', true);
      handOverride.cameraTarget = 'second';
      first(this.queries.players.entities)?.setValue(PerformancePlayer, 'playing', false);
    }
    if (role === 'host') {
      const script = first(this.queries.stories.entities)?.getValue(StoryState, 'script') ?? '';
      void loadStoryScript(script)
        .then((s) => (this.beats = s.beats))
        .catch(() => (this.beats = []));
    }
    this.roomCode = role === 'guest' ? code.trim() : '';
    this.token = '';
    this.retry = 0;
    this.wasConnected = false;
    this.connect(session);
  }

  private connect(session: Entity): void {
    if (this.role === 'off') return;
    // Callbacks from an older connection (replaced or closed) are ignored.
    const conn: LiveConnection = new LiveConnection(this.role, this.roomCode, this.token, {
      onServer: (m) => this.conn === conn && this.onServer(session, m),
      onPeer: (m) => this.conn === conn && this.onPeer(m),
      onBinary: (kind, payload) => this.conn === conn && this.onBinary(kind, payload),
      onClose: () => this.conn === conn && this.onClosed(session),
    });
    this.conn = conn;
  }

  private onServer(session: Entity, m: ServerMessage): void {
    switch (m.type) {
      case 'room':
        this.connectedOk();
        this.roomCode = m.code;
        this.token = m.token;
        session.setValue(LiveSession, 'connected', true);
        session.setValue(LiveSession, 'code', m.code);
        if (m.resumed && m.guest) {
          // Back after a drop with the family still here: bring their stage up to date.
          this.onServer(session, { type: 'guest-joined' });
          session.setValue(LiveSession, 'status', 'Reconnected. The story goes on.');
        } else {
          if (m.resumed) this.guestLeft(session);
          session.setValue(LiveSession, 'status', `Live! Family code: ${m.code}`);
        }
        break;
      case 'joined':
        this.connectedOk();
        session.setValue(LiveSession, 'connected', true);
        session.setValue(LiveSession, 'peerPresent', !m.hostAway);
        session.setValue(LiveSession, 'code', m.code);
        session.setValue(LiveSession, 'status', m.hostAway ? 'Waiting for the storyteller to reconnect...' : 'Joined! The story is live.');
        break;
      case 'host-away':
        session.setValue(LiveSession, 'peerPresent', false);
        session.setValue(LiveSession, 'status', 'The storyteller\'s connection dropped. Waiting for them...');
        this.remote.clear();
        break;
      case 'host-back':
        session.setValue(LiveSession, 'peerPresent', true);
        session.setValue(LiveSession, 'status', 'They\'re back! The story goes on.');
        break;
      case 'guest-joined':
        session.setValue(LiveSession, 'peerPresent', true);
        session.setValue(LiveSession, 'status', 'Your family joined. Tell the story!');
        this.sendHello();
        this.conn?.send({ type: 'state', events: storyTap.current() });
        this.requests = 0;
        this.setTurn(session, 'host');
        this.unsubscribeTap ??= storyTap.subscribe((event) => {
          if (storyRuntime.script !== this.sentScript) this.sendHello();
          this.conn?.send({ type: 'event', event });
          if (event.type === 'beat') this.onHostBeat(session, Number(event.data.index));
        });
        break;
      case 'guest-left':
        this.guestLeft(session);
        session.setValue(LiveSession, 'status', `Your family left. Family code: ${session.getValue(LiveSession, 'code')}`);
        break;
      case 'ended':
        this.leave(session, m.reason === 'host-left' ? 'The story has ended. Goodnight!' : 'The live story ended.');
        break;
      case 'error':
        // Rejoining while the server still holds our old connection: the close that follows retries.
        if (m.retry && this.wasConnected) break;
        this.leave(session, m.error);
        break;
    }
  }

  private onPeer(m: PeerMessage): void {
    if (this.role !== 'guest') return; // Only the host's story drives a stage.
    if (m.type === 'hello') {
      family.borrow({ performer: m.performer, child: m.child });
      this.hostScript = isStoryScript(m.script) ? m.script : '';
      if (this.hostScript) first(this.queries.stories.entities)?.setValue(StoryState, 'script', m.script);
    }
    else if (m.type === 'state') this.pending.push(...m.events);
    else if (m.type === 'event') this.pending.push(m.event);
    else if (m.type === 'turn') {
      const session = first(this.queries.sessions.entities);
      if (session) this.setTurn(session, m.who);
    }
  }

  private sendHello(): void {
    this.sentScript = storyRuntime.script;
    this.conn?.send({ type: 'hello', performer: family.own.performer, child: family.own.child, script: storyRuntime.script });
  }

  /** Host, duet on: every other shape request is the guest's, until that creature bows out. */
  private onHostBeat(session: Entity, index: number): void {
    const type = this.beats[index]?.type;
    if (type === 'release' && this.turn === 'guest') {
      this.setTurn(session, 'host');
      session.setValue(LiveSession, 'status', 'Well done, both of you! Your turn next.');
      return;
    }
    if (type !== 'request' || !session.getValue(LiveSession, 'duet') || this.turn !== 'host') return;
    this.requests++;
    if (this.requests % 2 === 1) {
      this.setTurn(session, 'guest');
      session.setValue(LiveSession, 'status', "Your family's turn: they make the shape.");
    }
  }

  private setTurn(session: Entity, who: 'host' | 'guest'): void {
    const changed = who !== this.turn;
    this.turn = who;
    this.guestIdle = 0;
    if (session.getValue(LiveSession, 'turn') !== who) session.setValue(LiveSession, 'turn', who);
    if (this.role === 'host') {
      handOverride.xrToSecond = who === 'guest';
      this.conn?.send({ type: 'turn', who });
    } else if (this.role === 'guest') {
      // The guest's camera hands perform on their turn, and join as the second pair otherwise.
      handOverride.cameraTarget = who === 'guest' ? 'override' : 'second';
      if (secondHands.left === this.remote.left) secondHands.left = null;
      if (secondHands.right === this.remote.right) secondHands.right = null;
      if (who === 'guest' && handOverride.source === 'live') this.releaseOverride();
    }
    if (changed && who === 'host' && this.role === 'host') this.releaseOverride();
  }

  private releaseOverride(): void {
    if (handOverride.source !== 'live') return;
    handOverride.active = false;
    handOverride.left = handOverride.right = null;
    handOverride.source = '';
  }

  private applyRemote(e: TapEvent): void {
    if (e.type === 'beat') {
      first(this.queries.stories.entities)?.setValue(StoryState, 'enterBeat', Number(e.data.index));
    } else {
      applyEvent(e, this.targets);
    }
  }

  private onBinary(kind: number, payload: Int16Array): void {
    if (kind === KIND_HANDS && payload.length === FRAME_STRIDE && stageRuntime.ready) this.remote.receive(payload);
    else if (kind === KIND_VOICE) this.voice.play(payload);
  }

  private sendHands(): void {
    let left: Float32Array | null;
    let right: Float32Array | null;
    const leading = (this.role === 'host') === (this.turn === 'host');
    if (leading) {
      left = handRuntime.left.tracked ? handRuntime.left.joints : null;
      right = handRuntime.right.tracked ? handRuntime.right.joints : null;
    } else if (this.role === 'host') {
      left = xrSecond.left;
      right = xrSecond.right;
    } else {
      // Guest during the host's turn: their camera hands, if shown.
      left = secondHands.left === this.remote.left ? null : secondHands.left;
      right = secondHands.right === this.remote.right ? null : secondHands.right;
    }
    if (!left && !right) return;
    this.frame.fill(0);
    writeFrame(this.frame, 0, left, right);
    // WebSocket.send copies, so one packet buffer is reused.
    this.handsView.set(this.frame);
    this.conn?.sendBinary(this.handsPacket);
  }

  private updateTalk(session: Entity): void {
    const talk = Boolean(session.getValue(LiveSession, 'talk')) && Boolean(this.conn?.open);
    if (talk && !this.voice.micOpen && !this.micStarting) {
      this.micStarting = true;
      this.voice
        .startMic((pcm) => this.conn?.sendBinary(packBinary(KIND_VOICE, pcm)))
        .then(() => {
          if (!session.getValue(LiveSession, 'talk') || this.role === 'off') this.voice.stopMic();
        })
        .catch((error: Error) => {
          session.setValue(LiveSession, 'talk', false);
          session.setValue(LiveSession, 'status', `Microphone unavailable (${error.message}).`);
        })
        .finally(() => (this.micStarting = false));
    } else if (!talk && this.voice.micOpen) {
      this.voice.stopMic();
    }
    if (session.getValue(LiveSession, 'talking') !== this.voice.micOpen) {
      session.setValue(LiveSession, 'talking', this.voice.micOpen);
    }
  }

  private guestLeft(session: Entity): void {
    session.setValue(LiveSession, 'peerPresent', false);
    this.unsubscribeTap?.();
    this.unsubscribeTap = null;
    this.remote.clear();
    this.setTurn(session, 'host');
  }

  private connectedOk(): void {
    this.wasConnected = true;
    this.retry = 0;
  }

  /** A dropped connection: try again for a while before giving up (the room waits for the host). */
  private onClosed(session: Entity): void {
    if (this.role === 'off') return;
    this.conn = null;
    const delay = RECONNECT_DELAYS[this.retry];
    if (!this.wasConnected || delay === undefined || (this.role === 'host' && !this.token)) {
      this.leave(session, 'Lost the connection to the live story.');
      return;
    }
    this.retry++;
    session.setValue(LiveSession, 'connected', false);
    session.setValue(LiveSession, 'peerPresent', false);
    session.setValue(LiveSession, 'status', 'Connection lost. Reconnecting...');
    this.remote.clear();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect(session);
    }, delay * 1000);
  }

  /** Disconnect and put this stage back to normal. `session` null: system teardown. */
  private leave(session: Entity | null, status: string, resetRole = true): void {
    const wasGuest = this.role === 'guest';
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.token = '';
    this.roomCode = '';
    this.conn?.close();
    this.conn = null;
    this.unsubscribeTap?.();
    this.unsubscribeTap = null;
    this.voice.dispose();
    this.remote.clear();
    this.pending.length = 0;
    this.hostScript = '';
    if (secondHands.left === this.remote.left) secondHands.left = null;
    if (secondHands.right === this.remote.right) secondHands.right = null;
    this.releaseOverride();
    handOverride.xrToSecond = false;
    this.turn = 'host';
    if (wasGuest) {
      family.borrow(null);
      handOverride.cameraTarget = 'override';
      first(this.queries.stories.entities)?.setValue(StoryState, 'followMode', false);
    }
    this.role = 'off';
    if (!session) return;
    if (resetRole) session.setValue(LiveSession, 'role', 'off');
    session.setValue(LiveSession, 'connected', false);
    session.setValue(LiveSession, 'peerPresent', false);
    session.setValue(LiveSession, 'talk', false);
    session.setValue(LiveSession, 'talking', false);
    session.setValue(LiveSession, 'hearing', false);
    session.setValue(LiveSession, 'peerHands', 0);
    session.setValue(LiveSession, 'turn', 'host');
    session.setValue(LiveSession, 'code', '');
    if (status) session.setValue(LiveSession, 'status', status);
  }
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
