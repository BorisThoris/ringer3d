import { mintCollectible, nextTier, TIERS, TRADE_UP_COUNT } from './core/collectible';
import { RARITY, type Tier } from './core/marbleGen';
import type { HeldItem, ItemResult, ItemsService } from './services/types';
import type { SteamBridge, SteamItem } from './steam';

/**
 * Marbles in the player's Steam inventory. Each Steam item is one collectible marble: its
 * Steam item id is the marble's uid ("s" + itemid, core/collectible.ts), so its look, float,
 * pattern and Shiny roll travel with it through trades and the Community Market, and anyone
 * can check them. Its tier is its itemdef. Steam does the minting: playtime drops, Marble Bags
 * bought in Steam's item store and opened by an exchange, and trade-ups (five of a tier into
 * one of the next), each a recipe on the itemdef that Steam itself enforces.
 *
 * The item definitions for the real app are `itemDefs()` below (uploaded on the partner site
 * as steam/itemdefs.json; a test keeps the two equal). App 480, Valve's Spacewar test app,
 * has its own items, mapped here so the whole flow can be tried before the app exists.
 */

export interface SteamItemConfig {
  /** Tier of each marble itemdef. */
  tiers: Record<number, Tier>;
  /** playtimegenerator itemdef for drops. */
  dropList: number;
  /** The itemdef that mints each tier (the trade-up target; its recipe is five of the tier below). */
  mint?: Partial<Record<Tier, number>>;
  /** Marble Bag item (bought in the item store, dropped) and the generator that opens it. */
  bag?: number;
  bagOpen?: number;
}

export const RINGER_ITEMS: SteamItemConfig = {
  tiers: { 1001: 'Common', 1002: 'Rare', 1003: 'Epic', 1004: 'Legendary', 1005: 'Mythic' },
  mint: { Common: 1001, Rare: 1002, Epic: 1003, Legendary: 1004, Mythic: 1005 },
  dropList: 900,
  bag: 800,
  bagOpen: 801,
};

/** Spacewar's (App 480) items: ship parts we read as marbles of each tier, for testing. */
export const SPACEWAR_ITEMS: SteamItemConfig = {
  tiers: { 100: 'Common', 101: 'Common', 102: 'Rare', 103: 'Rare', 110: 'Epic', 111: 'Legendary', 120: 'Mythic', 121: 'Mythic' },
  dropList: 10,
};

export function itemConfig(appId: number | undefined): SteamItemConfig {
  return appId === 480 ? SPACEWAR_ITEMS : RINGER_ITEMS;
}

export interface SteamMarble extends HeldItem {
  def: number;
}

/** A Steam item as a marble, or null if the item isn't one. */
export function marbleFromItem(item: SteamItem, cfg: SteamItemConfig): SteamMarble | null {
  const tier = cfg.tiers[item.def];
  if (!tier || item.removed) return null;
  const tally = Number(item.props.tally ?? 0);
  return { ...mintCollectible(`s${item.itemId}`, tier), itemId: item.itemId, def: item.def, tally: Number.isFinite(tally) ? tally : 0 };
}

/**
 * The Steam inventory as the game's ItemsService (services/types.ts), for any SteamBridge: the
 * shell's window.steam or a headless one from steam/node-bridge.cjs.
 */
