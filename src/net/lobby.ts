/**
 * Lobby client: one WebSocket to the lobby server for the server browser,
 * rooms, signalling and the relay fallback.
 */
import { PROTOCOL_VERSION, type LobbyEvent, type LobbyRequest, type RoomInfo, type RoomSettings } from './protocol';

type Handler<E extends LobbyEvent['t']> = (e: Extract<LobbyEvent, { t: E }>) => void;
export type Joined = Extract<LobbyEvent, { t: 'joined' }>;

/** Where the lobby lives: an explicit build-time URL, else the page's own host. */
export function lobbyUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_LOBBY_URL;
  if (env) return env;
  if (typeof location === 'undefined' || location.protocol === 'file:') return 'ws://localhost:8787/lobby';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/lobby`;
}

export class LobbyClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<(e: LobbyEvent) => void>>();
  you = '';
  /** Round-trip time to the lobby, ms. */
  rtt = 0;
  private pinger = 0;

  constructor(readonly url = lobbyUrl()) {}

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(name: string, timeoutMs = 6000): Promise<void> {
    if (this.connected) {
      this.send({ t: 'hello', name, version: PROTOCOL_VERSION });
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('Could not reach the lobby server.'));
      }, timeoutMs);
      ws.onmessage = (m) => {
        let e: LobbyEvent;
        try {
          e = JSON.parse(String(m.data));
        } catch {
          return;
        }
        if (e.t === 'welcome') {
          clearTimeout(timer);
          this.you = e.you;
          this.send({ t: 'hello', name, version: PROTOCOL_VERSION });
          this.pinger = window.setInterval(() => this.send({ t: 'ping', at: performance.now() }), 5000);
          resolve();
        }
        if (e.t === 'pong') this.rtt = Math.round(performance.now() - e.at);
        this.handlers.get(e.t)?.forEach((h) => h(e));
        this.handlers.get('*')?.forEach((h) => h(e));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Could not reach the lobby server.'));
      };
      ws.onclose = () => {
        clearInterval(this.pinger);
        this.handlers.get('closed')?.forEach((h) => h({ t: 'error', message: 'Disconnected from the lobby.' }));
      };
    });
  }

  on<E extends LobbyEvent['t']>(t: E | '*' | 'closed', h: Handler<E>): () => void {
    let set = this.handlers.get(t);
    if (!set) this.handlers.set(t, (set = new Set()));
    set.add(h as (e: LobbyEvent) => void);
    return () => set!.delete(h as (e: LobbyEvent) => void);
  }

  /** Resolve with the next event of kind `t`, or reject on an error event / timeout. */
  private next<E extends LobbyEvent['t']>(t: E, ms = 5000): Promise<Extract<LobbyEvent, { t: E }>> {
    return new Promise((resolve, reject) => {
      const offs: (() => void)[] = [];
      const done = () => offs.forEach((o) => o());
      const timer = setTimeout(() => (done(), reject(new Error('The lobby did not answer.'))), ms);
      offs.push(this.on(t, (e) => (clearTimeout(timer), done(), resolve(e))));
      offs.push(this.on('error', (e) => (clearTimeout(timer), done(), reject(new Error(e.message)))));
    });
  }

  send(m: LobbyRequest): void {
    if (this.connected) this.ws!.send(JSON.stringify(m));
  }

  async list(): Promise<RoomInfo[]> {
    const p = this.next('rooms');
    this.send({ t: 'list' });
    return (await p).rooms;
  }

  async create(settings: RoomSettings): Promise<Joined> {
    const p = this.next('joined');
    this.send({ t: 'create', settings });
    return p;
  }

  async join(code: string): Promise<Joined> {
    const p = this.next('joined');
    this.send({ t: 'join', code });
    return p;
  }

  leave(): void {
    this.send({ t: 'leave' });
  }

  close(): void {
    clearInterval(this.pinger);
    this.ws?.close();
    this.ws = null;
  }
}
