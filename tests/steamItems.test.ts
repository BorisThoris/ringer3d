import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectibleFromId, TIERS } from '../src/core/collectible';
import { RARITY } from '../src/core/marbleGen';
import { itemConfig, itemDefs, marbleFromItem, RINGER_ITEMS, SPACEWAR_ITEMS } from '../src/steamItems';

const FILE = new URL('../steam/itemdefs.json', import.meta.url);
// The App ID is filled in on the partner site when the app exists; icons are served by the web build.
const DEFS = itemDefs(0, 'https://ringer3d.modaxxx009.workers.dev/steam-items');

describe('Steam items', () => {
  it('steam/itemdefs.json is exactly itemDefs() (UPDATE_ITEMDEFS=1 rewrites it)', () => {
    const text = JSON.stringify(DEFS, null, 2) + '\n';
    if (process.env.UPDATE_ITEMDEFS || !existsSync(FILE)) writeFileSync(FILE, text);
    expect(readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')).toBe(text);
  });

  it('the bag generator weights are the published odds, and every tier above Common trades up from five', () => {
    const gen = DEFS.items.find((i) => i.type === 'generator') as { bundle: string };
    const weights = Object.fromEntries(gen.bundle.split(';').map((e) => e.split('x').map(Number)));
    for (const r of RARITY) expect(weights[RINGER_ITEMS.mint![r.tier]!]).toBe(Math.round(r.odds * 10));
    for (const [i, t] of TIERS.entries()) {
      const d = DEFS.items.find((x) => x.itemdefid === RINGER_ITEMS.mint![t]) as { exchange?: string; marketable: boolean };
      expect(d.marketable).toBe(true);
      expect(d.exchange).toBe(i === 0 ? undefined : `${RINGER_ITEMS.mint![TIERS[i - 1]]}x5`);
    }
  });

  it('a Steam item is a collectible keyed by its item id, with its itemdef tier and tally', () => {
    const m = marbleFromItem({ itemId: '511880578116875280', def: 102, qty: 1, removed: false, props: { tally: 12 } }, SPACEWAR_ITEMS)!;
    expect(m.tier).toBe('Rare');
    expect(m.uid).toBe('s511880578116875280');
    expect(m.tally).toBe(12);
    expect(collectibleFromId(m.id)).toEqual(collectibleFromId(m.id));
    expect(collectibleFromId(m.id)!.float).toBe(m.float);
    expect(marbleFromItem({ itemId: '1', def: 9999, qty: 1, removed: false, props: {} }, SPACEWAR_ITEMS)).toBeNull();
    expect(marbleFromItem({ itemId: '1', def: 100, qty: 1, removed: true, props: {} }, SPACEWAR_ITEMS)).toBeNull();
    expect(itemConfig(480)).toBe(SPACEWAR_ITEMS);
    expect(itemConfig(123)).toBe(RINGER_ITEMS);
  });
});
