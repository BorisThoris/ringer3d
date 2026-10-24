import type { PlayerInfo } from '../core/types';
import type { ArenaId } from '../game/arenas';
import { createStore } from '../game/store';
import type { LobbyClient } from './lobby';
import { PeerLink } from './peer';
import { PROTOCOL_VERSION, type OnlineMatchConfig, type PeerMsg, type RoomInfo, type RosterEntry } from './protocol';

export interface RoomState {
  room: RoomInfo | null;
  roster: RosterEntry[];
  arena: ArenaId;
  started: boolean;
  error: string | null;
  links: Record<string, PeerLink['mode']>;
}

/** What the game session needs from an online room once the match is running. */
export interface NetGame {
  readonly isHost: boolean;
  readonly mySeat: number;
  /** Guest → host, or host → everyone. */
  send(msg: PeerMsg): void;
  /** Host only: send to everyone except one seat (used to relay a guest's shot). */
  broadcast(msg: PeerMsg, exceptSeat?: number): void;
  /** Host only. */
  sendToSeat(seat: number, msg: PeerMsg): void;
  onMessage(cb: (msg: PeerMsg, fromSeat: number) => void): () => void;
  onSeatLost(cb: (seat: number) => void): () => void;
  onHostLost(cb: () => void): () => void;
  leave(): void;
}

const MAX_PLAYERS = 4;
const SHOOTER_POOL = ['ember', 'tide', 'jade', 'volt', 'rime', 'nova', 'ironside', 'pip'];

export class OnlineRoom implements NetGame {
  readonly lobby: LobbyClient;
  readonly isHost: boolean;
  readonly state = createStore<RoomState>({ room: null, roster: [], arena: 'schoolyard', started: false, error: null, links: {} });
  private links = new Map<string, PeerLink>();
  private hostId = '';
  private seats: Record<string, number> = {};
  mySeat = -1;
  private msgCbs = new Set<(m: PeerMsg, seat: number) => void>();
  private lostCbs = new Set<(seat: number) => void>();
  private hostLostCbs = new Set<() => void>();
  private startCbs = new Set<(c: OnlineMatchConfig, seats: Record<string, number>) => void>();
  private offLobby: () => void;
  readonly me: { name: string; marble: string };
  private botCounter = 0;

  private constructor(lobby: LobbyClient, isHost: boolean, me: { name: string; marble: string }) {
    this.lobby = lobby;
    this.isHost = isHost;
    this.me = me;
    this.offLobby = lobby.on((m) => {
      switch (m.t) {
        case 'peer-joined':
          if (this.isHost) this.acceptPeer(m.peerId, m.name);
          break;
        case 'peer-left':
          this.dropPeer(m.peerId);
          break;
        case 'room-closed':
          this.state.set({ error: 'The host closed the room.' });
          this.hostLostCbs.forEach((f) => f());
          break;
        case 'error':
          this.state.set({ error: m.message });
          break;
      }
    });
  }

  static async host(
    lobby: LobbyClient,
    opts: { roomName: string; arena: ArenaId; maxPlayers: number; private: boolean; name: string; marble: string },
  ): Promise<OnlineRoom> {
    await lobby.connect();
    const room = new OnlineRoom(lobby, true, { name: opts.name, marble: opts.marble });
    const res = await lobby.request(
      { t: 'create', name: opts.roomName, hostName: opts.name, arena: opts.arena, maxPlayers: Math.min(MAX_PLAYERS, opts.maxPlayers), private: opts.private, version: PROTOCOL_VERSION },
      'created',
    );
    room.hostId = lobby.peerId;
    room.state.set({
      room: res.room,
      arena: opts.arena,
      roster: [{ peerId: lobby.peerId, name: opts.name, marble: opts.marble, ready: true, isHost: true }],
    });
    return room;
  }

  static async join(lobby: LobbyClient, opts: { roomId?: string; code?: string; name: string; marble: string }): Promise<OnlineRoom> {
    await lobby.connect();
    const room = new OnlineRoom(lobby, false, { name: opts.name, marble: opts.marble });
    const res = await lobby.request({ t: 'join', roomId: opts.roomId, code: opts.code?.toUpperCase(), name: opts.name, version: PROTOCOL_VERSION }, 'joined');
    room.hostId = res.hostId;
    room.state.set({ room: res.room, arena: res.room.arena });
    const link = room.makeLink(res.hostId, false);
    link.send({ t: 'hello', name: opts.name, marble: opts.marble, version: PROTOCOL_VERSION });
    return room;
  }

