import { generateMarble, RARITY, type Finish, type GeneratedMarble, type Pattern, type Tier } from './marbleGen';
import { hashString, Rng } from './rng';

/**
 * Collectible marbles: every one is a unique instance. Its look, wear float, pattern number and
 * Shiny roll all follow from its instance id (uid) alone, so anyone who sees the id sees the
 * same marble and nobody can choose what they get. On Steam the uid is the Steam inventory
 * item id ("s" + itemid), so a marble keeps its float and pattern through trades and the
 * Community Market; marbles from coin-bought bags have a local uid ("L" + 16 hex digits).
 *
 * A marble's id (what peers, replays and saves carry) is "c" + tier letter + "-" + uid, e.g.
 * "cR-s1234567890". Older saves hold "g" + seed ids; those still read, as seeded collectibles.
 */

export const TIERS: Tier[] = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'];
const LETTER: Record<Tier, string> = { Common: 'C', Rare: 'R', Epic: 'E', Legendary: 'L', Mythic: 'M' };
const BY_LETTER = Object.fromEntries(Object.entries(LETTER).map(([t, l]) => [l, t])) as Record<string, Tier>;

/**
 * Wear grades by float, like a marble that has lived in a pocket: weights are the share of
 * marbles minted in each band (Mint is the rare one). Lower float = cleaner glass.
 */
export const WEARS = [
  { name: 'Mint', short: 'MT', min: 0, max: 0.07, weight: 3 },
  { name: 'Polished', short: 'PL', min: 0.07, max: 0.15, weight: 24 },
  { name: 'Played', short: 'PY', min: 0.15, max: 0.38, weight: 33 },
  { name: 'Scuffed', short: 'SC', min: 0.38, max: 0.45, weight: 24 },
  { name: 'Chipped', short: 'CH', min: 0.45, max: 1, weight: 16 },
] as const;
export type Wear = (typeof WEARS)[number]['name'];

/** One in this many marbles is Shiny (a holographic sheen and extra glitter, any tier). */
export const SHINY_ODDS = 50;

export interface Collectible {
  id: string;
  uid: string;
  tier: Tier;
  /** 0 (flawless) .. 1 (battered), 6 decimals. */
  float: number;
  wear: Wear;
  /** 0..999: which variation of its look this is. */
  pattern: number;
  shiny: boolean;
  /** Notable things a collector looks for, best first. */
  traits: string[];
  marble: GeneratedMarble;
}

export function collectibleId(tier: Tier, uid: string): string {
  return `c${LETTER[tier]}-${uid}`;
}

const ID_RE = /^c([CRELM])-([A-Za-z0-9]{1,40})$/;
export function isCollectibleId(id: string): boolean {
  return ID_RE.test(id) || /^g\d+$/.test(id);
}

export function wearFor(float: number): Wear {
  return (WEARS.find((w) => float < w.max) ?? WEARS[WEARS.length - 1]).name;
}

/** The marble an instance id stands for. Pure: the same uid always gives the same marble. */
export function mintCollectible(uid: string, tier?: Tier): Collectible {
  const legacy = /^g\d+$/.test(uid);
  const seed = legacy ? Number(uid.slice(1)) : hashString(`look:${uid}`);
  const base = generateMarble(seed, tier);
  const t = base.tier;
  const rng = new Rng(hashString(`collectible:${uid}`));

  // Float: pick a wear band by its weight, then a point inside it.
  let roll = rng.next() * WEARS.reduce((a, w) => a + w.weight, 0);
  let band: (typeof WEARS)[number] = WEARS[WEARS.length - 1];
  for (const w of WEARS) {
    if ((roll -= w.weight) < 0) {
      band = w;
      break;
    }
  }
  const float = Math.round((band.min + rng.next() * (band.max - band.min)) * 1e6) / 1e6;
  const pattern = rng.int(1000);
  const shiny = rng.int(SHINY_ODDS) === 0;

  const traits: string[] = [];
  if (shiny) traits.push('Shiny');
  if (float < 0.01) traits.push('Pristine');
  if (float > 0.99) traits.push('Rock bottom');
  if (pattern === 7 || pattern === 77 || pattern === 777) traits.push('Lucky 7s');
  if (pattern === 0) traits.push('Pattern zero');
  if (pattern === 999) traits.push('Last pattern');

  const id = legacy ? uid : collectibleId(t, uid);
  const marble: GeneratedMarble = { ...base, id, name: shiny ? `Shiny ${base.name}` : base.name };
  if (shiny) {
    marble.sparkle = Math.max(marble.sparkle, 0.7);
    if (marble.finish === 'glass' || marble.finish === 'frosted') marble.finish = 'holo';
  }
  return { id, uid, tier: t, float, wear: wearFor(float), pattern, shiny, traits, marble };
}

/** A collectible from its marble id, or null for named marbles and anything malformed. */
export function collectibleFromId(id: string): Collectible | null {
  if (/^g\d+$/.test(id)) return mintCollectible(id);
  const m = ID_RE.exec(id);
  return m ? mintCollectible(m[2], BY_LETTER[m[1]]) : null;
}

/** A fresh local uid from 64 random bits (two 32-bit words). */
export function localUid(a: number, b: number): string {
  return `L${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

/** Next tier up, for trade-ups (five of one tier make one of the next). */
export const TRADE_UP_COUNT = 5;
export function nextTier(t: Tier): Tier | null {
  const i = TIERS.indexOf(t);
  return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : null;
}

// ---- The Marble Book: sets to complete --------------------------------------------------

export interface BookSet {
  id: string;
  name: string;
  /** What to own one of each. */
  needs: string[];
  /** Coins paid once, when the set is complete. */
  reward: number;
  have: (c: Collectible) => string | null;
}

const ALL_PATTERNS = [...new Set(RARITY.flatMap((r) => r.patterns))] as Pattern[];
const ALL_FINISHES = [...new Set(RARITY.flatMap((r) => r.finishes))] as Finish[];

export const BOOK: BookSet[] = [
  { id: 'patterns', name: 'Every pattern', needs: ALL_PATTERNS, reward: 1500, have: (c) => c.marble.pattern },
  { id: 'finishes', name: 'Every finish', needs: ALL_FINISHES, reward: 1200, have: (c) => c.marble.finish },
  { id: 'tiers', name: 'Every rarity', needs: TIERS, reward: 2500, have: (c) => c.tier },
  { id: 'wears', name: 'Every wear', needs: WEARS.map((w) => w.name), reward: 800, have: (c) => c.wear },
  { id: 'shiny', name: 'A Shiny', needs: ['Shiny'], reward: 1000, have: (c) => (c.shiny ? 'Shiny' : null) },
];

/** How far along each set is, given the collection. */
export function bookProgress(owned: Collectible[]): { set: BookSet; got: string[]; done: boolean }[] {
  return BOOK.map((set) => {
    const got = set.needs.filter((n) => owned.some((c) => set.have(c) === n));
    return { set, got, done: got.length === set.needs.length };
  });
}
