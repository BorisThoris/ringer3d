/**
 * An online room, from this device's point of view. The host links to every
 * guest (a star); guests link only to the host. The host owns the seating,
 * starts the match, runs any bots, checks that each shot comes from the
 * device that owns that seat, and passes it on to everyone else.
 */
import { LobbyClient, type Joined } from './lobby';
import { PeerLink, type LinkMode } from './peer';
import type { GameMsg, RoomInfo, SeatInfo } from './protocol';

export const SEAT_COLORS = ['#5ad1ff', '#ff5a7a', '#5cff9d', '#ffd23f'];

export interface SessionEvents {
  onRoom?: (room: RoomInfo) => void;
  onRoster?: (seats: SeatInfo[]) => void;
  onStart?: (msg: Extract<GameMsg, { k: 'start' }>) => void;
  /** Game traffic for the running match. `from` = the sending peer. */
  onGame?: (msg: GameMsg, from: string) => void;
  /** Host: a guest left (their seats need a bot). */
  onPeerLeft?: (peer: string, seats: number[]) => void;
  onHostLeft?: () => void;
  onLinks?: () => void;
}

export class NetSession {
  room: RoomInfo;
  readonly you: string;
  readonly hostId: string;
  readonly isHost: boolean;
  seats: SeatInfo[] = [];
  links = new Map<string, PeerLink>();
  started = false;
  private offs: (() => void)[] = [];
  /** Seats as they were at the start of the match: indices are the players. */
  private matchSeats: SeatInfo[] = [];

  constructor(readonly lobby: LobbyClient, joined: Joined, private me: { name: string; taw: number }, public events: SessionEvents = {}) {
    this.room = joined.room;
    this.you = joined.you;
    this.hostId = joined.host;
    this.isHost = joined.host === joined.you;
    if (this.isHost) this.seats = [{ peer: this.you, name: me.name, color: SEAT_COLORS[0], taw: me.taw }];
    else this.link(this.hostId);

    this.offs.push(
      lobby.on('peer-joined', (e) => {
        if (!this.isHost) return;
        this.link(e.peer.id);
        if (!this.started && this.seats.length < this.room.max) {
          this.seats.push({ peer: e.peer.id, name: e.peer.name, color: this.freeColor(), taw: 0 });
          this.pushRoster();
        }
      }),
      lobby.on('peer-left', (e) => {
        this.links.get(e.id)?.close();
        this.links.delete(e.id);
        if (!this.isHost) return;
        if (this.started) {
          const mine = this.matchSeats.flatMap((s, i) => (s.peer === e.id ? [i] : []));
          this.events.onPeerLeft?.(e.id, mine);
        } else {
          this.seats = this.seats.filter((s) => s.peer !== e.id);
          this.pushRoster();
        }
        this.events.onLinks?.();
      }),
      lobby.on('host-left', () => this.events.onHostLeft?.()),
      lobby.on('room', (e) => {
        this.room = e.room;
        this.events.onRoom?.(e.room);
      }),
      lobby.on('signal', (e) => {
        void this.links.get(e.from)?.signal(e.data);
      }),
      lobby.on('relay', (e) => this.links.get(e.from)?.relayed(e.data)),
      lobby.on('closed', () => this.events.onHostLeft?.()),
    );
  }

  private link(peer: string): void {
    if (this.links.has(peer)) return;
    // The host offers; guests answer.
    const l = new PeerLink(
      this.lobby,
      peer,
      this.isHost,
      (m) => this.receive(m, peer),
      // `mode`, not `l.mode`: without WebRTC the link reports relay from inside its constructor.
      (mode) => {
        if (!this.isHost && mode !== 'connecting') this.send({ k: 'me', name: this.me.name, taw: this.me.taw });
        this.events.onLinks?.();
      },
    );
    this.links.set(peer, l);
    // Guests announce themselves right away over the relay; it repeats once P2P is up.
    if (!this.isHost) l.send({ k: 'me', name: this.me.name, taw: this.me.taw });
  }

