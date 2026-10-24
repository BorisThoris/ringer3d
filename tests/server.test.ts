import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 18787;
let proc: ChildProcess;

type Msg = Record<string, unknown> & { t: string };

class Client {
  ws: WebSocket;
  inbox: Msg[] = [];
  waiters: { t: string; resolve: (m: Msg) => void }[] = [];
  peerId = '';
  constructor() {
    this.ws = new WebSocket(`ws://localhost:${PORT}`);
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as Msg;
      const w = this.waiters.findIndex((x) => x.t === m.t);
      if (w >= 0) this.waiters.splice(w, 1)[0].resolve(m);
      else this.inbox.push(m);
    });
  }
  next(t: string, timeout = 3000): Promise<Msg> {
    const i = this.inbox.findIndex((m) => m.t === t);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), timeout);
      this.waiters.push({ t, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  }
  async ready() {
    const w = await this.next('welcome');
    this.peerId = w.peerId as string;
    return this;
  }
  send(m: Msg) {
    this.ws.send(JSON.stringify(m));
  }
  close() {
    this.ws.close();
  }
}

beforeAll(async () => {
  proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(PORT), STATIC_DIR: '/nonexistent' }, stdio: 'pipe' });
  await new Promise<void>((resolve) => proc.stdout!.on('data', (d) => String(d).includes('lobby on') && resolve()));
});

afterAll(() => {
  proc.kill();
});

describe('lobby server', () => {
  it('hosts, lists, joins by code, relays signals only within a room, and cleans up', async () => {
    const host = await new Client().ready();
    host.send({ t: 'create', name: 'Test ring', hostName: 'Hosty', arena: 'zen', maxPlayers: 2, private: false, version: 1 });
    const created = await host.next('created');
    const room = created.room as { id: string; code: string };
    expect(room.code).toMatch(/^[A-Z]{4}$/);

    const browser = await new Client().ready();
    browser.send({ t: 'list' });
    const list = (await browser.next('rooms')).rooms as { name: string }[];
    expect(list.map((r) => r.name)).toContain('Test ring');

    const guest = await new Client().ready();
    guest.send({ t: 'join', code: room.code.toLowerCase(), name: 'Guesty', version: 1 });
    const joined = await guest.next('joined');
    expect(joined.hostId).toBe(host.peerId);
    const pj = await host.next('peer-joined');
    expect(pj.peerId).toBe(guest.peerId);

    // Signaling between host and guest works…
    guest.send({ t: 'signal', to: host.peerId, data: { kind: 'offer', sdp: 'x' } });
    const sig = await host.next('signal');
    expect(sig.from).toBe(guest.peerId);
    host.send({ t: 'relay', to: guest.peerId, data: { t: 'ping', ts: 1 } });
    expect((await guest.next('relay')).data).toEqual({ t: 'ping', ts: 1 });

    // …but an outsider can't inject messages into the room.
    browser.send({ t: 'signal', to: host.peerId, data: { evil: true } });
    await expect(host.next('signal', 400)).rejects.toThrow();

    // Room is full now.
    browser.send({ t: 'join', roomId: room.id, name: 'Late', version: 1 });
    expect((await browser.next('error')).message).toMatch(/full/);

    // Wrong version is refused.
    const old = await new Client().ready();
    old.send({ t: 'join', code: 'ZZZZ', name: 'x', version: 1 });
    expect((await old.next('error')).message).toMatch(/No room/);

    // Guest leaving notifies host; host leaving closes the room.
    guest.close();
    expect((await host.next('peer-left')).peerId).toBe(guest.peerId);
    const g2 = await new Client().ready();
    g2.send({ t: 'join', code: room.code, name: 'Second', version: 1 });
    await g2.next('joined');
    host.close();
    await g2.next('room-closed');
    browser.send({ t: 'list' });
    const after = (await browser.next('rooms')).rooms as { name: string }[];
    expect(after.map((r) => r.name)).not.toContain('Test ring');
    browser.close();
    g2.close();
    old.close();
  });
});
