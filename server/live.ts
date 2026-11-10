import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { isCode, newCode, normaliseCode } from './codes.ts';
import { clientIp, RateLimiter, TokenBucket } from './guard.ts';

/**
 * Live rooms: a parent (host, in the headset) and one family member (guest,
 * on a phone or tablet) share a shadow theatre in real time. The server only
 * relays messages between the two; nothing is stored. Rooms close when the
 * host leaves for good, or after MAX_ROOM_MS.
 *
 *   /live?role=host                            -> { type: 'room', code, token }
 *   /live?role=host&code=CODE&token=TOKEN      -> { type: 'room', code, token, resumed: true, guest }
 *   /live?role=guest&code=CODE                 -> { type: 'joined', code } (host gets { type: 'guest-joined' })
 *
 * Networks drop (a parent on a base or a ship): when the host's connection
 * goes, the room waits HOST_GRACE_MS for the host to come back with its token
 * (the guest sees host-away / host-back). A guest can simply join again.
 * After joining, the server relays only what the protocol allows: from the
 * host, story messages (hello, state, event, turn); from either side, hand
 * and voice packets. Anything else (for example a guest pretending to be the
 * server with { type: 'ended' }) is dropped. Opening rooms, joining and
 * message rates are limited per address and per connection.
 */
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_ROOM_MS = 2 * 3600_000;
const HOST_GRACE_MS = 45_000;
/** Ping every socket this often; one that misses a pong is dropped (so the other side learns quickly). */
const HEARTBEAT_MS = 15_000;
/** Close code a client sends when the person ends the story on purpose (not a dropout). */
const CLOSE_ENDED = 4000;

/** Limits; tests may tighten them through attachLive's options. */
export interface LiveLimits {
  maxRooms: number;
  /** Rooms one address may open per hour. */
  roomsPerHour: number;
  /** Join attempts one address may make per minute (guards code guessing). */
  joinsPerMinute: number;
  /** Messages per second per connection (hands at 20 Hz and voice at 50 Hz need ~70), and the burst allowed. */
  messageRate: number;
  messageBurst: number;
}
const DEFAULT_LIMITS: LiveLimits = { maxRooms: 500, roomsPerHour: 12, joinsPerMinute: 20, messageRate: 150, messageBurst: 300 };

/** Story messages only the host may send; the guest sends hands and voice only. */
const HOST_TEXT = new Set(['hello', 'state', 'event', 'turn']);
/** Binary packet kinds (src/live/protocol.ts): 1 hands, 2 voice. */
const BINARY_KINDS = new Set([1, 2]);

interface Room {
  code: string;
  token: string;
  host: WebSocket | null;
  guest: WebSocket | null;
  timer: NodeJS.Timeout;
  grace: NodeJS.Timeout | null;
}

const rooms = new Map<string, Room>();
const alive = new WeakSet<WebSocket>();

function send(ws: WebSocket | null, message: object): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function closeRoom(room: Room, reason: string): void {
  clearTimeout(room.timer);
  if (room.grace) clearTimeout(room.grace);
  rooms.delete(room.code);
  send(room.guest, { type: 'ended', reason });
  room.guest?.close();
  if (room.host && room.host.readyState === WebSocket.OPEN) room.host.close();
}

let limits = DEFAULT_LIMITS;

/** Only what the protocol allows, at a sane rate, reaches the other side. */
function relay(from: WebSocket, role: 'host' | 'guest', to: () => WebSocket | null): void {
  const bucket = new TokenBucket(limits.messageRate, limits.messageBurst);
  from.on('message', (data, isBinary) => {
    if (!bucket.take()) return;
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
    if (isBinary) {
      if (buf.length < 2 || !BINARY_KINDS.has(buf[0])) return;
    } else {
      if (role !== 'host') return;
      let type: unknown;
      try {
        type = (JSON.parse(buf.toString('utf8')) as { type?: unknown }).type;
      } catch {
        return;
      }
      if (typeof type !== 'string' || !HOST_TEXT.has(type)) return;
    }
    const peer = to();
    if (peer && peer.readyState === WebSocket.OPEN) peer.send(buf, { binary: isBinary });
  });
}

