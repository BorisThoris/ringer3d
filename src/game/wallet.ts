import { localUid, type Collectible } from '../core/collectible';
import { addTally, claimDaily, claimSet, earn, freshWallet, grantPurchase, matchReward, melt, nextDaily, openBag, tradeUp, type ProductId, type Wallet } from '../core/economy';
import { createStore } from './store';

/**
 * This device's wallet: coins and the generated marbles owned, kept in local storage and
 * changed only through the core's economy rules (core/economy.ts). On Steam the same wallet
 * sits in the app's storage (Steam Cloud can sync it); a store purchase is credited here once
 * its receipt comes back from the platform's store adapter (platform/store.ts).
 */

const KEY = 'ringer3d.wallet.v1';

function load(): Wallet {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...freshWallet(), ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return freshWallet();
}

export const wallet = createStore<Wallet>(load());
wallet.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(wallet.get()));
  } catch {
    /* storage unavailable */
  }
});

const today = () => Math.floor(Date.now() / 86400000);

/** A fresh 64-bit instance id: a new marble. Never Math.random (it isn't 64 bits of anything). */
function freshUid(): string {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return localUid(a[0], a[1]);
}

/** A finished match: coins, and the captures go on the tally of the marble you played. */
export function rewardMatch(won: boolean, captured: number, marbleId?: string): number {
  const coins = matchReward({ won, captured });
  wallet.set((w) => (marbleId ? addTally(earn(w, coins), marbleId, captured) : earn(w, coins)));
  return coins;
}

export function buyBag(): { ok: true; marble: Collectible } | { ok: false; why: string } {
  const r = openBag(wallet.get(), freshUid(), Date.now());
  if (!r.ok) return r;
  wallet.set(r.wallet);
  return { ok: true, marble: r.marble };
}

export function tradeUpMarbles(ids: string[]): { ok: true; marble: Collectible } | { ok: false; why: string } {
  const r = tradeUp(wallet.get(), ids, freshUid(), Date.now());
  if (!r.ok) return r;
  wallet.set(r.wallet);
  return { ok: true, marble: r.marble };
}

export function claimBookSet(setId: string, extra: Collectible[] = []): { ok: true; coins: number } | { ok: false; why: string } {
  const r = claimSet(wallet.get(), setId, extra);
  if (!r.ok) return r;
  wallet.set(r.wallet);
  return { ok: true, coins: r.coins };
}

export function meltMarble(id: string): { ok: true; coins: number } | { ok: false; why: string } {
  const r = melt(wallet.get(), id);
  if (!r.ok) return r;
  wallet.set(r.wallet);
  return { ok: true, coins: r.coins };
}

export function claimToday(): { ok: true; coins: number; streak: number } | { ok: false; why: string } {
  const r = claimDaily(wallet.get(), today());
  if (!r.ok) return r;
  wallet.set(r.wallet);
  return { ok: true, coins: r.coins, streak: r.streak };
}

export function dailyReady(w: Wallet): boolean {
  return w.lastDaily < today();
}

/** Today's place in the daily-reward strip, by the same rule a claim uses. */
export function dailyPreview(w: Wallet) {
  return nextDaily(w, today());
}

export function credit(receipt: string, product: ProductId) {
  wallet.set((w) => grantPurchase(w, receipt, product));
}