export function createSteamItems(bridge: SteamBridge): ItemsService {
  const cfg = itemConfig(bridge.appId);
  // A tiny store (no React here: this runs headless too).
  let snap: { marbles: SteamMarble[]; bags: string[]; error: string | null } = { marbles: [], bags: [], error: null };
  const subs = new Set<() => void>();
  const state = {
    get: () => snap,
    set(p: Partial<typeof snap>) {
      snap = { ...snap, ...p };
      subs.forEach((f) => f());
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
  };

  const absorb = (items: SteamItem[]) => ({
    marbles: items.map((i) => marbleFromItem(i, cfg)).filter((m): m is SteamMarble => !!m),
    bags: items.filter((i) => i.def === cfg.bag && !i.removed).map((i) => i.itemId),
  });

  async function sync() {
    try {
      const { marbles, bags } = absorb(await bridge.invAll());
      state.set({ marbles, bags, error: null });
    } catch (e) {
      state.set({ error: (e as Error).message });
    }
  }

  /** An exchange (bag opening, trade-up): Steam checks the itemdef recipe and mints. */
  async function exchange(gen: number, destroy: string[]): Promise<ItemResult> {
    try {
      const got = absorb(await bridge.invExchange([gen], destroy));
      await sync();
      return got.marbles[0] ? { ok: true, marble: got.marbles[0] } : { ok: false, why: 'Steam made nothing.' };
    } catch (e) {
      return { ok: false, why: (e as Error).message };
    }
  }

  return {
    held: () => state.get(),
    subscribe: (cb) => state.subscribe(cb),
    sync,
    async drop() {
      try {
        const got = absorb(await bridge.invDrop(cfg.dropList));
        if (got.marbles.length || got.bags.length) await sync();
        return got.marbles;
      } catch {
        return [];
      }
    },
    async tradeUp(itemIds) {
      const picked = itemIds.map((id) => state.get().marbles.find((m) => m.itemId === id));
      if (picked.length !== TRADE_UP_COUNT || picked.some((m) => !m)) return { ok: false, why: `Pick ${TRADE_UP_COUNT} Steam marbles.` };
      const tier = picked[0]!.tier;
      if (picked.some((m) => m!.tier !== tier)) return { ok: false, why: 'They all need to be the same rarity.' };
      const up = nextTier(tier);
      const target = up && cfg.mint?.[up];
      if (!target) return { ok: false, why: up ? 'Trade-ups open with the Steam release.' : 'Mythic is the top.' };
      return exchange(target, itemIds);
    },
    async openBag(bagItemId) {
      if (!cfg.bagOpen) return { ok: false, why: 'Steam bags open with the Steam release.' };
      return exchange(cfg.bagOpen, [bagItemId]);
    },
    canBuyBags: !!cfg.bag,
    async buyBag() {
      if (!cfg.bag) return false;
      await bridge.invBuy([cfg.bag]);
      return true;
    },
    async addTally(marbleId, captures) {
      const m = state.get().marbles.find((x) => x.id === marbleId);
      if (!m || captures <= 0) return;
      try {
        await bridge.invSetProps([{ itemId: m.itemId, name: 'tally', value: m.tally + captures }]);
        await sync();
      } catch {
        /* tallies are a nicety; never fail a match over one */
      }
    },
  };
}

// ---- Item definitions for the partner site ----------------------------------------------

const HEX: Record<Tier, string> = { Common: 'b9c1d0', Rare: '4f9dff', Epic: 'b45cff', Legendary: 'ffaa1e', Mythic: 'ff46be' };

/**
 * The real app's itemdefs, in Steam's itemdef JSON. Marbles are tradable and marketable; the
 * generator's weights are the published bag odds in tenths of a percent; each tier above
 * Common can be made from five of the tier below.
 */
export function itemDefs(appId: number, iconBase: string) {
  const c = RINGER_ITEMS;
  const odds = RARITY.map((r) => `${c.mint![r.tier]}x${Math.round(r.odds * 10)}`).join(';');
  const marbles = TIERS.map((t, i) => {
    const below = i > 0 ? TIERS[i - 1] : null;
    return {
      itemdefid: c.mint![t],
      type: 'item',
      name: `${t} Marble`,
      display_type: `${t} Marble`,
      description:
        'A one-of-a-kind Ringer marble. Its look, wear float, pattern and Shiny roll come from this item, so no two are alike; inspect it in the game.',
      background_color: '1d1638',
      name_color: HEX[t],
      icon_url: `${iconBase}/${t.toLowerCase()}.png`,
      icon_url_large: `${iconBase}/${t.toLowerCase()}-large.png`,
      tradable: true,
      marketable: true,
      tags: `rarity:${t.toLowerCase()}`,
      ...(below ? { exchange: `${c.mint![below]}x${TRADE_UP_COUNT}` } : {}),
    };
  });
  return {
    appid: appId,
    items: [
      ...marbles,
      {
        itemdefid: c.bag,
        type: 'item',
        name: 'Marble Bag',
        description: `Open it in the game for one brand-new marble. Odds: ${RARITY.map((r) => `${r.tier} ${r.odds}%`).join(', ')}.`,
        background_color: '1d1638',
        name_color: 'ffd23f',
        icon_url: `${iconBase}/bag.png`,
        icon_url_large: `${iconBase}/bag-large.png`,
        tradable: true,
        marketable: true,
        price_category: '1;VLV100',
        tags: 'type:bag',
      },
      { itemdefid: c.bagOpen, type: 'generator', name: 'Marble Bag contents', bundle: odds, exchange: `${c.bag}x1` },
      {
        itemdefid: c.dropList,
        type: 'playtimegenerator',
        name: 'Playtime drops',
        bundle: `${c.bag}x60;${c.mint!.Common}x40`,
        drop_interval: 60,
        use_drop_window: true,
        drop_window: 1440,
        drop_max_per_window: 3,
      },
    ],
  };
}