  private freeColor(): string {
    return SEAT_COLORS.find((c) => !this.seats.some((s) => s.color === c)) ?? SEAT_COLORS[0];
  }

  /** Weakest link, for the HUD badge. */
  get linkMode(): LinkMode {
    const modes = [...this.links.values()].map((l) => l.mode);
    if (modes.includes('connecting')) return 'connecting';
    if (modes.includes('relay')) return 'relay';
    return modes.length ? 'p2p' : 'connecting';
  }

  private receive(m: GameMsg, from: string): void {
    if (this.isHost) {
      if (m.k === 'me') {
        const s = this.seats.find((x) => x.peer === from);
        if (s && !this.started) {
          s.name = String(m.name).slice(0, 20) || s.name;
          s.taw = Math.max(0, Math.floor(Number(m.taw) || 0));
          this.pushRoster();
        }
        return;
      }
      // Only accept moves for seats the sender actually holds, then pass them on.
      if (m.k === 'shot' || m.k === 'aim' || m.k === 'emote') {
        if (this.matchSeats[m.player]?.peer !== from) return;
        this.broadcast(m, from);
        this.events.onGame?.(m, from);
      }
      return;
    }
    if (from !== this.hostId) return;
    if (m.k === 'roster') {
      this.seats = m.seats;
      this.events.onRoster?.(m.seats);
      return;
    }
    if (m.k === 'start') {
      this.started = true;
      this.seats = m.seats;
      this.matchSeats = m.seats;
      this.events.onStart?.(m);
      return;
    }
    this.events.onGame?.(m, from);
  }

  /** Guest: to the host. Host: to every guest (except `except`). */
  send(m: GameMsg): void {
    if (this.isHost) this.broadcast(m);
    else this.links.get(this.hostId)?.send(m);
  }

  private broadcast(m: GameMsg, except?: string): void {
    for (const [peer, l] of this.links) if (peer !== except) l.send(m);
  }

  private pushRoster(): void {
    this.broadcast({ k: 'roster', seats: this.seats });
    this.events.onRoster?.(this.seats);
  }

  // -------------------------------------------------------- host controls

  addBot(profile: string, name: string): void {
    if (!this.isHost || this.started || this.seats.length >= this.room.max) return;
    this.seats.push({ peer: `bot:${profile}`, name, color: this.freeColor(), taw: this.seats.length });
    this.pushRoster();
  }

  removeSeat(i: number): void {
    if (!this.isHost || this.started || i === 0 || !this.seats[i]?.peer.startsWith('bot:')) return;
    this.seats.splice(i, 1);
    this.pushRoster();
  }

  setRoom(settings: Partial<Pick<RoomInfo, 'arena' | 'majority' | 'name' | 'isPublic' | 'max'>>): void {
    if (this.isHost) this.lobby.send({ t: 'update', settings });
  }

  start(): Extract<GameMsg, { k: 'start' }> | null {
    if (!this.isHost || this.seats.length < 2) return null;
    const msg: Extract<GameMsg, { k: 'start' }> = {
      k: 'start',
      seats: this.seats,
      arena: this.room.arena,
      majority: this.room.majority,
      lag: true,
      seed: Math.floor(Math.random() * 2 ** 31),
    };
    this.started = true;
    this.matchSeats = this.seats.map((s) => ({ ...s }));
    this.lobby.send({ t: 'update', settings: { inGame: true } });
    this.broadcast(msg);
    return msg;
  }

  /** Host: back to the room after a match, so the same players can go again. */
  reopen(): void {
    if (!this.isHost) return;
    this.started = false;
    this.seats = this.seats.filter((s) => s.peer.startsWith('bot:') || s.peer === this.you || this.links.has(s.peer));
    this.lobby.send({ t: 'update', settings: { inGame: false } });
    this.pushRoster();
  }

  leave(): void {
    this.send({ k: 'bye' });
    for (const l of this.links.values()) l.close();
    this.links.clear();
    this.offs.forEach((o) => o());
    this.lobby.leave();
  }
}
