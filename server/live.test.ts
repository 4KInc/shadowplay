import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { attachLive, type LiveLimits } from './live.ts';

/** A live server on a free port with tight limits so the tests can reach them. */
async function start(limits: Partial<LiveLimits> = {}): Promise<{ server: Server; url: string }> {
  const server = createServer();
  attachLive(server, { roomsPerHour: 5, joinsPerMinute: 6, messageRate: 1000, messageBurst: 1000, ...limits });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/live` };
}

type Msg = Record<string, unknown>;

/** A socket that collects what it receives. */
function client(url: string): Promise<{ ws: WebSocket; text: Msg[]; binary: Buffer[]; next: (type: string) => Promise<Msg> }> {
  const ws = new WebSocket(url);
  const text: Msg[] = [];
  const binary: Buffer[] = [];
  const waiting: { type: string; resolve: (m: Msg) => void }[] = [];
  ws.on('message', (data, isBinary) => {
    if (isBinary) return void binary.push(data as Buffer);
    const m = JSON.parse(String(data)) as Msg;
    text.push(m);
    const i = waiting.findIndex((w) => w.type === m.type);
    if (i >= 0) waiting.splice(i, 1)[0].resolve(m);
  });
  const next = (type: string) =>
    new Promise<Msg>((resolve, reject) => {
      const seen = text.find((m) => m.type === type);
      if (seen) return resolve(seen);
      waiting.push({ type, resolve });
      setTimeout(() => reject(new Error(`no ${type}`)), 2000);
    });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, text, binary, next }));
    ws.once('error', reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let live: { server: Server; url: string };
before(async () => (live = await start()));
after(() => live.server.close());

async function room() {
  const host = await client(`${live.url}?role=host`);
  const opened = await host.next('room');
  const guest = await client(`${live.url}?role=guest&code=${opened.code}`);
  await guest.next('joined');
  await host.next('guest-joined');
  return { host, guest, code: opened.code as string, token: opened.token as string };
}

test('relays story messages from the host and hands/voice both ways', async () => {
  const { host, guest } = await room();
  host.ws.send(JSON.stringify({ type: 'event', event: { type: 'beat', data: { index: 3 } } }));
  host.ws.send(Buffer.from([1, 0, 5, 0]));
  guest.ws.send(Buffer.from([2, 0, 7, 0]));
  await guest.next('event');
  await sleep(100);
  assert.equal(guest.binary.length, 1);
  assert.equal(host.binary.length, 1);
  host.ws.close();
  guest.ws.close();
});

test('a guest cannot pose as the server or send story messages', async () => {
  const { host, guest } = await room();
  for (const type of ['ended', 'error', 'room', 'host-away', 'event', 'turn', 'state', 'hello']) {
    guest.ws.send(JSON.stringify({ type, error: 'fake', code: 'x', token: 'x' }));
  }
  guest.ws.send('not json');
  guest.ws.send(Buffer.from([9, 0, 1, 0])); // unknown binary kind
  await sleep(200);
  assert.deepEqual(
    host.text.map((m) => m.type),
    ['room', 'guest-joined'],
  );
  assert.equal(host.binary.length, 0);
  host.ws.close();
  guest.ws.close();
});

test('a host can resume after a drop with its token; a wrong token is refused', async () => {
  const { host, guest, code, token } = await room();
  host.ws.terminate();
  await guest.next('host-away');
  const thief = await client(`${live.url}?role=host&code=${code}&token=wrong`);
  assert.equal((await thief.next('error')).error, 'That live story has ended.');
  const back = await client(`${live.url}?role=host&code=${code}&token=${token}`);
  const resumed = await back.next('room');
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.guest, true);
  await guest.next('host-back');
  back.ws.close();
  guest.ws.close();
});

test('ending on purpose closes the room for the guest at once', async () => {
  const { host, guest } = await room();
  host.ws.close(4000, 'ended');
  const ended = await guest.next('ended');
  assert.equal(ended.reason, 'host-left');
});

test('only one guest per room', async () => {
  const { host, guest, code } = await room();
  const second = await client(`${live.url}?role=guest&code=${code}`);
  assert.match(String((await second.next('error')).error), /already joined/);
  host.ws.close();
  guest.ws.close();
});

test('opening rooms and joining are rate limited per address', async () => {
  const limited = await start({ roomsPerHour: 2, joinsPerMinute: 2 });
  const opened = [];
  for (let i = 0; i < 2; i++) {
    const h = await client(`${limited.url}?role=host`);
    await h.next('room');
    opened.push(h);
  }
  const third = await client(`${limited.url}?role=host`);
  assert.match(String((await third.next('error')).error), /Too many live stories/);
  for (let i = 0; i < 2; i++) {
    const g = await client(`${limited.url}?role=guest&code=nope-nope-nope-111`);
    assert.match(String((await g.next('error')).error), /No live story/);
  }
  const guessing = await client(`${limited.url}?role=guest&code=nope-nope-nope-111`);
  assert.match(String((await guessing.next('error')).error), /Too many tries/);
  for (const h of opened) h.ws.close();
  limited.server.close();
});

test('a flood of messages is cut to the per-connection rate', async () => {
  const limited = await start({ messageRate: 10, messageBurst: 10 });
  const host = await client(`${limited.url}?role=host`);
  const opened = await host.next('room');
  const guest = await client(`${limited.url}?role=guest&code=${opened.code}`);
  await guest.next('joined');
  for (let i = 0; i < 200; i++) host.ws.send(Buffer.from([1, 0, i & 255, 0]));
  await sleep(300);
  assert.ok(guest.binary.length <= 15, `received ${guest.binary.length}`);
  assert.ok(guest.binary.length >= 5);
  host.ws.close();
  guest.ws.close();
  limited.server.close();
});
