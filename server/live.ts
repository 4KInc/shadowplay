import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { isCode, newCode, normaliseCode } from './codes.ts';

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
 * After joining, text and binary messages from one side go to the other as-is.
 */
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_ROOM_MS = 2 * 3600_000;
const HOST_GRACE_MS = 45_000;
/** Ping every socket this often; one that misses a pong is dropped (so the other side learns quickly). */
const HEARTBEAT_MS = 15_000;

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

function relay(from: WebSocket, to: () => WebSocket | null): void {
  from.on('message', (data, isBinary) => {
    const peer = to();
    if (peer && peer.readyState === WebSocket.OPEN) peer.send(data, { binary: isBinary });
  });
}

function attachHost(room: Room, ws: WebSocket): void {
  room.host = ws;
  relay(ws, () => room.guest);
  ws.on('close', () => {
    if (room.host !== ws || !rooms.has(room.code)) return;
    room.host = null;
    send(room.guest, { type: 'host-away' });
    room.grace = setTimeout(() => closeRoom(room, 'host-left'), HOST_GRACE_MS);
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
    timer: setTimeout(() => closeRoom(room, 'time'), MAX_ROOM_MS),
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
  relay(ws, () => room.host);
  ws.on('close', () => {
    if (room.guest === ws) {
      room.guest = null;
      send(room.host, { type: 'guest-left' });
    }
  });
}

export function attachLive(server: Server): void {
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
      if (role === 'host') hostRoom(ws, code, url.searchParams.get('token'));
      else if (role === 'guest') joinRoom(ws, code ?? '');
      else ws.close();
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
  server.on('close', () => clearInterval(beat));
}

/** For health checks / tests. */
export function liveRoomCount(): number {
  return rooms.size;
}
