/**
 * Steam, seen from the game. In the Steam build (steam/, Electron + steamworks.js) the preload
 * script puts a `SteamBridge` on `window.steam`; headless Node code gets the same object from
 * steam/node-bridge.cjs (`connectSteam`). Everywhere else it is absent and every Steam feature
 * quietly does nothing. The game reaches it through src/services (the platform-neutral layer),
 * not directly. Steam ids cross this boundary as decimal strings (64-bit ids don't fit a JS
 * number and BigInt doesn't survive JSON).
 */

export interface SteamLeaderboardEntry {
  steamId: string;
  name: string;
  rank: number;
  score: number;
}

export interface SteamFriend {
  steamId: string;
  name: string;
  state: 'offline' | 'online' | 'busy' | 'away' | 'snooze' | 'trade' | 'play';
  /** The app they're playing (0: none) and its lobby ("0": none). */
  appId: number;
  lobby: string;
  /** Their rich presence status text. */
  status: string;
}

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
  me(): Promise<{ steamId: string; name: string; deck: boolean; language: string; level?: number; country?: string }>;

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
  // Leaderboards, friends, game recording (steam/social.cjs)
  /** Submit a score (created as a descending numeric board if missing); keepBest keeps a better old score. */
  submitScore(board: string, score: number, keepBest?: boolean): Promise<{ ok: boolean; score: number; changed: boolean; rank: number; previousRank: number }>;
  scores(board: string, scope?: 'global' | 'around' | 'friends', start?: number, end?: number): Promise<SteamLeaderboardEntry[]>;
  friends(): Promise<SteamFriend[]>;
  showUser(steamId: string, dialog?: 'steamid' | 'chat' | 'friendadd'): Promise<void>;
  /** Steam Timeline (game recording): a marker, the state line, the mode (1 playing, 2 lobby, 3 menus, 4 loading). */
  timelineEvent(title: string, desc?: string, icon?: string, priority?: number): Promise<boolean>;
  timelineState(desc: string): Promise<boolean>;
  timelineMode(mode: 1 | 2 | 3 | 4): Promise<boolean>;
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
