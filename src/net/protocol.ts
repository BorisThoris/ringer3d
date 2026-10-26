import type { MatchSnapshot } from '../core/match';
import type { PlayerInfo, Shot } from '../core/types';
import type { ArenaId } from '../game/arenas';
import type { Difficulty, MapDef } from '../game/maps';

/** 2: matches carry a generated map (obstacles, hazards), sent whole by the host. */
export const PROTOCOL_VERSION = 2;

export interface OnlineMatchConfig {
  seed: number;
  arena: ArenaId;
  players: PlayerInfo[];
  /** The map, generated once by the host and played as sent by everyone. */
  map?: MapDef;
}

export interface RosterEntry {
  peerId: string;
  name: string;
  marble: string;
  ready: boolean;
  isHost: boolean;
  isBot?: boolean;
  botProfile?: string;
}

export interface AimPreview {
  placeAngle: number;
  aimAngle: number;
  power: number;
  spin: number;
}

/** Messages exchanged between peers (over WebRTC data channels, or relayed by the lobby server). */
export type PeerMsg =
  | { t: 'hello'; name: string; marble: string; version: number }
  | { t: 'roster'; roster: RosterEntry[]; arena: ArenaId; difficulty?: Difficulty; mapSeed?: number }
  | { t: 'ready'; ready: boolean }
  | { t: 'start'; config: OnlineMatchConfig; seats: Record<string, number> }
  | { t: 'aim'; seat: number; aim: AimPreview }
  | { t: 'shot'; seat: number; n: number; shot: Shot }
  | { t: 'hash'; n: number; hash: string }
  | { t: 'sync'; n: number; snapshot: MatchSnapshot }
  | { t: 'emote'; seat: number; id: string }
  | { t: 'seatLost'; seat: number; botProfile: string }
  | { t: 'kick'; reason: string }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number };

/** Public room listing shown in the server browser. */
export interface RoomInfo {
  id: string;
  code: string;
  name: string;
  arena: ArenaId;
  players: number;
  maxPlayers: number;
  private: boolean;
  started: boolean;
  hostName: string;
  version: number;
}

/** Client ↔ lobby server messages. */
export type LobbyClientMsg =
  | { t: 'list' }
  | { t: 'create'; name: string; hostName: string; arena: ArenaId; maxPlayers: number; private: boolean; version: number }
  | { t: 'join'; roomId?: string; code?: string; name: string; version: number }
  | { t: 'update'; players: number; started: boolean; arena: ArenaId }
  | { t: 'signal'; to: string; data: unknown }
  | { t: 'relay'; to: string; data: PeerMsg }
  | { t: 'leave' };

export type LobbyServerMsg =
  | { t: 'welcome'; peerId: string; iceServers?: RTCIceServer[] }
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'created'; room: RoomInfo }
  | { t: 'joined'; room: RoomInfo; hostId: string }
  | { t: 'peer-joined'; peerId: string; name: string }
  | { t: 'peer-left'; peerId: string }
  | { t: 'room-closed' }
  | { t: 'signal'; from: string; data: unknown }
  | { t: 'relay'; from: string; data: PeerMsg }
  | { t: 'error'; message: string };
