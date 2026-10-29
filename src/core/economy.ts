import { generateMarble, RARITY, type GeneratedMarble, type Tier } from './marbleGen';

/**
 * The collectible economy, the same on every platform: coins earned by playing (and bought
 * through the platform's store), Marble Bags that mint a brand-new generated marble, melting
 * marbles back into coins, a daily reward. Pure functions over plain data: the web, Play Store
 * and Steam builds keep a Wallet in their own storage and call these; a server can run the
 * same rules. Randomness comes in as seeds from the caller, so the rules stay deterministic.
 *
 * Fairness rules kept here on purpose: every marble plays the same (cosmetic only), bags are
 * opened with coins and always show their odds, and coins are earned in every match.
 */

export interface Wallet {
  coins: number;
  /** Generated marbles owned, by id ("g" + seed), oldest first. */
  owned: { id: string; tier: Tier; at: number }[];
  /** Day number (UTC) of the last daily claim, and the streak so far. */
  lastDaily: number;
  streak: number;
  /** Store receipts already credited: a purchase is granted once, however often it's reported. */
  receipts: string[];
  bagsOpened: number;
}

export const ECONOMY = {
  startCoins: 150,
  bagPrice: 300,
  /** Coins for a finished match: a win, a loss, and each marble you captured. */
  reward: { win: 60, loss: 20, perCapture: 5 },
  /** Daily reward by streak day (the last repeats). */
  daily: [50, 75, 100, 150, 200, 250, 400],
  /** What melting a marble pays, by tier. */
  melt: { Common: 40, Rare: 120, Epic: 300, Legendary: 800, Mythic: 2500 } as Record<Tier, number>,
  maxCollection: 500,
} as const;

/** Real-money products, the same ids on every store (Play Console, Steam, a web shop). */
export const PRODUCTS = [
  { id: 'coins_small', coins: 500, label: '500 coins', usd: 0.99 },
  { id: 'coins_medium', coins: 1500, label: '1,500 coins', usd: 2.99 },
  { id: 'coins_large', coins: 5000, label: '5,000 coins', usd: 7.99 },
] as const;
export type ProductId = (typeof PRODUCTS)[number]['id'];

export function freshWallet(): Wallet {
  return { coins: ECONOMY.startCoins, owned: [], lastDaily: -1, streak: 0, receipts: [], bagsOpened: 0 };
}

/** The bag's odds in percent, for the label on the bag. */
export function bagOdds(): { tier: Tier; odds: number }[] {
  return RARITY.map((r) => ({ tier: r.tier, odds: r.odds }));
}

export function matchReward(r: { won: boolean; captured: number }): number {
  return (r.won ? ECONOMY.reward.win : ECONOMY.reward.loss) + Math.max(0, r.captured) * ECONOMY.reward.perCapture;
}

export function earn(w: Wallet, coins: number): Wallet {
  return { ...w, coins: w.coins + Math.max(0, Math.floor(coins)) };
}

export type Refusal = { ok: false; why: string };

/**
 * Open a Marble Bag: spend the price and mint the marble for `seed` (a fresh random 32-bit
 * number from the caller). The seed is the marble; its tier comes from the seed with the
 * published odds.
 */
export function openBag(w: Wallet, seed: number, now = 0): { ok: true; wallet: Wallet; marble: GeneratedMarble } | Refusal {
  if (w.coins < ECONOMY.bagPrice) return { ok: false, why: 'Not enough coins.' };
  if (w.owned.length >= ECONOMY.maxCollection) return { ok: false, why: 'Your collection is full: melt a few marbles first.' };
  const marble = generateMarble(seed);
  if (w.owned.some((o) => o.id === marble.id)) return { ok: false, why: 'Try again.' }; // a 1 in 4 billion repeat
  return {
    ok: true,
    marble,
    wallet: { ...w, coins: w.coins - ECONOMY.bagPrice, owned: [...w.owned, { id: marble.id, tier: marble.tier, at: now }], bagsOpened: w.bagsOpened + 1 },
  };
}

/** Melt an owned generated marble back into coins. */
export function melt(w: Wallet, id: string): { ok: true; wallet: Wallet; coins: number } | Refusal {
  const m = w.owned.find((o) => o.id === id);
  if (!m) return { ok: false, why: "You don't own that marble." };
  const coins = ECONOMY.melt[m.tier];
  return { ok: true, coins, wallet: { ...w, coins: w.coins + coins, owned: w.owned.filter((o) => o.id !== id) } };
}

/** Claim today's reward (`day` = days since the epoch, UTC). Streaks break after a missed day. */
export function claimDaily(w: Wallet, day: number): { ok: true; wallet: Wallet; coins: number; streak: number } | Refusal {
  if (w.lastDaily >= day) return { ok: false, why: 'Come back tomorrow!' };
  const streak = w.lastDaily === day - 1 ? w.streak + 1 : 1;
  const coins = ECONOMY.daily[Math.min(streak, ECONOMY.daily.length) - 1];
  return { ok: true, coins, streak, wallet: { ...w, coins: w.coins + coins, lastDaily: day, streak } };
}

/** What the next daily claim would be: its day in the streak and its coins (the reward strip). */
export function nextDaily(w: Wallet, day: number): { streak: number; coins: number; ready: boolean } {
  const ready = w.lastDaily < day;
  const streak = !ready ? w.streak : w.lastDaily === day - 1 ? w.streak + 1 : 1;
  return { streak, coins: ECONOMY.daily[Math.min(streak, ECONOMY.daily.length) - 1], ready };
}

/**
 * The player's level, from match stats alone (no state of its own): XP for playing, winning and
 * every capture; level L needs 100 × L more XP to reach L + 1.
 */
export function playerLevel(stats: { played: number; won: number; captured: number }): { level: number; xp: number; into: number; need: number } {
  const xp = stats.played * 20 + stats.won * 40 + stats.captured * 4;
  let level = 1;
  let left = xp;
  while (left >= level * 100) {
    left -= level * 100;
    level++;
  }
  return { level, xp, into: left, need: level * 100 };
}

/** Credit a store purchase once per receipt. */
export function grantPurchase(w: Wallet, receipt: string, product: ProductId): Wallet {
  const p = PRODUCTS.find((x) => x.id === product);
  if (!p || w.receipts.includes(receipt)) return w;
  return { ...w, coins: w.coins + p.coins, receipts: [...w.receipts.slice(-199), receipt] };
}
