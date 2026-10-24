import { joinRoom, selfId, type Room } from 'trystero/nostr';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { DEFAULT_ICE } from './lobby';
import { PROTOCOL_VERSION, type PeerMsg, type RoomInfo } from './protocol';
import type { CreateRoomOptions, Link, LinkMode, Matchmaker, MatchmakerEvent } from './transport';

/**
 * Serverless matchmaking. Nothing to deploy:
 *  - Room listings for the server browser are small Nostr events (kind 30078, tagged and with
 *    a NIP-40 expiry) posted to several public relays and refreshed while the room is open.
 *    Private rooms are never posted.
 *  - Players with the same room code meet through Trystero over the same public relays, which
 *    performs the WebRTC handshake. After that the match runs directly device to device.
 */

export const APP_ID = `ringer3d-v${PROTOCOL_VERSION}`;
const LIST_TAG = `ringer3d-rooms-v${PROTOCOL_VERSION}`;
const KIND = 30078;
const AD_TTL = 75; // seconds
const AD_REFRESH_MS = 20_000;

export const LISTING_RELAYS = ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://relay.nostr.net'];

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  let c = '';
  const buf = new Uint32Array(4);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 4; i++) c += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return c;
}

type Wire = { k: 'host'; room: RoomInfo } | { k: 'msg'; m: PeerMsg } | { k: 'bye' };

class P2PLink implements Link {
  readonly remoteId: string;
  mode: LinkMode = 'direct';
  onMessage: (m: PeerMsg) => void = () => {};
  onState: (mode: LinkMode) => void = () => {};
  private sendFn: (w: Wire, target: string) => void;
  constructor(remoteId: string, sendFn: (w: Wire, target: string) => void) {
    this.remoteId = remoteId;
    this.sendFn = sendFn;
    queueMicrotask(() => this.onState(this.mode));
  }
  send(m: PeerMsg) {
    if (this.mode !== 'closed') this.sendFn({ k: 'msg', m }, this.remoteId);
  }
  close() {
    this.mode = 'closed';
  }
}

export class P2PMatchmaker implements Matchmaker {
  readonly kind = 'p2p' as const;
  readonly myId = selfId;
  private pool = new SimplePool();
  private relays: string[];
  private room: Room | null = null;
  private sendWire: ((w: Wire, target: string) => void) | null = null;
  private links = new Map<string, P2PLink>();
  private cbs = new Set<(e: MatchmakerEvent) => void>();
  private hosting: RoomInfo | null = null;
  private adKey: Uint8Array | null = null;
  private adTimer: ReturnType<typeof setInterval> | null = null;
  private hostId: string | null = null;
  private pendingJoin: ((r: { room: RoomInfo; hostId: string }) => void) | null = null;

  constructor(relays = LISTING_RELAYS) {
    this.relays = relays;
  }

  async connect() {
    /* relays connect lazily */
  }

  private emit(e: MatchmakerEvent) {
    this.cbs.forEach((f) => f(e));
  }

  on(cb: (e: MatchmakerEvent) => void) {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }

  // ---- Server browser over Nostr ---------------------------------------------------------
  async listRooms(): Promise<RoomInfo[]> {
    const now = Math.floor(Date.now() / 1000);
    const events = await this.pool.querySync(this.relays, { kinds: [KIND], '#t': [LIST_TAG], since: now - AD_TTL }, { maxWait: 2500 });
    const latest = new Map<string, { at: number; room: RoomInfo | null }>();
    for (const ev of events) {
      const d = ev.tags.find((t) => t[0] === 'd')?.[1];
      const exp = Number(ev.tags.find((t) => t[0] === 'expiration')?.[1] ?? 0);
      if (!d || exp < now) continue;
      const prev = latest.get(d);
      if (prev && prev.at >= ev.created_at) continue;
      let room: RoomInfo | null = null;
      try {
        const parsed = JSON.parse(ev.content) as RoomInfo & { closed?: boolean };
        room = parsed.closed ? null : parsed;
      } catch {
        room = null;
      }
      latest.set(d, { at: ev.created_at, room });
    }
    return [...latest.values()]
      .map((x) => x.room)
      .filter((r): r is RoomInfo => !!r && r.version === PROTOCOL_VERSION)
      .sort((a, b) => Number(a.started) - Number(b.started));
  }

