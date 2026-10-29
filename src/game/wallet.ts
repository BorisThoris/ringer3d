import { claimDaily, earn, freshWallet, grantPurchase, matchReward, melt, openBag, type ProductId, type Wallet } from '../core/economy';
import type { GeneratedMarble } from '../core/marbleGen';
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

/** A fresh random 32-bit seed: a new marble. Never Math.random (it isn't 32 bits of anything). */
function freshSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

export function rewardMatch(won: boolean, captured: number): number {
  const coins = matchReward({ won, captured });
  wallet.set((w) => earn(w, coins));
  return coins;
}

export function buyBag(): { ok: true; marble: GeneratedMarble } | { ok: false; why: string } {
  const r = openBag(wallet.get(), freshSeed(), Date.now());
  if (!r.ok) return r;
  wallet.set(r.wallet);
  return { ok: true, marble: r.marble };
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

export function credit(receipt: string, product: ProductId) {
  wallet.set((w) => grantPurchase(w, receipt, product));
}
