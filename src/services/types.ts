import type { Collectible } from '../core/collectible';
import type { AchievementId, BoardId, StatId } from './catalog';

/**
 * The game's view of a store platform (Steam, Google Play, or none), headless: no DOM, no React,
 * so the same adapters run in the browser, in the Steam shell and in plain Node (CLI, agents,
 * tests). The game only ever calls these; each platform is an adapter (steamServices.ts,
 * playServices.ts, localServices.ts) and src/services/index.ts picks one at runtime.
 * Real-money purchases stay in src/platformStore.ts (StoreAdapter), the same idea.
 */

export type PlatformId = 'steam' | 'play' | 'local';

export interface Identity {
  id: string;
  name: string;
  /** A handheld (Steam Deck): lighter graphics by default. */
  handheld: boolean;
  language: string;
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  rank: number;
  score: number;
}

export interface Friend {
  id: string;
  name: string;
  online: boolean;
  /** Playing this game right now, and the lobby they're in (null: none). */
  inGame: boolean;
  lobby: string | null;
  status: string;
}

/** A marble held by the platform (a Steam inventory item), shown next to the local collection. */
export type HeldItem = Collectible & { itemId: string; tally: number };

export type ItemResult = { ok: true; marble: HeldItem } | { ok: false; why: string };

/** Collectibles the platform mints and holds (Steam Inventory). Null where it doesn't. */
export interface ItemsService {
  /** Snapshot and change feed of what's held. */
  held(): { marbles: HeldItem[]; bags: string[]; error: string | null };
  subscribe(cb: () => void): () => void;
  sync(): Promise<void>;
  /** A playtime drop if one is due; the marbles that dropped. */
  drop(): Promise<HeldItem[]>;
  tradeUp(itemIds: string[]): Promise<ItemResult>;
  openBag(bagItemId: string): Promise<ItemResult>;
  /** Opens the platform's checkout for a bag; false where bags aren't sold. */
  buyBag(): Promise<boolean>;
  canBuyBags: boolean;
  addTally(marbleId: string, captures: number): Promise<void>;
}

export interface PlatformServices {
  readonly platform: PlatformId;
  identity(): Promise<Identity | null>;

  unlock(id: AchievementId): Promise<void>;
  /** Achievements the player has, as far as the platform says. */
  unlocked(): Promise<AchievementId[]>;
  /** Set an integer stat (buffered); flush() sends the batch. */
  setStat(id: StatId, value: number): void;
  flush(): Promise<void>;

  /** Submit a score (the platform keeps the player's best); their rank if known. */
  submitScore(board: BoardId, score: number): Promise<{ rank: number | null }>;
  scores(board: BoardId, scope: 'global' | 'friends' | 'around', count?: number): Promise<LeaderboardEntry[]>;

  /** Cloud saves by file name; null where there are none. */
  cloud: { read(file: string): Promise<string | null>; write(file: string, text: string): Promise<boolean> } | null;
  /** What friends see next to your name, and the group (lobby) you're in. */
  presence(status: string, group?: string): void;
  friends(): Promise<Friend[]>;
  showProfile?(id: string): void;
  /** Game recording: mark a moment (Steam Timeline), and say what kind of screen this is. */
  moment(title: string, desc?: string): void;
  mode(m: 'playing' | 'lobby' | 'menus' | 'loading'): void;

  items: ItemsService | null;
}