  private publishAd(closed = false) {
    const r = this.hosting;
    if (!r || r.private || !this.adKey) return;
    const now = Math.floor(Date.now() / 1000);
    const ev = finalizeEvent(
      {
        kind: KIND,
        created_at: now,
        tags: [
          ['d', `ringer3d:${r.code}`],
          ['t', LIST_TAG],
          ['expiration', String(now + (closed ? 5 : AD_TTL))],
        ],
        content: JSON.stringify(closed ? { closed: true } : r),
      },
      this.adKey,
    );
    for (const p of this.pool.publish(this.relays, ev)) p.catch(() => {});
  }

  // ---- Rooms over Trystero ---------------------------------------------------------------
  private enter(code: string) {
    const room = joinRoom({ appId: APP_ID, rtcConfig: { iceServers: DEFAULT_ICE } }, `room-${code}`);
    this.room = room;
    const action = room.makeAction<string>('g');
    this.sendWire = (w, target) => void action.send(JSON.stringify(w), { target }).catch(() => {});
    action.onMessage = (raw, ctx) => {
      try {
        this.onWire(JSON.parse(raw) as Wire, ctx.peerId);
      } catch {
        /* ignore malformed */
      }
    };
    room.onPeerJoin = (peerId) => {
      if (this.hosting) {
        // Tell the newcomer who hosts and what the room is, then let OnlineRoom take over.
        this.sendWire!({ k: 'host', room: this.hosting }, peerId);
        this.emit({ t: 'peer-joined', peerId, name: 'Player' });
      }
    };
    room.onPeerLeave = (peerId) => this.dropPeer(peerId);
  }

  private onWire(w: Wire, from: string) {
    if (w.k === 'host') {
      if (!this.hosting && !this.hostId && this.pendingJoin) {
        this.hostId = from;
        this.pendingJoin({ room: w.room, hostId: from });
        this.pendingJoin = null;
      }
      return;
    }
    if (w.k === 'bye') {
      this.dropPeer(from);
      return;
    }
    this.links.get(from)?.onMessage(w.m);
  }

  private dropPeer(peerId: string) {
    const link = this.links.get(peerId);
    if (link) {
      link.close();
      link.onState('closed');
      this.links.delete(peerId);
    }
    if (this.hosting) this.emit({ t: 'peer-left', peerId });
    else if (peerId === this.hostId) this.emit({ t: 'room-closed' });
  }

  async host(o: CreateRoomOptions): Promise<RoomInfo> {
    const code = newCode();
    this.hosting = {
      id: code,
      code,
      name: o.name,
      arena: o.arena,
      players: 1,
      maxPlayers: o.maxPlayers,
      private: o.private,
      started: false,
      hostName: o.hostName,
      version: PROTOCOL_VERSION,
    };
    this.adKey = generateSecretKey();
    this.enter(code);
    this.publishAd();
    this.adTimer = setInterval(() => this.publishAd(), AD_REFRESH_MS);
    return this.hosting;
  }

  join(o: { roomId?: string; code?: string; name: string }): Promise<{ room: RoomInfo; hostId: string }> {
    const code = (o.code ?? o.roomId ?? '').toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) return Promise.reject(new Error('Room codes are four letters.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingJoin = null;
        this.leave();
        reject(new Error('No host answered for that code. Check the code, or ask the host to keep the room open.'));
      }, 25_000);
      this.pendingJoin = (r) => {
        clearTimeout(timer);
        if (r.room.version !== PROTOCOL_VERSION) {
          this.leave();
          reject(new Error('That room is running a different game version.'));
          return;
        }
        resolve(r);
      };
      this.enter(code);
    });
  }

  update(u: { players: number; started: boolean; arena: RoomInfo['arena'] }) {
    if (!this.hosting) return;
    this.hosting = { ...this.hosting, ...u };
    this.publishAd();
  }

  link(peerId: string): Link {
    let l = this.links.get(peerId);
    if (!l) {
      l = new P2PLink(peerId, (w, t) => this.sendWire?.(w, t));
      this.links.set(peerId, l);
    }
    return l;
  }

  leave() {
    if (this.adTimer) clearInterval(this.adTimer);
    this.adTimer = null;
    if (this.hosting) this.publishAd(true);
    for (const id of this.links.keys()) this.sendWire?.({ k: 'bye' }, id);
    const room = this.room;
    this.room = null;
    // Give the goodbye a moment to leave before tearing the connections down.
    setTimeout(() => void room?.leave(), 300);
    this.links.clear();
    this.hosting = null;
    this.hostId = null;
  }

  close() {
    this.leave();
    this.cbs.clear();
    this.pool.close(this.relays);
  }
}