  private makeLink(peerId: string, initiator: boolean): PeerLink {
    const link = new PeerLink(this.lobby, peerId, initiator);
    this.links.set(peerId, link);
    link.onMessage = (m) => this.handle(peerId, m);
    link.onState = (mode) => this.state.set((s) => ({ links: { ...s.links, [peerId]: mode } }));
    return link;
  }

  // ---- Host: lobby management ----------------------------------------------------------
  private acceptPeer(peerId: string, name: string) {
    const roster = this.state.get().roster;
    if (roster.length >= (this.state.get().room?.maxPlayers ?? MAX_PLAYERS) || this.state.get().started) {
      const l = this.makeLink(peerId, true);
      l.send({ t: 'kick', reason: this.state.get().started ? 'That match already started.' : 'That room is full.' });
      setTimeout(() => this.dropPeer(peerId), 1500);
      return;
    }
    this.makeLink(peerId, true);
    this.state.set({ roster: [...roster, { peerId, name, marble: 'tide', ready: false, isHost: false }] });
    this.pushRoster();
  }

  addBot(profile: string, name: string, marble: string) {
    if (!this.isHost) return;
    const roster = this.state.get().roster;
    if (roster.length >= (this.state.get().room?.maxPlayers ?? MAX_PLAYERS)) return;
    const peerId = `bot-${++this.botCounter}`;
    this.state.set({ roster: [...roster, { peerId, name, marble, ready: true, isHost: false, isBot: true, botProfile: profile }] });
    this.pushRoster();
  }

  removeEntry(peerId: string) {
    if (!this.isHost) return;
    if (!peerId.startsWith('bot-')) {
      this.links.get(peerId)?.send({ t: 'kick', reason: 'The host removed you from the room.' });
      setTimeout(() => this.dropPeer(peerId), 300);
      return;
    }
    this.state.set((s) => ({ roster: s.roster.filter((r) => r.peerId !== peerId) }));
    this.pushRoster();
  }

  setArena(arena: ArenaId) {
    if (!this.isHost) return;
    this.state.set({ arena });
    this.pushRoster();
  }

  setReady(ready: boolean) {
    if (this.isHost) return;
    this.links.get(this.hostId)?.send({ t: 'ready', ready });
  }

  private pushRoster() {
    const s = this.state.get();
    this.broadcast({ t: 'roster', roster: s.roster, arena: s.arena });
    this.lobby.send({ t: 'update', players: s.roster.length, started: s.started, arena: s.arena });
  }

  get canStart(): boolean {
    const r = this.state.get().roster;
    return this.isHost && r.length >= 2 && r.every((e) => e.ready);
  }

  /** Host: lock the roster and start the match for everyone. */
  start(): OnlineMatchConfig | null {
    if (!this.canStart) return null;
    const s = this.state.get();
    const seats: Record<string, number> = {};
    // Everyone needs a distinguishable shooter: later duplicates get the next free marble.
    const used = new Set<string>();
    const players: PlayerInfo[] = s.roster.map((r, i) => {
      seats[r.peerId] = i;
      let marble = r.marble;
      if (used.has(marble)) marble = SHOOTER_POOL.find((m) => !used.has(m)) ?? marble;
      used.add(marble);
      return { id: r.peerId, name: r.name, marble, kind: r.isBot ? 'bot' : 'human', botProfile: r.botProfile };
    });
    const config: OnlineMatchConfig = { seed: (Math.random() * 2 ** 31) | 0, arena: s.arena, players };
    this.seats = seats;
    this.mySeat = seats[this.lobby.peerId];
    this.state.set({ started: true });
    this.broadcast({ t: 'start', config, seats });
    this.lobby.send({ t: 'update', players: s.roster.length, started: true, arena: s.arena });
    this.startCbs.forEach((f) => f(config, seats));
    return config;
  }

  onStart(cb: (c: OnlineMatchConfig, seats: Record<string, number>) => void) {
    this.startCbs.add(cb);
    return () => this.startCbs.delete(cb);
  }

