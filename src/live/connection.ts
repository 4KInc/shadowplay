import { PeerMessage, ServerMessage, unpackBinary } from './protocol.js';

export interface LiveHandlers {
  onServer(message: ServerMessage): void;
  onPeer(message: PeerMessage): void;
  onBinary(kind: number, payload: Int16Array): void;
  onClose(): void;
}

/** Live room socket: the same origin's /live endpoint (proxied in dev). */
export class LiveConnection {
  private ws: WebSocket;
  private closed = false;

  private handlers: LiveHandlers;

  /** Host: no code opens a new room; a code and token resume one. Guest: the code to join. */
  constructor(role: 'host' | 'guest', code: string, token: string, handlers: LiveHandlers) {
    this.handlers = handlers;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const resume = code && token ? `&code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}` : '';
    const query = role === 'host' ? `role=host${resume}` : `role=guest&code=${encodeURIComponent(code)}`;
    this.ws = new WebSocket(`${proto}//${location.host}/live?${query}`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (e) => this.receive(e.data);
    this.ws.onclose = () => {
      if (this.closed) return;
      this.closed = true;
      handlers.onClose();
    };
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  /** Skip realtime data (hands, voice) when the socket is backed up rather than queueing lag. */
  get congested(): boolean {
    return this.ws.bufferedAmount > 256 * 1024;
  }

  send(message: PeerMessage): void {
    if (this.open) this.ws.send(JSON.stringify(message));
  }

  sendBinary(data: ArrayBuffer): void {
    if (this.open && !this.congested) this.ws.send(data);
  }

  close(): void {
    this.closed = true;
    this.ws.close();
  }

  private receive(data: unknown): void {
    if (data instanceof ArrayBuffer) {
      const msg = unpackBinary(data);
      if (msg) this.handlers.onBinary(msg.kind, msg.payload);
      return;
    }
    let msg: { type?: string };
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    switch (msg.type) {
      case 'room':
      case 'joined':
      case 'guest-joined':
      case 'guest-left':
      case 'host-away':
      case 'host-back':
      case 'ended':
      case 'error':
        this.handlers.onServer(msg as ServerMessage);
        break;
      case 'hello':
      case 'state':
      case 'event':
      case 'turn':
        this.handlers.onPeer(msg as PeerMessage);
        break;
    }
  }
}
