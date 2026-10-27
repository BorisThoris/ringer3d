/**
 * Bots play FAIR:
 *  - they only see what a human sees (marble positions on the table),
 *  - they produce the same Shot a human produces (place angle, aim, power, spin),
 *  - and their hand shakes: every intended shot is perturbed by human-like aim and power error.
 * Difficulty only changes how carefully they think and how steady their hand is.
 */
export interface BotProfile {
  id: string;
  label: string;
  /** Std-dev of aim error in degrees. A steady human thumb is ~0.6°–1.5°. */
  aimErrorDeg: number;
  /** Std-dev of power error as a fraction of intended power. */
  powerError: number;
  /** How many candidate shots to imagine before choosing. */
  candidates: number;
  /** Considers backspin "stick" shots to keep the shooter in the ring. */
  usesSpin: boolean;
  /** Weight on leaving the shooter well placed for the next shot. */
  positional: number;
  /** Chance per shot of a "brain fade": picks a random decent candidate instead of the best. */
  blunder: number;
  /** Cosmetic thinking time (ms) so bots feel like opponents rather than machines. */
  thinkMs: [number, number];
}

export const BOT_PROFILES: Record<string, BotProfile> = {
  rookie: { id: 'rookie', label: 'Rookie', aimErrorDeg: 10, powerError: 0.26, candidates: 6, usesSpin: false, positional: 0, blunder: 0.55, thinkMs: [700, 1500] },
  novice: { id: 'novice', label: 'Novice', aimErrorDeg: 6.5, powerError: 0.17, candidates: 11, usesSpin: false, positional: 0.08, blunder: 0.38, thinkMs: [700, 1500] },
  casual: { id: 'casual', label: 'Casual', aimErrorDeg: 4.2, powerError: 0.11, candidates: 18, usesSpin: false, positional: 0.2, blunder: 0.2, thinkMs: [700, 1400] },
  regular: { id: 'regular', label: 'Regular', aimErrorDeg: 3.4, powerError: 0.095, candidates: 24, usesSpin: true, positional: 0.35, blunder: 0.15, thinkMs: [750, 1500] },
  skilled: { id: 'skilled', label: 'Skilled', aimErrorDeg: 2.8, powerError: 0.08, candidates: 30, usesSpin: true, positional: 0.5, blunder: 0.1, thinkMs: [800, 1600] },
  expert: { id: 'expert', label: 'Expert', aimErrorDeg: 1.8, powerError: 0.05, candidates: 56, usesSpin: true, positional: 0.85, blunder: 0.04, thinkMs: [900, 1700] },
  master: { id: 'master', label: 'Master', aimErrorDeg: 1.2, powerError: 0.035, candidates: 88, usesSpin: true, positional: 1.05, blunder: 0.015, thinkMs: [1000, 1900] },
  legend: { id: 'legend', label: 'Legend', aimErrorDeg: 0.8, powerError: 0.022, candidates: 128, usesSpin: true, positional: 1.25, blunder: 0.0, thinkMs: [1100, 2000] },
};
