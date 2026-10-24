/**
 * World units: 1 unit ≈ 4 cm. Everything is scaled up from real marbles so the physics
 * engine works with comfortably sized bodies.
 *
 * Nothing in /core may touch the DOM, Math.random or wall-clock time: the simulation must
 * produce bit-identical results on every peer given the same seed and the same shots.
 */
export const WORLD = {
  /** Radius of the chalk ring. */
  ringRadius: 5.5,
  /** Radius of the small target marbles ("mibs"). */
  targetRadius: 0.16,
  /** Radius of the shooter marble ("taw"). */
  shooterRadius: 0.21,
  /** Distance between neighbouring marbles in the starting cross. */
  targetSpacing: 0.5,
  /** Invisible kerb that keeps flying marbles in the play area. */
  boundaryRadius: 13,
  gravity: -30,
  /** Fixed physics step. Never derived from frame time. */
  dt: 1 / 120,
  /** Shooter speed at 100% power. */
  maxShotSpeed: 27,
  /** Hard cap on one shot's simulation time, in steps. */
  maxShotSteps: 120 * 16,
  /** A body counts as at rest below these speeds. */
  restLinear: 0.035,
  restAngular: 0.25,
  /** Consecutive resting steps needed before a shot is resolved. */
  restSteps: 24,
} as const;

/** Number of target marbles in classic Ringer. */
export const TARGET_COUNT = 13;

/** How precisely shot parameters travel over the network (and are applied locally). */
export const QUANT = {
  angle: 1e-4,
  power: 1e-4,
  spin: 1e-3,
} as const;
