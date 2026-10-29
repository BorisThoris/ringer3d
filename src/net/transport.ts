import type { ArenaId } from '../game/arenas';
import type { PeerMsg, RoomInfo } from './protocol';

export type LinkMode = 'connecting' | 'direct' | 'relay' | 'closed';

/** A message pipe to one remote player. */
export interface Link {
  readonly remoteId: string;
  mode: LinkMode;
  send(m: PeerMsg): void;
  onMessage: (m: PeerMsg) => void;
  onState: (mode: LinkMode) => void;
  close(): void;
}

export type MatchmakerEvent =
  | { t: 'peer-joined'; peerId: string; name: string }
  | { t: 'peer-left'; peerId: string }
  | { t: 'room-closed' }
  | { t: 'error'; message: string };

export interface CreateRoomOptions {
  name: string;
  hostName: string;
  arena: ArenaId;
  maxPlayers: number;
  private: boolean;
}

/**
 * How players find each other. Two implementations:
 *  - P2PMatchmaker: no server of our own. Room listings and WebRTC handshakes go over public
 *    Nostr relays; matches run directly between devices.
 *  - ServerMatchmaker: our optional lobby server (adds a relay for very strict networks).
 */
export interface Matchmaker {
  readonly kind: 'p2p' | 'server' | 'steam';
  readonly myId: string;
  connect(): Promise<void>;
  listRooms(): Promise<RoomInfo[]>;
  host(o: CreateRoomOptions): Promise<RoomInfo>;
  join(o: { roomId?: string; code?: string; name: string }): Promise<{ room: RoomInfo; hostId: string }>;
  update(u: { players: number; started: boolean; arena: ArenaId }): void;
  leave(): void;
  on(cb: (e: MatchmakerEvent) => void): () => void;
  link(peerId: string, initiator: boolean): Link;
  close(): void;
}
