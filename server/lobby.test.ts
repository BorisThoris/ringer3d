import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { attachLobby } from './lobby.ts';
import { PROTOCOL_VERSION, type LobbyEvent, type LobbyRequest } from '../src/net/protocol.ts';

let server: Server;
let lobby: ReturnType<typeof attachLobby>;
let url = '';

beforeAll(async () => {
  server = createServer();
  lobby = attachLobby(server);
  await new Promise<void>((r) => server.listen(0, r));
  url = `ws://localhost:${(server.address() as AddressInfo).port}/lobby`;
});

afterAll(() => {
  lobby.close();
  server.close();
});

/** A test client that queues events and lets you await the next of a kind. */
async function client(name: string) {
  const ws = new WebSocket(url);
  const queue: LobbyEvent[] = [];
  const waiters: { t: string; f: (e: LobbyEvent) => void }[] = [];
  ws.on('message', (raw) => {
    const e = JSON.parse(String(raw)) as LobbyEvent;
    const i = waiters.findIndex((w) => w.t === e.t);
    if (i >= 0) waiters.splice(i, 1)[0].f(e);
    else queue.push(e);
  });
  const next = <T extends LobbyEvent['t']>(t: T, ms = 2000) =>
    new Promise<Extract<LobbyEvent, { t: T }>>((res, rej) => {
      const i = queue.findIndex((e) => e.t === t);
      if (i >= 0) return res(queue.splice(i, 1)[0] as Extract<LobbyEvent, { t: T }>);
      const timer = setTimeout(() => rej(new Error(`${name}: no ${t}`)), ms);
      waiters.push({ t, f: (e) => (clearTimeout(timer), res(e as Extract<LobbyEvent, { t: T }>)) });
    });
  const send = (m: LobbyRequest) => ws.send(JSON.stringify(m));
  await new Promise((r) => ws.once('open', r));
  const welcome = await next('welcome');
  send({ t: 'hello', name, version: PROTOCOL_VERSION });
  return { ws, next, send, id: welcome.you, close: () => ws.close() };
}

describe('lobby', () => {
  it('creates a public room that shows in the server browser, and joins by code', async () => {
    const host = await client('Hosty');
    host.send({ t: 'create', settings: { name: 'Friday ring', isPublic: true, max: 3, arena: 'rooftop', majority: true } });
    const made = await host.next('joined');
    expect(made.host).toBe(host.id);
    expect(made.room.code).toMatch(/^[A-Z]{4}$/);

    const browser = await client('Looker');
    browser.send({ t: 'list' });
    const list = await browser.next('rooms');
    const listed = list.rooms.find((r) => r.code === made.room.code)!;
    expect(listed).toMatchObject({ name: 'Friday ring', hostName: 'Hosty', players: 1, max: 3, arena: 'rooftop', majority: true });

    browser.send({ t: 'join', code: made.room.code.toLowerCase() });
    const joined = await browser.next('joined');
    expect(joined.host).toBe(host.id);
    expect(joined.peers).toEqual([{ id: host.id, name: 'Hosty' }]);
    expect((await host.next('peer-joined')).peer).toEqual({ id: browser.id, name: 'Looker' });
    host.close();
    browser.close();
  });

  it('private rooms stay out of the browser but accept their code', async () => {
    const host = await client('Shy');
    host.send({ t: 'create', settings: { name: 'secret', isPublic: false, max: 2, arena: 'parlour', majority: false } });
    const made = await host.next('joined');
    const other = await client('Friend');
    other.send({ t: 'list' });
    expect((await other.next('rooms')).rooms.some((r) => r.code === made.room.code)).toBe(false);
    other.send({ t: 'join', code: made.room.code });
    expect((await other.next('joined')).room.code).toBe(made.room.code);
    host.close();
    other.close();
  });

  it('forwards signalling and relays game messages only inside the room', async () => {
    const host = await client('A');
    host.send({ t: 'create', settings: { name: 'r', isPublic: true, max: 2, arena: 'schoolyard', majority: false } });
    const made = await host.next('joined');
    const guest = await client('B');
    guest.send({ t: 'join', code: made.room.code });
    await guest.next('joined');
    const outsider = await client('C');

    guest.send({ t: 'signal', to: host.id, data: { sdp: 'offer' } });
    expect(await host.next('signal')).toEqual({ t: 'signal', from: guest.id, data: { sdp: 'offer' } });

    host.send({ t: 'relay', to: '*', data: { k: 'bye' } });
    expect(await guest.next('relay')).toEqual({ t: 'relay', from: host.id, data: { k: 'bye' } });

    // An outsider cannot reach into the room.
    outsider.send({ t: 'signal', to: host.id, data: 'x' });
    await expect(host.next('signal', 300)).rejects.toThrow();
    host.close();
    guest.close();
    outsider.close();
  });

  it('full rooms, started matches and bad codes are refused', async () => {
    const host = await client('H');
    host.send({ t: 'create', settings: { name: 'r', isPublic: true, max: 2, arena: 'schoolyard', majority: false } });
    const code = (await host.next('joined')).room.code;
    const a = await client('A');
    a.send({ t: 'join', code });
    await a.next('joined');
    const b = await client('B');
    b.send({ t: 'join', code });
    expect((await b.next('error')).message).toMatch(/full/);
    b.send({ t: 'join', code: 'ZZZZ' });
    expect((await b.next('error')).message).toMatch(/No ring/);
    host.send({ t: 'update', settings: { max: 4, inGame: true } });
    await host.next('room');
    b.send({ t: 'join', code });
    expect((await b.next('error')).message).toMatch(/started/);
    host.close();
    a.close();
    b.close();
  });

  it('closes the room for everyone when the host leaves', async () => {
    const host = await client('H');
    host.send({ t: 'create', settings: { name: 'r', isPublic: true, max: 2, arena: 'schoolyard', majority: false } });
    const code = (await host.next('joined')).room.code;
    const guest = await client('G');
    guest.send({ t: 'join', code });
    await guest.next('joined');
    host.close();
    await guest.next('host-left');
    guest.send({ t: 'list' });
    expect((await guest.next('rooms')).rooms.some((r) => r.code === code)).toBe(false);
    guest.close();
  });
});
