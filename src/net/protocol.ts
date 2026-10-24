/**
 * Wire protocol. Two layers:
 *
 * - Lobby (client <-> lobby server, WebSocket): server browser, rooms, room
 *   codes, WebRTC signalling, and a relay for peers that cannot connect
 *   directly.
 * - Game (peer <-> peer, WebRTC data channel or the relay): a star around
 *   the host. Shots travel as inputs; the host's settled outcome is final.
 *
 * Shared by the browser client and the Node lobby server. Type-only exports
 * plus plain constants, so Node can load it with type stripping.
 */
import type { ShotInput, ShotOutcome, Vec2 } from '../core/types';

export const PROTOCOL_VERSION = 1;

export interface RoomInfo {
  id: string;
  /** Four letters, shareable: join a private room with it. */
  code: string;
  name: string;
  hostName: string;
  players: number;
  max: number;
  arena: string;
  majority: boolean;
  isPublic: boolean;
  inGame: boolean;
}

export interface RoomSettings {
  name: string;
  isPublic: boolean;
  max: number;
  arena: string;
  majority: boolean;
}

// ------------------------------------------------------------- lobby

export type LobbyRequest =
  | { t: 'hello'; name: string; version: number }
  | { t: 'list' }
  | { t: 'create'; settings: RoomSettings }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'update'; settings: Partial<RoomSettings> & { inGame?: boolean } }
  | { t: 'signal'; to: string; data: unknown }
  | { t: 'relay'; to: string | '*'; data: GameMsg }
  | { t: 'ping'; at: number };

export type LobbyEvent =
  | { t: 'welcome'; you: string; version: number }
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'joined'; room: RoomInfo; you: string; host: string; peers: { id: string; name: string }[] }
  | { t: 'room'; room: RoomInfo }
  | { t: 'peer-joined'; peer: { id: string; name: string } }
  | { t: 'peer-left'; id: string }
  | { t: 'host-left' }
  | { t: 'signal'; from: string; data: unknown }
  | { t: 'relay'; from: string; data: GameMsg }
  | { t: 'pong'; at: number }
  | { t: 'error'; message: string };

// ------------------------------------------------------------- game

export interface SeatInfo {
  /** Lobby peer id, or `bot:<profile>` for host-run bots. */
  peer: string;
  name: string;
  color: string;
  taw: number;
}

export type GameMsg =
  /** Client -> host: who I am. */
  | { k: 'me'; name: string; taw: number }
  /** Host -> all: who is seated. */
  | { k: 'roster'; seats: SeatInfo[] }
  /** Host -> all: the match begins. */
  | { k: 'start'; seats: SeatInfo[]; arena: string; majority: boolean; lag: boolean; seed: number }
  /** Shooter -> host, host -> everyone else. `seq` = shots taken before this one. */
  | { k: 'shot'; player: number; seq: number; shot: ShotInput }
  /** Host -> all: how a shot (or a lag) came to rest. Final. */
  | { k: 'outcome'; seq: number; kind: 'shot'; outcome: ShotOutcome }
  | { k: 'outcome'; seq: number; kind: 'lag'; player: number; distance: number; rest: Vec2 | null }
  /** Host -> all: a player left and a bot took their seat. */
  | { k: 'takeover'; player: number }
  /** Either way: live aim, so others see the shooter line up (throttled). */
  | { k: 'aim'; player: number; from: Vec2; yaw: number; power: number }
  | { k: 'emote'; player: number; text: string }
  | { k: 'bye' };

/** Unambiguous letters for room codes (no I/O/0/1 lookalikes). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
