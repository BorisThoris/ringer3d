import { hashString, Rng } from './rng';

/**
 * Surface flaws: what the glass picked up when it was made, before anyone played with it
 * (wear, in collectible.ts, is what play adds on top). Every marble has its own, from its id
 * alone, with their own random stream: the generator's draws, and every marble already
 * minted, stay exactly as they were.
 *
 * - ripple: orange peel, the gentle waviness of glass rolled while still soft;
 * - seam: the shear line where the marble was cut off the hot rod, a faint ridge round it;
 * - pits: open bubbles that burst at the surface, little craters;
 * - smudge: fingerprints and hazy patches on the glass;
 * - seeds: a trail of tiny bubbles inside the glass;
 * - stone: a grain of sand that never melted, caught inside.
 *
 * One marble in FLAWLESS_ODDS came out of the furnace perfect: no flaws at all.
 */

export const FLAWLESS_ODDS = 25;

export interface SurfaceFlaws {
  flawless: boolean;
  /** Orange-peel waviness 0..1. */
  ripple: number;
  /** Shear seam strength 0 (none) .. 1. */
  seam: number;
  /** Open bubbles on the surface, 0..7. */
  pits: number;
  /** Fingerprints and haze 0..1. */
  smudge: number;
  /** Tiny bubbles in a trail inside the glass, 0..14. */
  seeds: number;
  /** An unmelted grain inside. */
  stone: boolean;
  /** Where the seam runs: the shell's turn about x and z, radians. */
  turn: [number, number];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function surfaceFlaws(id: string): SurfaceFlaws {
  const rng = new Rng(hashString(`flaws:${id}`));
  const flawless = rng.int(FLAWLESS_ODDS) === 0;
  const ripple = rng.range(0.15, 0.75);
  const seam = rng.next() < 0.7 ? rng.range(0.35, 1) : 0;
  const pits = rng.int(8);
  const smudge = rng.next() < 0.6 ? rng.range(0.15, 0.7) : 0;
  const seeds = rng.next() < 0.45 ? 5 + rng.int(10) : 0;
  const stone = rng.int(12) === 0;
  const turn: [number, number] = [r3(rng.range(-Math.PI, Math.PI)), r3(rng.range(-Math.PI, Math.PI))];
  if (flawless) return { flawless, ripple: 0, seam: 0, pits: 0, smudge: 0, seeds: 0, stone: false, turn };
  return { flawless, ripple: r3(ripple), seam: r3(seam), pits, smudge: r3(smudge), seeds, stone, turn };
}

/**
 * The flaws in words, for an inspector: "Flawless", or "seam, 3 pits, fingerprints". Opaque
 * marbles (clay, steelies) hide what is inside, so their seeds and stones go unmentioned.
 */
export function describeFlaws(f: SurfaceFlaws, opaque = false): string {
  if (f.flawless) return 'Flawless';
  const out: string[] = [];
  if (f.seam > 0) out.push(f.seam > 0.7 ? 'heavy seam' : 'seam');
  if (f.pits) out.push(f.pits === 1 ? '1 pit' : `${f.pits} pits`);
  if (f.smudge > 0) out.push('fingerprints');
  if (f.seeds && !opaque) out.push('seed bubbles');
  if (f.stone && !opaque) out.push('stone');
  out.push(f.ripple > 0.55 ? 'heavy orange peel' : 'orange peel');
  return out.join(', ');
}
