import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { isCode, newCode, normaliseCode } from './codes.ts';

/**
 * Live rooms: a parent (host, in the headset) and one family member (guest,
 * on a phone or tablet) share a shadow theatre in real time. The server only
 * relays messages between the two; nothing is stored. Rooms close when the
 * host leaves, or after MAX_ROOM_MS.
 *
 *   /live?role=host               -> { type: 'room', code }
 *   /live?role=guest&code=CODE    -> { type: 'joined' } (host gets { type: 'guest-joined' })
 *
 * After that, text and binary messages from one side go to the other as-is.
 */
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_ROOM_MS = 2 * 3600_000;

interface Room {
  code: string;
  host: WebSocket;
  guest: WebSocket | null;
  timer: NodeJS.Timeout;
}

const rooms = new Map<string, Room>();

function send(ws: WebSocket | null, message: object): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function closeRoom(room: Room, reason: string): void {
  clearTimeout(room.timer);
  rooms.delete(room.code);
  send(room.guest, { type: 'ended', reason });
  room.guest?.close();
  if (room.host.readyState === WebSocket.OPEN) room.host.close();
}

function relay(from: WebSocket, to: () => WebSocket | null): void {
  from.on('message', (data, isBinary) => {
    const peer = to();
    if (peer && peer.readyState === WebSocket.OPEN) peer.send(data, { binary: isBinary });
  });
}

function hostRoom(ws: WebSocket): void {
  let code = newCode();
  while (rooms.has(code)) code = newCode();
  const room: Room = { code, host: ws, guest: null, timer: setTimeout(() => closeRoom(room, 'time'), MAX_ROOM_MS) };
  rooms.set(code, room);
  send(ws, { type: 'room', code });
  relay(ws, () => room.guest);
  ws.on('close', () => closeRoom(room, 'host-left'));
}

function joinRoom(ws: WebSocket, raw: string): void {
  const code = normaliseCode(raw);
  const room = isCode(code) ? rooms.get(code) : undefined;
  if (!room) {
    send(ws, { type: 'error', error: 'No live story with that code.' });
    ws.close();
    return;
  }
  if (room.guest) {
    send(ws, { type: 'error', error: 'Someone has already joined this story.' });
    ws.close();
    return;
  }
  room.guest = ws;
  send(ws, { type: 'joined', code });
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
      const role = url.searchParams.get('role');
      if (role === 'host') hostRoom(ws);
      else if (role === 'guest') joinRoom(ws, url.searchParams.get('code') ?? '');
      else ws.close();
    });
  });
}

/** For health checks / tests. */
export function liveRoomCount(): number {
  return rooms.size;
}