  // ---- Messages -----------------------------------------------------------------------
  private handle(from: string, m: PeerMsg) {
    if (this.isHost) {
      switch (m.t) {
        case 'hello': {
          if (m.version !== PROTOCOL_VERSION) {
            this.links.get(from)?.send({ t: 'kick', reason: 'Your game version is different from the host\'s. Update and try again.' });
            return;
          }
          this.state.set((s) => ({ roster: s.roster.map((r) => (r.peerId === from ? { ...r, name: m.name, marble: m.marble } : r)) }));
          this.pushRoster();
          return;
        }
        case 'ready':
          this.state.set((s) => ({ roster: s.roster.map((r) => (r.peerId === from ? { ...r, ready: m.ready } : r)) }));
          this.pushRoster();
          return;
        case 'ping':
          this.links.get(from)?.send({ t: 'pong', ts: m.ts });
          return;
        case 'aim':
        case 'emote': {
          const seat = this.seats[from];
          if (seat === undefined || m.seat !== seat) return; // can't speak for other seats
          this.broadcast(m, seat);
          this.msgCbs.forEach((f) => f(m, seat));
          return;
        }
        default: {
          const seat = this.seats[from];
          if (seat === undefined) return;
          this.msgCbs.forEach((f) => f(m, seat));
        }
      }
    } else {
      switch (m.t) {
        case 'roster':
          this.state.set({ roster: m.roster, arena: m.arena });
          return;
        case 'kick':
          this.state.set({ error: m.reason });
          this.hostLostCbs.forEach((f) => f());
          return;
        case 'start':
          this.seats = m.seats;
          this.mySeat = m.seats[this.lobby.peerId];
          this.state.set({ started: true, arena: m.config.arena });
          this.startCbs.forEach((f) => f(m.config, m.seats));
          return;
        case 'seatLost':
          this.lostCbs.forEach((f) => f(m.seat));
          return;
        default: {
          const seat = 'seat' in m ? (m as { seat: number }).seat : (this.seats[this.hostId] ?? 0);
          this.msgCbs.forEach((f) => f(m, seat));
        }
      }
    }
  }

  private dropPeer(peerId: string) {
    const link = this.links.get(peerId);
    link?.close();
    this.links.delete(peerId);
    if (this.isHost) {
      const s = this.state.get();
      const seat = this.seats[peerId];
      this.state.set({ roster: s.roster.filter((r) => r.peerId !== peerId) });
      if (s.started && seat !== undefined) {
        this.broadcast({ t: 'seatLost', seat, botProfile: 'skilled' });
        this.lostCbs.forEach((f) => f(seat));
      } else {
        this.pushRoster();
      }
    } else if (peerId === this.hostId) {
      this.state.set({ error: 'The host left the match.' });
      this.hostLostCbs.forEach((f) => f());
    }
  }

  // ---- NetGame ------------------------------------------------------------------------
  send(msg: PeerMsg) {
    if (this.isHost) this.broadcast(msg);
    else this.links.get(this.hostId)?.send(msg);
  }

  broadcast(msg: PeerMsg, exceptSeat?: number) {
    if (!this.isHost) return;
    for (const [peerId, link] of this.links) {
      if (exceptSeat !== undefined && this.seats[peerId] === exceptSeat) continue;
      link.send(msg);
    }
  }

  sendToSeat(seat: number, msg: PeerMsg) {
    for (const [peerId, link] of this.links) if (this.seats[peerId] === seat) link.send(msg);
  }

  onMessage(cb: (m: PeerMsg, seat: number) => void) {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }

  onSeatLost(cb: (seat: number) => void) {
    this.lostCbs.add(cb);
    return () => this.lostCbs.delete(cb);
  }

  onHostLost(cb: () => void) {
    this.hostLostCbs.add(cb);
    return () => this.hostLostCbs.delete(cb);
  }

  leave() {
    this.lobby.send({ t: 'leave' });
    for (const l of this.links.values()) l.close();
    this.links.clear();
    this.offLobby();
    this.msgCbs.clear();
    this.lostCbs.clear();
    this.hostLostCbs.clear();
    this.startCbs.clear();
  }
}