function attachHost(room: Room, ws: WebSocket): void {
  room.host = ws;
  relay(ws, 'host', () => room.guest);
  ws.on('close', (code) => {
    if (room.host !== ws || !rooms.has(room.code)) return;
    if (code === CLOSE_ENDED) return closeRoom(room, 'host-left');
    room.host = null;
    send(room.guest, { type: 'host-away' });
    room.grace = setTimeout(() => closeRoom(room, 'host-left'), HOST_GRACE_MS);
    room.grace.unref();
  });
}

function hostRoom(ws: WebSocket, resumeCode: string | null, token: string | null): void {
  if (resumeCode) {
    const room = rooms.get(normaliseCode(resumeCode));
    if (!room || !token || token !== room.token) {
      send(ws, { type: 'error', error: 'That live story has ended.' });
      ws.close();
      return;
    }
    if (room.grace) clearTimeout(room.grace);
    room.grace = null;
    // A stale connection the server has not noticed yet gives way to the new one.
    const old = room.host;
    attachHost(room, ws);
    if (old && old !== ws) old.terminate();
    send(ws, { type: 'room', code: room.code, token: room.token, resumed: true, guest: room.guest !== null });
    send(room.guest, { type: 'host-back' });
    return;
  }
  let code = newCode();
  while (rooms.has(code)) code = newCode();
  const room: Room = {
    code,
    token: randomBytes(18).toString('base64url'),
    host: null,
    guest: null,
    timer: setTimeout(() => closeRoom(room, 'time'), MAX_ROOM_MS).unref(),
    grace: null,
  };
  rooms.set(code, room);
  attachHost(room, ws);
  send(ws, { type: 'room', code, token: room.token });
}

function joinRoom(ws: WebSocket, raw: string): void {
  const code = normaliseCode(raw);
  const room = isCode(code) ? rooms.get(code) : undefined;
  if (!room) {
    send(ws, { type: 'error', error: 'No live story with that code.' });
    ws.close();
    return;
  }
  if (room.guest && room.guest.readyState === WebSocket.OPEN) {
    // Often our own guest coming back before the server noticed the old connection drop: retry.
    send(ws, { type: 'error', error: 'Someone has already joined this story.', retry: true });
    ws.close();
    return;
  }
  room.guest = ws;
  send(ws, { type: 'joined', code, hostAway: room.host === null });
  send(room.host, { type: 'guest-joined' });
  relay(ws, 'guest', () => room.host);
  ws.on('close', () => {
    if (room.guest === ws) {
      room.guest = null;
      send(room.host, { type: 'guest-left' });
    }
  });
}

function refuse(ws: WebSocket, error: string): void {
  send(ws, { type: 'error', error });
  ws.close();
}

export function attachLive(server: Server, options: Partial<LiveLimits> = {}): void {
  limits = { ...DEFAULT_LIMITS, ...options };
  const opens = new RateLimiter(3600_000, limits.roomsPerHour);
  const joins = new RateLimiter(60_000, limits.joinsPerMinute);
  const prune = setInterval(() => {
    opens.prune();
    joins.prune();
  }, 600_000);
  prune.unref();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname !== '/live') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      alive.add(ws);
      ws.on('pong', () => alive.add(ws));
      const role = url.searchParams.get('role');
      const code = url.searchParams.get('code');
      const ip = clientIp(req);
      if (role === 'host') {
        // Resuming an existing room is not opening a new one.
        if (!code && rooms.size >= limits.maxRooms) return refuse(ws, 'Live stories are busy right now. Try again soon.');
        if (!code && !opens.allow(ip)) return refuse(ws, 'Too many live stories opened. Try again later.');
        hostRoom(ws, code, url.searchParams.get('token'));
      } else if (role === 'guest') {
        if (!joins.allow(ip)) return refuse(ws, 'Too many tries. Wait a minute.');
        joinRoom(ws, code ?? '');
      } else ws.close();
    });
  });
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  beat.unref();
  server.on('close', () => {
    clearInterval(beat);
    clearInterval(prune);
  });
}

/** For health checks / tests. */
export function liveRoomCount(): number {
  return rooms.size;
}
