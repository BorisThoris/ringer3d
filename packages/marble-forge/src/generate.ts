import { hashString, Rng } from './rng';

/**
 * Collectible marbles, generated from a seed. A seed is the whole marble: the same seed gives
 * the same marble on every platform (the Roblox port runs a line-for-line Luau copy of this
 * file, checked against `marbleFixtures()`), so a marble can be minted, stored and traded as a
 * number. Purely cosmetic: every marble plays the same.
 *
 * The rarity tier is drawn first and limits which patterns, finishes and glow a marble can
 * have, so the odds of a tier are exactly the odds in RARITY (a shop can show them).
 * Colours come from harmony schemes on the colour wheel, tuned per pattern, so every roll
 * is pretty, and the traits multiply out to millions of distinct marbles.
 *
 * Phenomena and shape (drawn last, so they never change the traits above): a rare few marbles
 * hold a living effect inside the glass (an aurora, a fire, a black hole...), and every marble
 * carries its own interior shape (blade count, swirl turns, ribbon width, tilt, bubbles), so the
 * same seed renders the same on every renderer.
 *
 * Parity rules for the Luau copy: only `next()`, `int()` and `range()` (never `gaussian()`),
 * colours rounded to whole 0..255 channels, numbers rounded to 3 decimals.
 */

export type Pattern = 'catseye' | 'swirl' | 'solid' | 'galaxy' | 'steelie' | 'onyx' | 'opal' | 'neon' | 'onionskin' | 'clearie';
export type Finish = 'glass' | 'frosted' | 'pearl' | 'metallic' | 'glitter' | 'holo' | 'prism';
export type Tier = 'Common' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic';
export type Scheme = 'mono' | 'analogous' | 'complement' | 'split' | 'triad' | 'rainbow';
export type Effect = 'none' | 'aurora' | 'inferno' | 'void' | 'storm' | 'geode' | 'starfall';

/** The phenomena: a living effect inside the glass. Hue range (turns) of each one's colour. */
export const EFFECTS: Record<Exclude<Effect, 'none'>, { title: string; desc: string; hue: [number, number] }> = {
  aurora: { title: 'Aurora', desc: 'Northern lights drift through the glass.', hue: [0.3, 0.5] },
  inferno: { title: 'Inferno', desc: 'A fire that never goes out.', hue: [0.0, 0.08] },
  void: { title: 'Void', desc: 'A black hole wrapped in its own burning disc.', hue: [0.72, 0.85] },
  storm: { title: 'Storm', desc: 'A thundercloud, and lightning inside it.', hue: [0.52, 0.62] },
  geode: { title: 'Geode', desc: 'Crystals grow inward from the shell.', hue: [0, 1] },
  starfall: { title: 'Starfall', desc: 'Stars orbit a tiny nebula.', hue: [0.55, 0.95] },
};
export const EFFECT_IDS = Object.keys(EFFECTS) as Exclude<Effect, 'none'>[];

/** Chance (percent) that a marble of each tier holds a phenomenon. */
export const EFFECT_ODDS: Record<Tier, number> = { Common: 0, Rare: 1.5, Epic: 5, Legendary: 15, Mythic: 40 };

/** The interior's own shape, so a marble looks the same in every renderer and every slot. */
export interface MarbleShape {
  /** Cat's-eye blades, 3..5. */
  blades: number;
  /** Swirl turns, 0.6..1.4. */
  turns: number;
  /** Ribbon width factor, 0.7..1.3. */
  width: number;
  /** Interior tilt, -0.4..0.4 rad. */
  tilt: number;
  /** Air bubbles in the glass, 1..6. */
  bubbles: number;
}

export interface GeneratedMarble {
  seed: number;
  /** Stable id: "g" + seed. */
  id: string;
  name: string;
  tier: Tier;
  pattern: Pattern;
  finish: Finish;
  scheme: Scheme;
  /** Glass / body colour, then the two feature colours, as #rrggbb. */
  base: string;
  accent: string;
  accent2: string;
  /** 0 opaque .. 1 clear glass. */
  clarity: number;
  /** Inner glow 0..1. */
  glow: number;
  /** Glitter flecks 0..1. */
  sparkle: number;
  /** The brightest colour, for the interface. */
  ui: string;
  /** A phenomenon inside the glass, and its colour. */
  effect: Effect;
  effectColor: string;
  shape: MarbleShape;
}

