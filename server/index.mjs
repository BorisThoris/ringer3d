#!/usr/bin/env node
/**
 * Ringer 3D lobby server.
 *
 *  - Server browser: hosts register rooms; anyone can list public ones.
 *  - Join by 4-letter room code (private rooms are code-only).
 *  - WebRTC signaling: forwards offers/answers/ICE between host and joiners so matches run
 *    peer to peer.
 *  - Relay fallback: if two peers can't connect directly, game messages are relayed here.
 *  - Optionally serves the built web app from ../dist, so one process hosts everything.
 *
 * Env: PORT (default 8787), STATIC_DIR (default ../dist), ICE_SERVERS (JSON array, optional;
 * e.g. to hand clients a TURN server). STEAM_PUBLISHER_KEY + STEAM_APP_ID (+ STEAM_SANDBOX=1)
 * turn on the Steam coin-pack store (steamStore.mjs); PLAY_SERVICE_ACCOUNT (+ PLAY_PACKAGE) the
 * Google Play purchase check (playStore.mjs).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createSteamStore } from './steamStore.mjs';
import { createPlayStore, loadServiceAccount } from './playStore.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const here = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = process.env.STATIC_DIR ?? join(here, '..', 'dist');
const ICE = process.env.ICE_SERVERS ? JSON.parse(process.env.ICE_SERVERS) : undefined;
const MAX_MSG = 64 * 1024;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion

/** @type {Map<string, {ws: import('ws').WebSocket, roomId: string|null, name: string, alive: boolean, rate: number}>} */
const clients = new Map();
/** @type {Map<string, {id: string, code: string, name: string, hostId: string, hostName: string, arena: string, players: number, maxPlayers: number, private: boolean, started: boolean, version: number, members: Set<string>, createdAt: number}>} */
const rooms = new Map();

const log = (...a) => console.log(new Date().toISOString(), ...a);

function send(id, msg) {
  const c = clients.get(id);
  if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
}

function publicRoom(r) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    arena: r.arena,
    players: r.players,
    maxPlayers: r.maxPlayers,
    private: r.private,
    started: r.started,
    hostName: r.hostName,
    version: r.version,
  };
}

function newCode() {
  for (let tries = 0; tries < 1000; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (![...rooms.values()].some((r) => r.code === c)) return c;
  }
  throw new Error('out of codes');
}

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);

function leaveRoom(id) {
  const c = clients.get(id);
  if (!c?.roomId) return;
  const room = rooms.get(c.roomId);
  c.roomId = null;
  if (!room) return;
  room.members.delete(id);
  if (room.hostId === id) {
    for (const m of room.members) {
      send(m, { t: 'room-closed' });
      const mc = clients.get(m);
      if (mc) mc.roomId = null;
    }
    rooms.delete(room.id);
    log('room closed', room.code);
  } else {
    send(room.hostId, { t: 'peer-left', peerId: id });
  }
}

function sameRoom(a, b) {
  const ca = clients.get(a);
  const cb = clients.get(b);
  return !!(ca && cb && ca.roomId && ca.roomId === cb.roomId);
}

