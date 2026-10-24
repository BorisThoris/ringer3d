import type { LobbyClientMsg, LobbyServerMsg, RoomInfo } from './protocol';

type Handler = (m: LobbyServerMsg) => void;

export const DEFAULT_ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** WebSocket connection to the lobby/signaling server (server browser + WebRTC handshakes). */
export class LobbyClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  peerId = '';
  iceServers: RTCIceServer[] = DEFAULT_ICE;
  private opened: Promise<void> | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  connect(timeoutMs = 6000): Promise<void> {
    if (this.opened) return this.opened;
    this.opened = new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error(`Couldn't reach the lobby server at ${this.url}.`));
        }
      }, timeoutMs);
      ws.onmessage = (ev) => {
        let msg: LobbyServerMsg;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (msg.t === 'welcome') {
          this.peerId = msg.peerId;
          if (msg.iceServers?.length) this.iceServers = msg.iceServers;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        }
        this.handlers.forEach((h) => h(msg));
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Couldn't reach the lobby server at ${this.url}.`));
        }
      };
      ws.onclose = () => {
        this.handlers.forEach((h) => h({ t: 'error', message: 'Lost connection to the lobby server.' }));
        this.opened = null;
      };
    });
    return this.opened;
  }

  send(m: LobbyClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  /** Ask once, resolve with the next message of the given type. */
  request<T extends LobbyServerMsg['t']>(m: LobbyClientMsg, expect: T, timeoutMs = 6000): Promise<Extract<LobbyServerMsg, { t: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('The lobby server did not answer in time.'));
      }, timeoutMs);
      const off = this.on((msg) => {
        if (msg.t === expect) {
          clearTimeout(timer);
          off();
          resolve(msg as Extract<LobbyServerMsg, { t: T }>);
        } else if (msg.t === 'error') {
          clearTimeout(timer);
          off();
          reject(new Error(msg.message));
        }
      });
      this.send(m);
    });
  }

  async listRooms(): Promise<RoomInfo[]> {
    const r = await this.request({ t: 'list' }, 'rooms');
    return r.rooms;
  }

  close() {
    this.handlers.clear();
    this.ws?.close();
    this.ws = null;
    this.opened = null;
  }
}
