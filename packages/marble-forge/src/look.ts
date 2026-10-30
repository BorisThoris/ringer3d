import type { Effect, MarbleShape } from './generate';

/** What a renderer needs to draw a marble. Purely cosmetic. */
export type MarbleCore = 'catseye' | 'swirl' | 'solid' | 'galaxy' | 'steelie' | 'onyx' | 'opal' | 'neon' | 'onionskin' | 'clearie';

export interface MarbleLook {
  id: string;
  name: string;
  core: MarbleCore;
  /** Glass/body colour. */
  base: string;
  /** Inner feature colours. */
  accent: string;
  accent2: string;
  /** 0 = opaque, 1 = clear glass. */
  clarity: number;
  /** Emissive glow for inner features (0..1). */
  glow: number;
  /** A vivid colour that stands for this marble in the interface and the in-match cues. */
  ui?: string;
  /** Generated collectibles (core/marbleGen.ts): the glass finish and glitter flecks 0..1. */
  finish?: 'glass' | 'frosted' | 'pearl' | 'metallic' | 'glitter' | 'holo' | 'prism';
  sparkle?: number;
  /** Collectibles (core/collectible.ts): wear float 0..1 (scratches, scuffs, chips) and the Shiny sheen. */
  wear?: number;
  shiny?: boolean;
  /** Surface flaws from the furnace (flaws.ts): on unless false. */
  flaws?: boolean;
  /** Generated marbles: a phenomenon inside the glass, its colour, and the interior's shape. */
  effect?: Effect;
  effectColor?: string;
  shape?: MarbleShape;
}

