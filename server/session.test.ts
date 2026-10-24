// Room sessions end to end over the relay path (Node has no WebRTC, so
// every link falls back to the lobby relay, which is exactly what this checks).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { attachLobby } from './lobby.ts';
import { LobbyClient } from '../src/net/lobby.ts';
import { NetSession } from '../src/net/session.ts';
import type { GameMsg, SeatInfo } from '../src/net/protocol.ts';

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

const until = async (f: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('NetSession over the relay', () => {
  it('seats a guest, starts a match, and routes shots through the host', async () => {
    const hostLobby = new LobbyClient(url);
    await hostLobby.connect('Hosty');
    const host = new NetSession(hostLobby, await hostLobby.create({ name: 'r', isPublic: true, max: 3, arena: 'rooftop', majority: true }), { name: 'Hosty', taw: 0 });

    const guestLobby = new LobbyClient(url);
    await guestLobby.connect('Guesty');
    let roster: SeatInfo[] = [];
    let started: Extract<GameMsg, { k: 'start' }> | null = null;
    const guestGot: GameMsg[] = [];
    const guest = new NetSession(guestLobby, await guestLobby.join(host.room.code), { name: 'Guesty', taw: 5 }, {
      onRoster: (s) => (roster = s),
      onStart: (m) => (started = m),
      onGame: (m) => guestGot.push(m),
    });
    const hostGot: { m: GameMsg; from: string }[] = [];
    host.events.onGame = (m, from) => hostGot.push({ m, from });

    // The guest's own name and taw reach the host's seating and come back in the roster.
    await until(() => roster.length === 2 && roster[1].name === 'Guesty');
    expect(roster[1]).toMatchObject({ peer: guest.you, taw: 5 });
    expect(guest.linkMode).toBe('relay');

    host.addBot('regular', 'Dusty');
    await until(() => roster.length === 3);
    expect(roster[2].peer).toBe('bot:regular');

    const start = host.start()!;
    await until(() => started !== null);
    expect(started!.seats.map((s) => s.peer)).toEqual([host.you, guest.you, 'bot:regular']);
    expect(started!.seed).toBe(start.seed);

    // A guest's shot for its own seat reaches the host...
    const shot = { from: { x: 60, z: 0 }, yaw: Math.PI, power: 0.5, spin: 0, english: 0 };
    guest.send({ k: 'shot', player: 1, seq: 0, shot });
    await until(() => hostGot.length === 1);
    expect(hostGot[0]).toEqual({ m: { k: 'shot', player: 1, seq: 0, shot }, from: guest.you });

    // ...but a guest cannot shoot for someone else's seat.
    guest.send({ k: 'shot', player: 0, seq: 1, shot });
    await new Promise((r) => setTimeout(r, 200));
    expect(hostGot.length).toBe(1);

    // The host's outcome reaches the guest.
    host.send({ k: 'outcome', seq: 0, kind: 'shot', outcome: { shooterPos: null, targets: {} } });
    await until(() => guestGot.some((m) => m.k === 'outcome'));

    guest.leave();
    host.leave();
    hostLobby.close();
    guestLobby.close();
  });

  it('tells the host which seats a departed guest held', async () => {
    const hostLobby = new LobbyClient(url);
    await hostLobby.connect('H');
    const host = new NetSession(hostLobby, await hostLobby.create({ name: 'r', isPublic: false, max: 2, arena: 'schoolyard', majority: false }), { name: 'H', taw: 0 });
    const guestLobby = new LobbyClient(url);
    await guestLobby.connect('G');
    const guest = new NetSession(guestLobby, await guestLobby.join(host.room.code), { name: 'G', taw: 0 });
    await until(() => host.seats.length === 2);
    host.start();
    let left: number[] | null = null;
    host.events.onPeerLeft = (_p, seats) => (left = seats);
    guest.leave();
    guestLobby.close();
    await until(() => left !== null);
    expect(left).toEqual([1]);
    host.leave();
    hostLobby.close();
  });
});