/** Tier odds in percent (a Marble Bag), and what each tier may roll. */
export const RARITY: { tier: Tier; odds: number; patterns: Pattern[]; finishes: Finish[]; glow: [number, number]; sparkle: [number, number]; schemes: Scheme[] }[] = [
  { tier: 'Common', odds: 55, patterns: ['solid', 'swirl', 'catseye', 'clearie'], finishes: ['glass', 'frosted'], glow: [0, 0.15], sparkle: [0, 0], schemes: ['mono', 'analogous', 'complement'] },
  { tier: 'Rare', odds: 28, patterns: ['swirl', 'catseye', 'onionskin', 'opal', 'steelie', 'clearie'], finishes: ['glass', 'frosted', 'pearl', 'metallic'], glow: [0.05, 0.3], sparkle: [0, 0.2], schemes: ['analogous', 'complement', 'split'] },
  { tier: 'Epic', odds: 12, patterns: ['swirl', 'catseye', 'onionskin', 'opal', 'neon', 'galaxy'], finishes: ['glass', 'pearl', 'metallic', 'glitter'], glow: [0.3, 0.7], sparkle: [0.2, 0.5], schemes: ['complement', 'split', 'triad'] },
  { tier: 'Legendary', odds: 4.5, patterns: ['galaxy', 'neon', 'onyx', 'opal', 'onionskin'], finishes: ['glass', 'glitter', 'holo'], glow: [0.6, 1], sparkle: [0.4, 0.8], schemes: ['split', 'triad', 'rainbow'] },
  { tier: 'Mythic', odds: 0.5, patterns: ['galaxy', 'neon', 'onyx'], finishes: ['holo', 'prism'], glow: [1, 1], sparkle: [0.8, 1], schemes: ['rainbow', 'triad'] },
];

