/**
 * Lobby + signalling server. Holds rooms in memory, lists public ones (the
 * server browser), hands out room codes, forwards WebRTC signalling between
 * peers in a room, and relays game messages for peers whose networks block
 * a direct connection. It never runs the game: the host does.
 *
 * Written with erasable TypeScript only, so `node server/index.ts` runs it.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import { CODE_ALPHABET, PROTOCOL_VERSION, type LobbyEvent, type LobbyRequest, type RoomInfo, type RoomSettings } from '../src/net/protocol.ts';

interface Client {
  id: string;
  name: string;
  ws: WebSocket;
  room: Room | null;
  /** Token bucket for rate limiting. */
  tokens: number;
  last: number;
}

interface Room {
  id: string;
  code: string;
  settings: RoomSettings;
  host: Client;
  members: Map<string, Client>;
  inGame: boolean;
  created: number;
}

export interface LobbyOptions {
  maxRooms?: number;
  /** Messages per second a client may sustain (bursts up to 4x). */
  rate?: number;
  path?: string;
}

const MAX_MESSAGE = 64 * 1024;

export function attachLobby(server: Server, opts: LobbyOptions = {}) {
  const maxRooms = opts.maxRooms ?? 500;
  const rate = opts.rate ?? 60;
  const wss = new WebSocketServer({ server, path: opts.path ?? '/lobby', maxPayload: MAX_MESSAGE });
  const clients = new Map<string, Client>();
  const rooms = new Map<string, Room>();
  const byCode = new Map<string, Room>();
  let seq = 0;

  const newId = (p: string) => `${p}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  function newCode(): string {
    for (let tries = 0; tries < 1000; tries++) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!byCode.has(c)) return c;
    }
    throw new Error('out of room codes');
  }

  const send = (c: Client, e: LobbyEvent) => {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(e));
  };

  function info(r: Room): RoomInfo {
    return {
      id: r.id,
      code: r.code,
      name: r.settings.name,
      hostName: r.host.name,
      players: r.members.size,
      max: r.settings.max,
      arena: r.settings.arena,
      majority: r.settings.majority,
      isPublic: r.settings.isPublic,
      inGame: r.inGame,
    };
  }

  function publicRooms(): RoomInfo[] {
    return [...rooms.values()]
      .filter((r) => r.settings.isPublic)
      .map(info)
      .sort((a, b) => Number(a.inGame) - Number(b.inGame) || b.players - a.players);
  }

  function broadcastRoom(r: Room) {
    const e: LobbyEvent = { t: 'room', room: info(r) };
    for (const m of r.members.values()) send(m, e);
  }

  function leave(c: Client) {
    const r = c.room;
    if (!r) return;
    c.room = null;
    r.members.delete(c.id);
    if (r.host === c) {
      // The host runs the game; without it the room is over.
      for (const m of r.members.values()) {
        m.room = null;
        send(m, { t: 'host-left' });
      }
      rooms.delete(r.id);
      byCode.delete(r.code);
      return;
    }
    for (const m of r.members.values()) send(m, { t: 'peer-left', id: c.id });
    broadcastRoom(r);
  }

  function clean(settings: Partial<RoomSettings>, base: RoomSettings): RoomSettings {
    const s = { ...base, ...settings };
    return {
      name: String(s.name ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 32) || `${base.name}`,
      isPublic: !!s.isPublic,
      max: Math.max(2, Math.min(4, Math.floor(Number(s.max) || 2))),
      arena: String(s.arena ?? 'schoolyard').slice(0, 24),
      majority: !!s.majority,
    };
  }

  function handle(c: Client, msg: LobbyRequest) {
    switch (msg.t) {
      case 'hello':
        c.name = String(msg.name ?? 'Player').replace(/[\u0000-\u001f]/g, '').slice(0, 20) || 'Player';
        if (msg.version !== PROTOCOL_VERSION) send(c, { t: 'error', message: 'Please update the game to play online.' });
        return;
      case 'list':
        send(c, { t: 'rooms', rooms: publicRooms() });
        return;
      case 'create': {
        if (rooms.size >= maxRooms) return send(c, { t: 'error', message: 'The server is full right now. Try again soon.' });
        leave(c);
        const settings = clean(msg.settings ?? {}, { name: `${c.name}'s ring`, isPublic: true, max: 2, arena: 'schoolyard', majority: false });
        const r: Room = { id: newId('r'), code: newCode(), settings, host: c, members: new Map([[c.id, c]]), inGame: false, created: Date.now() };
        rooms.set(r.id, r);
        byCode.set(r.code, r);
        c.room = r;
        send(c, { t: 'joined', room: info(r), you: c.id, host: c.id, peers: [] });
        return;
      }
      case 'join': {
        const r = byCode.get(String(msg.code ?? '').toUpperCase().trim());
        if (!r) return send(c, { t: 'error', message: 'No ring with that code.' });
        if (r.members.has(c.id)) return;
        if (r.members.size >= r.settings.max) return send(c, { t: 'error', message: 'That ring is full.' });
        if (r.inGame) return send(c, { t: 'error', message: 'That match has already started.' });
        leave(c);
        const peers = [...r.members.values()].map((m) => ({ id: m.id, name: m.name }));
        r.members.set(c.id, c);
        c.room = r;
        send(c, { t: 'joined', room: info(r), you: c.id, host: r.host.id, peers });
        for (const m of r.members.values()) if (m !== c) send(m, { t: 'peer-joined', peer: { id: c.id, name: c.name } });
        broadcastRoom(r);
        return;
      }
      case 'leave':
        leave(c);
        return;
      case 'update': {
        const r = c.room;
        if (!r || r.host !== c) return send(c, { t: 'error', message: 'Only the host can change the ring.' });
        r.settings = clean(msg.settings ?? {}, r.settings);
        if (typeof msg.settings?.inGame === 'boolean') r.inGame = msg.settings.inGame;
        broadcastRoom(r);
        return;
      }
      case 'signal':
      case 'relay': {
        const r = c.room;
        if (!r) return;
        const targets = msg.t === 'relay' && msg.to === '*' ? [...r.members.values()].filter((m) => m !== c) : [r.members.get(String(msg.to))];
        for (const m of targets) {
          // Only within the same room: a peer id from elsewhere goes nowhere.
          if (!m) continue;
          send(m, msg.t === 'signal' ? { t: 'signal', from: c.id, data: msg.data } : { t: 'relay', from: c.id, data: msg.data });
        }
        return;
      }
      case 'ping':
        send(c, { t: 'pong', at: msg.at });
        return;
    }
  }

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    const c: Client = { id: newId('p'), name: 'Player', ws, room: null, tokens: rate * 4, last: Date.now() };
    clients.set(c.id, c);
    send(c, { t: 'welcome', you: c.id, version: PROTOCOL_VERSION });
    ws.on('message', (raw) => {
      const now = Date.now();
      c.tokens = Math.min(rate * 4, c.tokens + ((now - c.last) / 1000) * rate);
      c.last = now;
      if (c.tokens < 1) return; // over the limit: drop quietly
      c.tokens -= 1;
      let msg: LobbyRequest;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return send(c, { t: 'error', message: 'bad message' });
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      handle(c, msg);
    });
    ws.on('close', () => {
      leave(c);
      clients.delete(c.id);
    });
    ws.on('error', () => ws.terminate());
  });

  // Drop dead connections so ghost rooms do not linger in the browser.
  const alive = new WeakMap<WebSocket, boolean>();
  wss.on('connection', (ws: WebSocket) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 20000);

  return {
    wss,
    stats: () => ({ clients: clients.size, rooms: rooms.size }),
    close: () => {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
