import { describe, expect, it } from 'vitest';
import { SteamMatchmaker } from '../src/net/steamMatchmaker';
import { OnlineRoom } from '../src/net/room';
import type { LobbyKind, SteamBridge } from '../src/steam';

/**
 * A pretend Steam for several players in one process: lobbies, lobby callbacks and P2P
 * packets behave like steamworks.js through steam/main.cjs. It proves our side of the wiring;
 * the real binding is checked by steam/probe.cjs against a running Steam client.
 */
class FakeSteamNet {
  lobbies = new Map<string, { kind: LobbyKind; max: number; owner: string; members: string[]; data: Record<string, string> }>();
  users = new Map<string, FakeSteam>();
  next = 109775240000000000n;
  bridge(steamId: string, name: string): SteamBridge {
    const u = new FakeSteam(this, steamId, name);
    this.users.set(steamId, u);
    return u.api;
  }
}

class FakeSteam {
  p2p = new Set<(from: string, text: string) => void>();
  lobby = new Set<(lobby: string, user: string, change: 'entered' | 'left') => void>();
  join = new Set<(lobby: string, friend: string) => void>();
  api: SteamBridge;
  constructor(net: FakeSteamNet, id: string, name: string) {
    const later = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 1));
    const tell = (lobbyId: string, user: string, change: 'entered' | 'left') => {
      for (const m of net.lobbies.get(lobbyId)?.members ?? []) for (const cb of net.users.get(m)!.lobby) cb(lobbyId, user, change);
    };
    const listen = <F,>(set: Set<F>) => (cb: F) => {
      set.add(cb);
      return () => void set.delete(cb);
    };
    this.api = {
      appId: 480,
      me: () => later({ steamId: id, name, deck: false, language: 'english' }),
      createLobby: async (kind, max) => {
        const lid = String(net.next++);
        net.lobbies.set(lid, { kind, max, owner: id, members: [id], data: {} });
        return later(lid);
      },
      joinLobby: async (lid) => {
        const l = net.lobbies.get(lid);
        if (!l || l.members.length >= l.max) throw new Error('lobby full or gone');
        l.members.push(id);
        tell(lid, id, 'entered');
        return later(lid);
      },
      listLobbies: async () => later([...net.lobbies].filter(([, l]) => l.kind === 'public').map(([lid, l]) => ({ id: lid, data: { ...l.data }, members: l.members.length, max: l.max }))),
      leaveLobby: async (lid) => {
        const l = net.lobbies.get(lid);
        if (!l) return;
        tell(lid, id, 'left');
        l.members = l.members.filter((m) => m !== id);
        if (!l.members.length) net.lobbies.delete(lid);
      },
      setLobbyData: async (lid, data) => {
        const l = net.lobbies.get(lid);
        if (!l || l.owner !== id) return false; // only the owner may write lobby data
        Object.assign(l.data, data);
        return true;
      },
      lobbyData: async (lid) => ({ ...(net.lobbies.get(lid)?.data ?? {}) }),
      lobbyMembers: async (lid) => [...(net.lobbies.get(lid)?.members ?? [])],
      lobbyOwner: async (lid) => net.lobbies.get(lid)?.owner ?? '',
      setJoinable: async () => {},
      inviteFriends: async () => {},
      sendP2P: async (to, text) => {
        const u = net.users.get(to);
        if (!u) return false;
        setTimeout(() => u.p2p.forEach((cb) => cb(id, text)), 1);
        return true;
      },
      onP2P: listen(this.p2p),
      onLobbyChange: listen(this.lobby),
      onJoinRequested: listen(this.join),
      unlock: async () => true,
      achievements: async (_names: string[]) => [],
      statGet: async () => 0,
      statSet: async () => true,
      statsStore: async () => true,
      cloudRead: async () => null,
      cloudWrite: async () => true,
      presence: async () => {},
      overlay: async () => {},
      webApiTicket: async () => 'ticket',
      onMicroTxn: () => () => {},
      invAll: async () => [],
      invDrop: async () => [],
      invExchange: async () => [],
      invConsume: async () => [],
      invBuy: async () => '0',
      invDefs: async () => [],
      invSetProps: async () => [],
      submitScore: async () => ({ ok: true, score: 0, changed: false, rank: 0, previousRank: 0 }),
      scores: async () => [],
      friends: async () => [],
      showUser: async () => {},
      timelineEvent: async () => true,
      timelineState: async () => true,
      timelineMode: async () => true,
    };
  }
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('Steam matchmaking and P2P', () => {
  it('hosts a public room, lists it, joins by code and exchanges messages', async () => {
    const net = new FakeSteamNet();
    const a = new SteamMatchmaker(net.bridge('76561198000000001', 'Alice'));
    const b = new SteamMatchmaker(net.bridge('76561198000000002', 'Bob'));
    await a.connect();
    await b.connect();
    const joined: string[] = [];
    a.on((e) => e.t === 'peer-joined' && joined.push(e.peerId));
    const room = await a.host({ name: "Alice's ring", hostName: 'Alice', arena: 'sand', maxPlayers: 2, private: false });

    const list = await b.listRooms();
    expect(list.map((r) => r.code)).toEqual([room.code]);
    const res = await b.join({ code: room.code, name: 'Bob' });
    expect(res.hostId).toBe(a.myId);
    await tick();
    expect(joined).toEqual([b.myId]);

    const got: unknown[] = [];
    const la = a.link(b.myId);
    const lb = b.link(a.myId);
    la.onMessage = (m) => got.push(['a', m]);
    lb.onMessage = (m) => got.push(['b', m]);
    lb.send({ t: 'hello', name: 'Bob', marble: 'g42', version: 0 } as never);
    la.send({ t: 'ping', at: 1 } as never);
    await tick();
    expect(got).toContainEqual(['a', { t: 'hello', name: 'Bob', marble: 'g42', version: 0 }]);
    expect(got).toContainEqual(['b', { t: 'ping', at: 1 }]);

    const left: string[] = [];
    a.on((e) => e.t === 'peer-left' && left.push(e.peerId));
    b.leave();
    await tick();
    expect(left).toEqual([b.myId]);
  });

  it('keeps private rooms out of the browser: friends come in by invite', async () => {
    const net = new FakeSteamNet();
    const a = new SteamMatchmaker(net.bridge('1', 'Alice'));
    const b = new SteamMatchmaker(net.bridge('2', 'Bob'));
    await a.connect();
    await b.connect();
    const room = await a.host({ name: 'Secret', hostName: 'Alice', arena: 'ice', maxPlayers: 4, private: true });
    expect(await b.listRooms()).toEqual([]);
    await expect(b.join({ code: room.code, name: 'Bob' })).rejects.toThrow(/invite/);
    const res = await b.join({ roomId: room.id, name: 'Bob' }); // what an accepted Steam invite does
    expect(res.room.private).toBe(true);
  });

  it('ignores other games\' lobbies on a shared App ID', async () => {
    const net = new FakeSteamNet();
    const other = net.bridge('9', 'Spacewar');
    const lid = await other.createLobby('public', 4);
    await other.setLobbyData(lid, { game: 'spacewar' });
    const b = new SteamMatchmaker(net.bridge('2', 'Bob'));
    await b.connect();
    expect(await b.listRooms()).toEqual([]);
  });

  it('runs a whole online room over Steam: the guest is in the host\'s roster', async () => {
    const net = new FakeSteamNet();
    const host = await OnlineRoom.host(new SteamMatchmaker(net.bridge('11', 'Alice')), { roomName: 'Ring', arena: 'grass', maxPlayers: 2, private: false, name: 'Alice', marble: 'ember' });
    const code = host.state.get().room!.code;
    const guest = await OnlineRoom.join(new SteamMatchmaker(net.bridge('12', 'Bob')), { code, name: 'Bob', marble: 'g777' });
    for (let i = 0; i < 40 && host.state.get().roster[1]?.name !== 'Bob'; i++) await tick(25);
    const roster = host.state.get().roster;
    expect(roster.map((r) => r.name)).toEqual(['Alice', 'Bob']);
    expect(roster[1].marble).toBe('g777');
    guest.leave();
    host.leave();
  });
});