export const HUE_NAMES = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink'] as const;
export const MARBLE_WORDS = {
  hue: {
    red: ['Ruby', 'Cherry', 'Crimson', 'Berry', 'Scarlet', 'Poppy', 'Garnet', 'Ember'],
    orange: ['Peach', 'Tangerine', 'Amber', 'Papaya', 'Apricot', 'Marigold', 'Mango', 'Copper'],
    yellow: ['Lemon', 'Sunny', 'Golden', 'Honey', 'Banana', 'Butter', 'Saffron', 'Daisy'],
    lime: ['Lime', 'Mint', 'Pistachio', 'Kiwi', 'Sage', 'Sprout', 'Avocado', 'Melon'],
    green: ['Emerald', 'Jade', 'Fern', 'Forest', 'Moss', 'Clover', 'Leafy', 'Cactus'],
    teal: ['Teal', 'Lagoon', 'Seafoam', 'Peacock', 'Turquoise', 'Marine', 'Reef', 'Tidal'],
    cyan: ['Cyan', 'Icy', 'Glacier', 'Frosty', 'Arctic', 'Aqua', 'Splash', 'Breeze'],
    blue: ['Azure', 'Sapphire', 'Ocean', 'Sky', 'Cobalt', 'Navy', 'Denim', 'Bluebell'],
    indigo: ['Indigo', 'Twilight', 'Starry', 'Midnight', 'Dusk', 'Velvet', 'Moonlit', 'Deepsea'],
    purple: ['Amethyst', 'Lavender', 'Orchid', 'Plum', 'Grape', 'Lilac', 'Violet', 'Mauve'],
    pink: ['Pink', 'Fuchsia', 'Magenta', 'Rosy', 'Flamingo', 'Bubblegum', 'Candy', 'Blossom'],
  } as Record<(typeof HUE_NAMES)[number], string[]>,
  pattern: {
    catseye: ['Eye', 'Glint', 'Gleam', 'Glimmer', 'Wink', 'Flash'],
    swirl: ['Whirl', 'Eddy', 'Swirl', 'Twist', 'Spiral', 'Curl'],
    solid: ['Pebble', 'Drop', 'Bead', 'Gumdrop', 'Button', 'Pip'],
    galaxy: ['Nebula', 'Comet', 'Star', 'Cosmos', 'Orbit', 'Quasar'],
    steelie: ['Steelie', 'Chrome', 'Bearing', 'Alloy', 'Mirror', 'Rivet'],
    onyx: ['Onyx', 'Magma', 'Ember', 'Obsidian', 'Lava', 'Basalt'],
    opal: ['Opal', 'Pearl', 'Luster', 'Sheen', 'Moonstone', 'Shimmer'],
    neon: ['Neon', 'Laser', 'Volt', 'Pulse', 'Glowstick', 'Spark'],
    onionskin: ['Onion', 'Ribbon', 'Layer', 'Petal', 'Streamer', 'Banner'],
    clearie: ['Clearie', 'Bubble', 'Crystal', 'Lens', 'Droplet', 'Dew'],
  } as Record<Pattern, string[]>,
  finish: {
    glass: [],
    frosted: [],
    pearl: [],
    metallic: [],
    glitter: ['Glitter', 'Sparkle', 'Twinkle', 'Starlit'],
    holo: ['Holo', 'Shimmer', 'Aurora', 'Radiant'],
    prism: ['Prism', 'Rainbow', 'Spectral', 'Celestial'],
  } as Record<Finish, string[]>,
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pick = <T,>(rng: Rng, xs: readonly T[]): T => xs[rng.int(xs.length)];

/** HSL (h in turns 0..1, s and l 0..1) to #rrggbb. */
export function hsl(h: number, s: number, l: number): string {
  h = h - Math.floor(h);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const h6 = h * 6;
  const x = c * (1 - Math.abs(h6 - 2 * Math.floor(h6 / 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(h * 6);
  const [r, g, b] = seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x] : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Hue offsets (turns) of the two feature colours from the base hue, per scheme. */
function schemeHues(scheme: Scheme, rng: Rng): [number, number] {
  switch (scheme) {
    case 'mono':
      return [0, rng.range(-0.03, 0.03)];
    case 'analogous':
      return [rng.range(0.06, 0.1), -rng.range(0.06, 0.1)];
    case 'complement':
      return [0.5, rng.range(0.04, 0.08)];
    case 'split':
      return [0.42, 0.58];
    case 'triad':
      return [1 / 3, 2 / 3];
    case 'rainbow':
      return [rng.range(0.28, 0.38), rng.range(0.6, 0.72)];
  }
}

/** Exact chance (percent) that a Marble Bag holds a phenomenon: tier odds, see-through patterns only. */
export function phenomenonOdds(): number {
  return RARITY.reduce((a, r) => a + (r.odds * EFFECT_ODDS[r.tier] * r.patterns.filter((p) => p !== 'solid' && p !== 'steelie').length) / r.patterns.length / 100, 0);
}

/** The tier a roll of `t` (0..100) lands in. */
export function tierFor(t: number): Tier {
  let acc = 0;
  for (const r of RARITY) {
    acc += r.odds;
    if (t < acc) return r.tier;
  }
  return 'Common';
}

/**
 * The marble for a seed. `tier` forces the tier (a Limited drop, a tower reward); otherwise
 * the seed rolls it with the RARITY odds.
 */
export function generateMarble(seed: number, tier?: Tier): GeneratedMarble {
  seed = seed >>> 0;
  const rng = new Rng(hashString(`marble:${seed}`));
  const roll = rng.next() * 100;
  const t = tier ?? tierFor(roll);
  const rule = RARITY.find((r) => r.tier === t)!;
  const pattern = pick(rng, rule.patterns);
  const finish = pick(rng, rule.finishes);
  const scheme = pick(rng, rule.schemes);

  const hue = rng.next();
  const [o1, o2] = schemeHues(scheme, rng);
  // Each pattern has its own feel: dark deep bodies for galaxies, neon and onyx; pale tinted
  // glass for catseyes, swirls and clearies; bright clay for solids.
  const dark = pattern === 'galaxy' || pattern === 'neon' || pattern === 'onyx';
  const opaque = pattern === 'solid' || pattern === 'steelie';
  const baseS = pattern === 'steelie' ? rng.range(0.05, 0.25) : dark ? rng.range(0.55, 0.85) : rng.range(0.55, 0.95);
  const baseL = pattern === 'steelie' ? rng.range(0.62, 0.8) : dark ? rng.range(0.07, 0.16) : opaque ? rng.range(0.45, 0.62) : rng.range(0.72, 0.9);
  const base = hsl(hue, baseS, baseL);
  const accent = hsl(hue + o1, rng.range(0.8, 1), rng.range(0.48, 0.6));
  const accent2 = hsl(hue + o2, rng.range(0.7, 1), dark ? rng.range(0.6, 0.78) : rng.range(0.55, 0.85));
  const clarity = opaque ? 0 : dark ? rng.range(0.15, 0.45) : pattern === 'clearie' ? rng.range(0.85, 0.95) : rng.range(0.55, 0.9);
  const glow = rng.range(rule.glow[0], rule.glow[1]);
  const sparkle = finish === 'glitter' ? Math.max(0.5, rng.range(rule.sparkle[0], rule.sparkle[1])) : rng.range(rule.sparkle[0], rule.sparkle[1]);

  const h1 = hue + o1 - Math.floor(hue + o1);
  const hueName = HUE_NAMES[Math.floor(h1 * HUE_NAMES.length) % HUE_NAMES.length];
  const words = [pick(rng, MARBLE_WORDS.hue[hueName]), pick(rng, MARBLE_WORDS.pattern[pattern])];
  const fw = MARBLE_WORDS.finish[finish];
  if (fw.length) words.unshift(pick(rng, fw));

  // Drawn last: everything above stays exactly as it was before phenomena existed.
  const shape: MarbleShape = {
    blades: 3 + rng.int(3),
    turns: r3(rng.range(0.6, 1.4)),
    width: r3(rng.range(0.7, 1.3)),
    tilt: r3(rng.range(-0.4, 0.4)),
    bubbles: 1 + rng.int(6),
  };
  const fxRoll = rng.next() * 100;
  const fxPick = pick(rng, EFFECT_IDS);
  const fxHue = rng.next();
  const fxLight = rng.range(0.55, 0.68);
  // Phenomena live inside see-through glass: solid clay and steelies never hold one.
  const effect: Effect = fxRoll < EFFECT_ODDS[t] && !opaque ? fxPick : 'none';
  const range = EFFECTS[fxPick].hue;
  const effectColor = hsl(range[0] + (range[1] - range[0]) * fxHue, 1, fxLight);
  if (effect !== 'none') words.unshift(EFFECTS[effect].title);
  return {
    seed,
    id: `g${seed}`,
    name: words.join(' '),
    tier: t,
    pattern,
    finish,
    scheme,
    base,
    accent,
    accent2,
    clarity: r3(clarity),
    glow: r3(glow),
    sparkle: r3(sparkle),
    ui: accent,
    effect,
    effectColor,
    shape,
  };
}

/** The look the renderers draw (game/marbles.ts MarbleLook, plus finish and sparkle). */
export function marbleLook(g: GeneratedMarble) {
  return { id: g.id, name: g.name, core: g.pattern, base: g.base, accent: g.accent, accent2: g.accent2, clarity: g.clarity, glow: g.glow, ui: g.ui, finish: g.finish, sparkle: g.sparkle, effect: g.effect, effectColor: g.effectColor, shape: g.shape };
}

/** Reference marbles for the Luau copy's parity check. */
export function marbleFixtures(count = 40): GeneratedMarble[] {
  const out: GeneratedMarble[] = [];
  for (let i = 0; i < count; i++) out.push(generateMarble(1 + i * 7919));
  for (const tier of RARITY.map((r) => r.tier)) out.push(generateMarble(424242, tier));
  return out;
}