function handle(id, msg) {
  const c = clients.get(id);
  if (!c) return;
  switch (msg.t) {
    case 'list': {
      const list = [...rooms.values()].filter((r) => !r.private).sort((a, b) => Number(a.started) - Number(b.started) || b.createdAt - a.createdAt).slice(0, 100).map(publicRoom);
      send(id, { t: 'rooms', rooms: list });
      break;
    }
    case 'create': {
      leaveRoom(id);
      const room = {
        id: randomUUID(),
        code: newCode(),
        name: clean(msg.name, 28) || 'Ringer room',
        hostId: id,
        hostName: clean(msg.hostName, 14) || 'Host',
        arena: clean(msg.arena, 20) || 'schoolyard',
        players: 1,
        maxPlayers: Math.min(4, Math.max(2, Number(msg.maxPlayers) || 2)),
        private: !!msg.private,
        started: false,
        version: Number(msg.version) || 0,
        members: new Set([id]),
        createdAt: Date.now(),
      };
      rooms.set(room.id, room);
      c.roomId = room.id;
      c.name = room.hostName;
      send(id, { t: 'created', room: publicRoom(room) });
      log('room created', room.code, room.name);
      break;
    }
    case 'join': {
      const room = msg.roomId ? rooms.get(msg.roomId) : [...rooms.values()].find((r) => r.code === clean(msg.code, 4).toUpperCase());
      if (!room) return send(id, { t: 'error', message: 'No room with that code. Check it and try again.' });
      if (room.version !== Number(msg.version)) return send(id, { t: 'error', message: 'That room is running a different game version.' });
      if (room.started) return send(id, { t: 'error', message: 'That match already started.' });
      if (room.members.size >= room.maxPlayers) return send(id, { t: 'error', message: 'That room is full.' });
      leaveRoom(id);
      room.members.add(id);
      c.roomId = room.id;
      c.name = clean(msg.name, 14) || 'Player';
      send(id, { t: 'joined', room: publicRoom(room), hostId: room.hostId });
      send(room.hostId, { t: 'peer-joined', peerId: id, name: c.name });
      break;
    }
    case 'update': {
      const room = c.roomId && rooms.get(c.roomId);
      if (!room || room.hostId !== id) return;
      room.players = Math.max(1, Math.min(room.maxPlayers, Number(msg.players) || 1));
      room.started = !!msg.started;
      room.arena = clean(msg.arena, 20) || room.arena;
      break;
    }
    case 'signal':
    case 'relay': {
      if (typeof msg.to !== 'string' || !sameRoom(id, msg.to)) return;
      send(msg.to, { t: msg.t, from: id, data: msg.data });
      break;
    }
    case 'leave':
      leaveRoom(id);
      break;
  }
}

// ---- HTTP (static app + health) --------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
};

const steamStore = createSteamStore({ key: process.env.STEAM_PUBLISHER_KEY, appId: process.env.STEAM_APP_ID, sandbox: process.env.STEAM_SANDBOX === '1' });
const playStore = createPlayStore({ account: loadServiceAccount(process.env.PLAY_SERVICE_ACCOUNT), packageName: process.env.PLAY_PACKAGE ?? 'com.boristhoris.ringer3d' });

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.startsWith('/steam/') || url.pathname.startsWith('/play/')) {
    const shop = url.pathname.startsWith('/play/') ? playStore : steamStore;
    let body = null;
    if (req.method === 'POST') {
      let text = '';
      for await (const chunk of req) {
        text += chunk;
        if (text.length > 8192) break;
      }
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    const [status, out] = (await shop(req.method ?? 'GET', url.pathname, body).catch(() => [500, { error: 'store error' }])) ?? [404, { error: 'not found' }];
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' });
    res.end(out ? JSON.stringify(out) : '');
    return;
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: clients.size }));
    return;
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  const file = join(STATIC_DIR, path);
  if (!file.startsWith(STATIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(await readFile(file));
  } catch {
    try {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(await readFile(join(STATIC_DIR, 'index.html')));
    } catch {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('Ringer 3D lobby server is running. Build the web app (npm run build) to serve it from here too.');
    }
  }
});

// ---- WebSocket --------------------------------------------------------------------------
const wss = new WebSocketServer({ server: http, maxPayload: MAX_MSG });

wss.on('connection', (ws) => {
  const id = randomUUID();
  const client = { ws, roomId: null, name: '', alive: true, rate: 0 };
  clients.set(id, client);
  ws.send(JSON.stringify({ t: 'welcome', peerId: id, iceServers: ICE }));
  ws.on('pong', () => (client.alive = true));
  ws.on('message', (raw) => {
    // Simple flood protection: 200 messages per second window.
    if (++client.rate > 200) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg && typeof msg.t === 'string') handle(id, msg);
  });
  ws.on('close', () => {
    leaveRoom(id);
    clients.delete(id);
  });
});

setInterval(() => {
  for (const c of clients.values()) c.rate = 0;
}, 1000);

// Heartbeat: drop clients that didn't answer the previous ping.
setInterval(() => {
  for (const [id, c] of clients) {
    if (!c.alive) {
      c.ws.terminate();
      leaveRoom(id);
      clients.delete(id);
      continue;
    }
    c.alive = false;
    c.ws.ping();
  }
}, 15000);

http.listen(PORT, () => log(`Ringer 3D lobby on :${PORT} (static: ${STATIC_DIR})`));
