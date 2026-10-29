import { mintCollectible, nextTier, TIERS, TRADE_UP_COUNT, type Collectible } from './core/collectible';
import { RARITY, type Tier } from './core/marbleGen';
import { createStore } from './game/store';
import { steam, type SteamItem } from './steam';

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

export interface SteamMarble extends Collectible {
  itemId: string;
  def: number;
  tally: number;
}

export interface SteamBag {
  itemId: string;
}

/** A Steam item as a marble, or null if the item isn't one. */
export function marbleFromItem(item: SteamItem, cfg: SteamItemConfig): SteamMarble | null {
  const tier = cfg.tiers[item.def];
  if (!tier || item.removed) return null;
  const tally = Number(item.props.tally ?? 0);
  return { ...mintCollectible(`s${item.itemId}`, tier), itemId: item.itemId, def: item.def, tally: Number.isFinite(tally) ? tally : 0 };
}

const cfg = () => itemConfig(steam?.appId);

/** What the player holds on Steam: marbles and unopened bags. Empty off Steam. */
export const steamHeld = createStore<{ marbles: SteamMarble[]; bags: SteamBag[]; loaded: boolean; error: string | null }>({ marbles: [], bags: [], loaded: false, error: null });

function absorb(items: SteamItem[]) {
  const c = cfg();
  return {
    marbles: items.map((i) => marbleFromItem(i, c)).filter((m): m is SteamMarble => !!m),
    bags: items.filter((i) => i.def === c.bag && !i.removed).map((i) => ({ itemId: i.itemId })),
  };
}

export async function syncSteamItems(): Promise<void> {
  if (!steam) return;
  try {
    const { marbles, bags } = absorb(await steam.invAll());
    steamHeld.set({ marbles, bags, loaded: true, error: null });
  } catch (e) {
    steamHeld.set({ loaded: true, error: (e as Error).message });
  }
}

/** Ask Steam for a playtime drop; returns what dropped (often nothing: Steam paces drops). */
export async function steamDrop(): Promise<SteamMarble[]> {
  if (!steam) return [];
  try {
    const got = absorb(await steam.invDrop(cfg().dropList));
    if (got.marbles.length || got.bags.length) await syncSteamItems();
    return got.marbles;
  } catch {
    return [];
  }
}

export type SteamResult = { ok: true; marble: SteamMarble } | { ok: false; why: string };

/** Five Steam marbles of one tier into one of the next: Steam checks the recipe and mints it. */
export async function steamTradeUp(itemIds: string[]): Promise<SteamResult> {
  const c = cfg();
  const picked = itemIds.map((id) => steamHeld.get().marbles.find((m) => m.itemId === id));
  if (picked.length !== TRADE_UP_COUNT || picked.some((m) => !m)) return { ok: false, why: `Pick ${TRADE_UP_COUNT} Steam marbles.` };
  const tier = picked[0]!.tier;
  if (picked.some((m) => m!.tier !== tier)) return { ok: false, why: 'They all need to be the same rarity.' };
  const up = nextTier(tier);
  const target = up && c.mint?.[up];
  if (!target) return { ok: false, why: up ? 'Trade-ups open with the Steam release.' : 'Mythic is the top.' };
  try {
    const got = absorb(await steam!.invExchange([target], itemIds));
    await syncSteamItems();
    return got.marbles[0] ? { ok: true, marble: got.marbles[0] } : { ok: false, why: 'Steam made nothing.' };
  } catch (e) {
    return { ok: false, why: (e as Error).message };
  }
}

/** Open a Marble Bag held on Steam: Steam's generator picks the tier with the published odds. */
export async function steamOpenBag(bagItemId: string): Promise<SteamResult> {
  const c = cfg();
  if (!steam || !c.bagOpen) return { ok: false, why: 'Steam bags open with the Steam release.' };
  try {
    const got = absorb(await steam.invExchange([c.bagOpen], [bagItemId]));
    await syncSteamItems();
    return got.marbles[0] ? { ok: true, marble: got.marbles[0] } : { ok: false, why: 'Steam made nothing.' };
  } catch (e) {
    return { ok: false, why: (e as Error).message };
  }
}

/** Steam's checkout overlay for a Marble Bag from the item store. */
export async function steamBuyBag(): Promise<boolean> {
  const c = cfg();
  if (!steam || !c.bag) return false;
  await steam.invBuy([c.bag]);
  return true;
}

/** Add a match's captures to a Steam marble's tally (a dynamic property on the item). */
export async function steamAddTally(marbleId: string, captures: number): Promise<void> {
  const m = steamHeld.get().marbles.find((x) => x.id === marbleId);
  if (!steam || !m || captures <= 0) return;
  try {
    await steam.invSetProps([{ itemId: m.itemId, name: 'tally', value: m.tally + captures }]);
    await syncSteamItems();
  } catch {
    /* tallies are a nicety; never fail a match over one */
  }
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
