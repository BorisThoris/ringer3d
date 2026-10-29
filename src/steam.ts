/**
 * Steam, seen from the game. In the Steam build (steam/, Electron + steamworks.js) the preload
 * script puts a `SteamBridge` on `window.steam`; everywhere else it is absent and every Steam
 * feature quietly does nothing. Steam ids cross this boundary as decimal strings (64-bit ids
 * don't fit a JS number and BigInt doesn't survive JSON).
 */

export type LobbyKind = 'public' | 'friends' | 'private';

export interface SteamLobbySummary {
  id: string;
  data: Record<string, string>;
  members: number;
  max: number;
}

/** One stack in the player's Steam inventory. `props` = the item's dynamic properties. */
export interface SteamItem {
  itemId: string;
  def: number;
  qty: number;
  removed: boolean;
  props: Record<string, unknown>;
}

export interface SteamBridge {
  readonly appId: number;
  me(): Promise<{ steamId: string; name: string; deck: boolean; language: string }>;

  // Lobbies (ISteamMatchmaking)
  createLobby(kind: LobbyKind, max: number): Promise<string>;
  joinLobby(id: string): Promise<string>;
  listLobbies(): Promise<SteamLobbySummary[]>;
  leaveLobby(id: string): Promise<void>;
  setLobbyData(id: string, data: Record<string, string>): Promise<boolean>;
  lobbyData(id: string): Promise<Record<string, string>>;
  lobbyMembers(id: string): Promise<string[]>;
  lobbyOwner(id: string): Promise<string>;
  setJoinable(id: string, joinable: boolean): Promise<void>;
  inviteFriends(id: string): Promise<void>;

  // P2P (ISteamNetworking): reliable messages, JSON text
  sendP2P(steamId: string, text: string): Promise<boolean>;
  onP2P(cb: (from: string, text: string) => void): () => void;
  onLobbyChange(cb: (lobby: string, user: string, change: 'entered' | 'left') => void): () => void;
  /** A friend invited you (or you chose Join Game in the friends list). */
  onJoinRequested(cb: (lobby: string, friend: string) => void): () => void;

  // Achievements, stats, cloud, presence, overlay
  unlock(achievement: string): Promise<boolean>;
  /** Which of these achievements the player has unlocked. */
  achievements(names: string[]): Promise<string[]>;
  statGet(name: string): Promise<number | null>;
  statSet(name: string, value: number): Promise<boolean>;
  statsStore(): Promise<boolean>;
  cloudRead(file: string): Promise<string | null>;
  cloudWrite(file: string, text: string): Promise<boolean>;
  presence(key: string, value: string | null): Promise<void>;
  overlay(dialog: 'friends' | 'community' | 'players' | 'settings' | 'stats' | 'achievements'): Promise<void>;
  // Steam Inventory (ISteamInventory, steam/inventory.cjs): item ids are decimal strings.
  invAll(): Promise<SteamItem[]>;
  /** A playtime drop from a playtimegenerator itemdef, if Steam says one is due. */
  invDrop(listDef: number): Promise<SteamItem[]>;
  /** Make `gen` itemdefs from the `destroy` items; Steam enforces the itemdef's recipe. */
  invExchange(gen: number[], destroy: string[]): Promise<SteamItem[]>;
  invConsume(itemId: string): Promise<SteamItem[]>;
  /** Opens Steam's checkout overlay for these itemdefs. */
  invBuy(defs: number[]): Promise<string>;
  invDefs(): Promise<{ def: number; name: string; type: string }[]>;
  invSetProps(sets: { itemId: string; name: string; value: number }[]): Promise<SteamItem[]>;
  /** A session ticket for our server to check with ISteamUserAuth (store purchases). */
  webApiTicket(identity: string): Promise<string | null>;
  onMicroTxn(cb: (orderId: string, authorized: boolean) => void): () => void;
}

declare global {
  interface Window {
    steam?: SteamBridge;
  }
}

export const steam: SteamBridge | null = typeof window !== 'undefined' && window.steam ? window.steam : null;
export const isSteam = steam !== null;
