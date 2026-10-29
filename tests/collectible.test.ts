import { describe, expect, it } from 'vitest';
import {
  BOOK,
  bookProgress,
  collectibleFromId,
  collectibleId,
  isCollectibleId,
  localUid,
  mintCollectible,
  SHINY_ODDS,
  TIERS,
  WEARS,
  wearFor,
} from '../src/core/collectible';
import { claimSet, ECONOMY, freshWallet, meltValue, openBag, tradeUp } from '../src/core/economy';
import { RARITY } from '../src/core/marbleGen';

const uids = (n: number, p = 's') => Array.from({ length: n }, (_, i) => `${p}${76561198000000000n + BigInt(i * 7919)}`);

describe('collectible marbles', () => {
  it('are pure functions of their uid: same uid, same marble, through the id and back', () => {
    for (const uid of uids(50)) {
      const a = mintCollectible(uid);
      expect(mintCollectible(uid)).toEqual(a);
      expect(collectibleFromId(a.id)).toEqual(a);
      expect(a.id).toBe(collectibleId(a.tier, uid));
      expect(isCollectibleId(a.id)).toBe(true);
    }
  });

  it('keep a forced tier (Steam itemdefs and trade-ups decide the tier)', () => {
    for (const t of TIERS) expect(mintCollectible('s123', t).tier).toBe(t);
  });

  it('have floats in [0, 1) with the right wear name, and different uids differ', () => {
    const all = uids(400).map((u) => mintCollectible(u));
    for (const c of all) {
      expect(c.float).toBeGreaterThanOrEqual(0);
      expect(c.float).toBeLessThan(1);
      expect(c.wear).toBe(wearFor(c.float));
      expect(c.pattern).toBeGreaterThanOrEqual(0);
      expect(c.pattern).toBeLessThan(1000);
    }
    expect(new Set(all.map((c) => c.float)).size).toBeGreaterThan(390);
    expect(new Set(all.map((c) => c.marble.name + c.marble.base)).size).toBeGreaterThan(380);
  });

  it('mint wears, tiers and Shinies close to their published odds', () => {
    const n = 20000;
    const all = uids(n, 'L').map((u) => mintCollectible(u));
    const share = (f: (c: (typeof all)[number]) => boolean) => (all.filter(f).length / n) * 100;
    const total = WEARS.reduce((a, w) => a + w.weight, 0);
    for (const w of WEARS) expect(Math.abs(share((c) => c.wear === w.name) - (w.weight / total) * 100)).toBeLessThan(1.5);
    for (const r of RARITY) expect(Math.abs(share((c) => c.tier === r.tier) - r.odds)).toBeLessThan(1.5);
    expect(Math.abs(share((c) => c.shiny) - 100 / SHINY_ODDS)).toBeLessThan(0.6);
  });

  it('read old "g" + seed saves unchanged', () => {
    const c = collectibleFromId('g42')!;
    expect(c.id).toBe('g42');
    expect(c.marble.seed).toBe(42);
    expect(collectibleFromId('ember')).toBeNull();
    expect(collectibleFromId('cX-123')).toBeNull();
  });

  it('local uids are 64-bit hex', () => {
    expect(localUid(0xdeadbeef, 1)).toBe('Ldeadbeef00000001');
  });
});

describe('collecting rules', () => {
  const walletWith = (ids: string[]) => ({ ...freshWallet(), owned: ids.map((id) => ({ id, tier: collectibleFromId(id)!.tier, at: 0 })) });

  it('trade-up: five of a tier become one of the next', () => {
    const commons = uids(5, 'L').map((u) => collectibleId('Common', u));
    const w = walletWith([...commons, collectibleId('Rare', 'Lkeep')]);
    const r = tradeUp(w, commons, 'Lnewone');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.marble.tier).toBe('Rare');
    expect(r.wallet.owned.map((o) => o.id)).toEqual([collectibleId('Rare', 'Lkeep'), r.marble.id]);
    expect(tradeUp(w, commons.slice(0, 4), 'Lx').ok).toBe(false);
    expect(tradeUp(walletWith([...commons.slice(0, 4), collectibleId('Rare', 'Ly')]), [...commons.slice(0, 4), collectibleId('Rare', 'Ly')], 'Lz').ok).toBe(false);
    const myth = uids(5, 'M').map((u) => collectibleId('Mythic', u));
    expect(tradeUp(walletWith(myth), myth, 'Lq').ok).toBe(false);
  });

  it('melt values reward Mint and Shiny', () => {
    expect(meltValue({ tier: 'Rare', wear: 'Played', shiny: false })).toBe(ECONOMY.melt.Rare);
    expect(meltValue({ tier: 'Rare', wear: 'Mint', shiny: false })).toBe(ECONOMY.melt.Rare * 2);
    expect(meltValue({ tier: 'Rare', wear: 'Played', shiny: true })).toBe(ECONOMY.melt.Rare * 5);
  });

  it('Marble Book sets pay once, when complete', () => {
    const tiers = TIERS.map((t, i) => collectibleId(t, `Lset${i}`));
    const w = walletWith(tiers);
    expect(bookProgress(tiers.map((id) => collectibleFromId(id)!)).find((p) => p.set.id === 'tiers')!.done).toBe(true);
    const r = claimSet(w, 'tiers');
    expect(r.ok && r.coins).toBe(BOOK.find((b) => b.id === 'tiers')!.reward);
    if (!r.ok) return;
    expect(claimSet(r.wallet, 'tiers').ok).toBe(false);
    expect(claimSet(walletWith(tiers.slice(0, 3)), 'tiers').ok).toBe(false);
  });

  it('bags mint collectibles from the caller\'s uid', () => {
    const r = openBag({ ...freshWallet(), coins: 1000 }, 'Labc');
    expect(r.ok && r.marble.uid).toBe('Labc');
  });
});
