import type { SteamBridge } from '../steam';
import { PROTOCOL_VERSION, type PeerMsg, type RoomInfo } from './protocol';
import type { CreateRoomOptions, Link, LinkMode, Matchmaker, MatchmakerEvent } from './transport';

/**
 * Matchmaking and play over Steam: rooms are Steam lobbies, messages are Steam P2P packets
 * (relayed through Valve's network when a direct route fails, so no NAT trouble and no
 * server of our own).
 *
 *  - Public rooms are Public lobbies tagged with our game and protocol version, listed in the
 *    server browser and joinable by their 4-letter code.
 *  - Private rooms are Private lobbies: Steam never lists them, so friends join through the
 *    Steam invite dialog (or "Join game" in the friends list), which arrives as
 *    onJoinRequested. That replaces the room code for private play.
 *  - Steam peers only meet Steam peers: there is no cross-play with the web build's rooms.
 */

const GAME = 'ringer3d';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newCode() {
  const buf = new Uint32Array(4);
  crypto.getRandomValues(buf);
  return [...buf].map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
}

type Wire = { k: 'msg'; m: PeerMsg } | { k: 'bye' };

class SteamLink implements Link {
  mode: LinkMode = 'direct';
  onMessage: (m: PeerMsg) => void = () => {};
  onState: (mode: LinkMode) => void = () => {};
  constructor(
    readonly remoteId: string,
    private sendWire: (w: Wire, to: string) => void,
  ) {
    queueMicrotask(() => this.onState(this.mode));
  }
  send(m: PeerMsg) {
    if (this.mode !== 'closed') this.sendWire({ k: 'msg', m }, this.remoteId);
  }
  close() {
    if (this.mode === 'closed') return;
    this.sendWire({ k: 'bye' }, this.remoteId);
    this.mode = 'closed';
    this.onState('closed');
  }
}

function roomFrom(id: string, data: Record<string, string>, members: number, max: number): RoomInfo | null {
  if (data.game !== GAME || Number(data.version) !== PROTOCOL_VERSION) return null;
  return {
    id,
    code: data.code ?? '',
    name: data.name ?? 'Ringer room',
    arena: (data.arena as RoomInfo['arena']) ?? 'desk',
    players: Number(data.players ?? members),
    maxPlayers: max,
    private: data.private === '1',
    started: data.started === '1',
    hostName: data.host ?? '',
    version: PROTOCOL_VERSION,
  };
}

export class SteamMatchmaker implements Matchmaker {
  readonly kind = 'steam' as const;
  myId = '';
  private lobby: string | null = null;
  private hostId: string | null = null;
  private links = new Map<string, SteamLink>();
  /** Messages from a player we haven't opened a link to yet (a guest's hello can beat it). */
  private early = new Map<string, Wire[]>();
  private cbs = new Set<(e: MatchmakerEvent) => void>();
  private offs: (() => void)[] = [];

  constructor(private steam: SteamBridge) {}

  async connect() {
    if (this.myId) return;
    this.myId = (await this.steam.me()).steamId;
    this.offs.push(
      this.steam.onP2P((from, text) => {
        let w: Wire;
        try {
          w = JSON.parse(text) as Wire;
        } catch {
          return;
        }
        const link = this.links.get(from);
        if (!link) {
          const q = this.early.get(from) ?? [];
          if (q.length < 64) q.push(w);
          this.early.set(from, q);
          return;
        }
        if (w.k === 'msg') link.onMessage(w.m);
        else if (w.k === 'bye') {
          link.mode = 'closed';
          link.onState('closed');
        }
      }),
      this.steam.onLobbyChange((lobby, user, change) => {
        if (lobby !== this.lobby || user === this.myId) return;
        if (change === 'entered') {
          if (this.hostId === this.myId) this.emit({ t: 'peer-joined', peerId: user, name: 'Steam player' });
        } else {
          this.links.get(user)?.close();
          this.links.delete(user);
          if (user === this.hostId) this.emit({ t: 'room-closed' });
          else this.emit({ t: 'peer-left', peerId: user });
        }
      }),
    );
  }

  private emit(e: MatchmakerEvent) {
    this.cbs.forEach((f) => f(e));
  }

  on(cb: (e: MatchmakerEvent) => void) {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }

  async listRooms(): Promise<RoomInfo[]> {
    const lobbies = await this.steam.listLobbies();
    return lobbies
      .map((l) => roomFrom(l.id, l.data, l.members, l.max))
      .filter((r): r is RoomInfo => !!r && !r.private)
      .sort((a, b) => Number(a.started) - Number(b.started));
  }

  async host(o: CreateRoomOptions): Promise<RoomInfo> {
    const id = await this.steam.createLobby(o.private ? 'private' : 'public', o.maxPlayers);
    this.lobby = id;
    this.hostId = this.myId;
    const code = newCode();
    await this.steam.setLobbyData(id, {
      game: GAME,
      version: String(PROTOCOL_VERSION),
      code,
      name: o.name,
      host: o.hostName,
      arena: o.arena,
      players: '1',
      started: '0',
      private: o.private ? '1' : '0',
      max: String(o.maxPlayers),
    });
    return { id, code, name: o.name, arena: o.arena, players: 1, maxPlayers: o.maxPlayers, private: o.private, started: false, hostName: o.hostName, version: PROTOCOL_VERSION };
  }

  /** Join by lobby id (browser, Steam invite) or by a public room's code. */
  async join(o: { roomId?: string; code?: string; name: string }): Promise<{ room: RoomInfo; hostId: string }> {
    let id = o.roomId;
    if (!id && o.code) {
      const want = o.code.trim().toUpperCase();
      id = (await this.listRooms()).find((r) => r.code === want)?.id;
      if (!id) throw new Error('No open room with that code. Private rooms are joined through a Steam invite.');
    }
    if (!id) throw new Error('No room given.');
    await this.steam.joinLobby(id);
    const data = await this.steam.lobbyData(id);
    const members = await this.steam.lobbyMembers(id);
    const room = roomFrom(id, data, members.length, Number(data.max ?? 8));
    if (!room) {
      await this.steam.leaveLobby(id);
      throw new Error("That lobby isn't a Ringer room for this version.");
    }
    this.lobby = id;
    this.hostId = await this.steam.lobbyOwner(id);
    return { room, hostId: this.hostId };
  }

  update(u: { players: number; started: boolean; arena: RoomInfo['arena'] }) {
    if (!this.lobby || this.hostId !== this.myId) return;
    void this.steam.setLobbyData(this.lobby, { players: String(u.players), started: u.started ? '1' : '0', arena: u.arena });
    void this.steam.setJoinable(this.lobby, !u.started);
  }

  /** Open Steam's invite dialog for the current room (the way into private rooms). */
  invite() {
    if (this.lobby) void this.steam.inviteFriends(this.lobby);
  }

  link(peerId: string): Link {
    const l = new SteamLink(peerId, (w, to) => void this.steam.sendP2P(to, JSON.stringify(w)));
    this.links.set(peerId, l);
    const queued = this.early.get(peerId);
    this.early.delete(peerId);
    // Deliver after the caller has set onMessage.
    if (queued) queueMicrotask(() => queued.forEach((w) => w.k === 'msg' && l.onMessage(w.m)));
    return l;
  }

  leave() {
    for (const l of this.links.values()) l.close();
    this.links.clear();
    this.early.clear();
    if (this.lobby) void this.steam.leaveLobby(this.lobby);
    this.lobby = null;
    this.hostId = null;
  }

  close() {
    this.leave();
    this.offs.forEach((f) => f());
    this.offs = [];
    this.cbs.clear();
  }
}
