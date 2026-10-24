/**
 * Bots.
 *
 * Fairness contract:
 * - A bot sees only what a player sees: marble positions, the ring, the
 *   surface it is playing on. It never runs the physics ahead to test a shot.
 * - It answers with the same ShotInput a human's flick produces, under the
 *   same bounds (power 0..1, spin -1..1, start on the ring line or the rest spot).
 * - Its plan is geometry (ghost-ball aiming, a rolling-distance estimate), and
 *   every shot then gets execution noise on aim and power, scaled by profile.
 *   Even the hardest bot misses a long thin cut sometimes.
 */
import { distance } from '../core/rules';
import type { RingerState } from '../core/rules';
import type { ShotInput, Vec2 } from '../core/types';
import { powerToArrive, restDistance, rollTable, speedToTravel } from '../sim/calibration';
import type { Surface } from '../sim/physics';

export interface BotProfile {
  id: string;
  /** 1-sigma aim error, radians. 0.004 is a steady hand; 0.03 is a kid in a hurry. */
  aimNoise: number;
  /** 1-sigma power error, fraction of full power. */
  powerNoise: number;
  /** 0..1: chance of taking the best-rated plan rather than a random one of the top few. */
  judgement: number;
  /** Bias toward hard shots (+) or soft, stay-in-the-ring shots (-), -1..1. */
  aggression: number;
  /** Uses backspin to park the shooter after contact. */
  usesSpin: boolean;
}

export const BOT_PROFILES: Record<string, BotProfile> = {
  rookie: { id: 'rookie', aimNoise: 0.035, powerNoise: 0.12, judgement: 0.3, aggression: 0.3, usesSpin: false },
  regular: { id: 'regular', aimNoise: 0.018, powerNoise: 0.07, judgement: 0.6, aggression: 0, usesSpin: false },
  sharp: { id: 'sharp', aimNoise: 0.009, powerNoise: 0.045, judgement: 0.85, aggression: -0.2, usesSpin: true },
  master: { id: 'master', aimNoise: 0.005, powerNoise: 0.03, judgement: 0.95, aggression: -0.4, usesSpin: true },
};

export type Rng = () => number;

/** Seeded PRNG (mulberry32) so a bot's choices can be replayed. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: Rng): number {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export interface ShotPlan {
  shot: ShotInput;
  target: string;
  score: number;
  /** For the HUD/debug overlay: where the bot means to make contact. */
  ghost: Vec2;
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, z: a.z * k });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.z * b.z;
const norm = (a: Vec2): Vec2 => {
  const d = Math.hypot(a.x, a.z) || 1;
  return { x: a.x / d, z: a.z / d };
};

/** Shortest distance from point p to segment ab. */
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return distance(p, add(a, scale(ab, t)));
}

/** Distance from p along unit u until it crosses the circle of radius R. */
function distToExit(p: Vec2, u: Vec2, R: number): number {
  const b = dot(p, u);
  return -b + Math.sqrt(Math.max(0, b * b - dot(p, p) + R * R));
}

/** Every shot the bot considers, best first. Deterministic: no noise here. */
export function planShots(state: RingerState, surface: Surface, profile: BotProfile): ShotPlan[] {
  const { config } = state;
  const R = config.ringRadius;
  const contact = config.shooterRadius + config.targetRadius;
  const a = surface.rollingDecel;
  const table = rollTable(surface, config);
  // Shooter is heavier than a target; elastic transfer (e = 0.88) along the line of centres.
  const ms = config.shooterRadius ** 3;
  const mt = config.targetRadius ** 3;
  const transfer = (1.88 * ms) / (ms + mt);

  const starts: Vec2[] =
    state.shooterStart.kind === 'spot'
      ? [state.shooterStart.pos]
      : Array.from({ length: 72 }, (_, i) => ({ x: Math.cos((i / 72) * 2 * Math.PI) * R, z: Math.sin((i / 72) * 2 * Math.PI) * R }));

  const targets = Object.entries(state.targets);
  const plans: ShotPlan[] = [];
  for (const [id, T] of targets) {
    for (const S of starts) {
      const straight = norm(sub(T, S));
      const radial = Math.hypot(T.x, T.z) > 0.5 ? norm(T) : straight;
      for (const u of [straight, radial]) {
        const ghost = sub(T, scale(u, contact));
        const aimVec = sub(ghost, S);
        const travel = Math.hypot(aimVec.x, aimVec.z);
        if (travel < 0.5) continue;
        const aim = norm(aimVec);
        const cos = dot(aim, u);
        if (cos < 0.35) continue; // thinner than ~70 degrees is a fluke, not a plan

        // Shooter path must not clip another target before the ghost point.
        const blocked = targets.some(([oid, O]) => oid !== id && segDist(O, S, ghost) < contact + 0.4);
        if (blocked) continue;
        // Target's path out: other marbles in the way make it a combination shot.
        const exit = distToExit(T, u, R) + config.targetRadius + 10;
        const crowded = targets.filter(([oid, O]) => oid !== id && segDist(O, T, add(T, scale(u, exit))) < config.targetRadius * 2).length;

        const vTarget = speedToTravel(table, exit);
        if (vTarget === null) continue;
        // Measured transfer runs below the ideal elastic figure (sliding contact, glass friction).
        const vContact = (vTarget * 1.3) / (transfer * cos);
        // Backspin parks the shooter but bleeds speed on the way; only worth it on short shots.
        const spin = profile.usesSpin && travel < R * 0.9 ? -0.9 : 0;
        const power = powerToArrive(table, spin, travel, vContact);
        if (power === null) continue;

        // After the hit the heavy shooter follows through along the aim line:
        // full hits keep about a third of the speed, thin cuts most of it.
        const follow = vContact * (cos * (ms - 0.88 * mt) / (ms + mt) + (1 - cos * cos));
        const followDist = (follow * follow) / (2 * a) * (spin < 0 ? 0.2 : 0.8);
        const rest = add(ghost, scale(aim, followDist));
        const staysIn = Math.hypot(rest.x, rest.z) < R - 3;

        const thinness = 1 - cos; // 0 = full hit
        const score =
          1 +
          (staysIn ? 0.7 : 0) -
          thinness * 1.4 -
          Math.max(0, power - 0.85) * 2 -
          crowded * 0.35 -
          travel / (R * 6) +
          profile.aggression * (power - 0.5) * 0.4;
        plans.push({
          shot: { from: S, yaw: Math.atan2(aim.z, aim.x), power: Math.min(1, Math.max(0.02, power)), spin, english: 0 },
          target: id,
          score,
          ghost,
        });
      }
    }
  }
  plans.sort((p, q) => q.score - p.score);
  return plans;
}

/** Choose and execute a shot: pick a plan by judgement, then apply hand noise. */
export function chooseShot(state: RingerState, surface: Surface, profile: BotProfile, rng: Rng): ShotPlan {
  const plans = planShots(state, surface, profile);
  let plan: ShotPlan;
  if (plans.length === 0) {
    plan = fallbackPlan(state);
  } else if (rng() < profile.judgement) {
    plan = plans[0];
  } else {
    plan = plans[Math.floor(rng() * Math.min(plans.length, 6))];
  }
  const shot: ShotInput = {
    ...plan.shot,
    yaw: plan.shot.yaw + gauss(rng) * profile.aimNoise,
    power: Math.min(1, Math.max(0, plan.shot.power + gauss(rng) * profile.powerNoise)),
  };
  return { ...plan, shot };
}

/** Nothing clean: blast straight at the nearest marble. */
function fallbackPlan(state: RingerState): ShotPlan {
  const { config } = state;
  const entries = Object.entries(state.targets);
  const S =
    state.shooterStart.kind === 'spot'
      ? state.shooterStart.pos
      : (() => {
          const [, T] = entries[0] ?? ['', { x: 1, z: 0 }];
          const d = Math.hypot(T.x, T.z) || 1;
          return { x: (T.x / d) * config.ringRadius, z: (T.z / d) * config.ringRadius };
        })();
  const [id, T] = entries.reduce((best, e) => (distance(e[1], S) < distance(best[1], S) ? e : best), entries[0]);
  const aim = norm(sub(T, S));
  return { shot: { from: S, yaw: Math.atan2(aim.z, aim.x), power: 0.9, spin: 0, english: 0 }, target: id, score: 0, ghost: T };
}

/** Lagging: aim to stop on a line `lineDistance` away; same noise as shooting. */
export function chooseLagPower(lineDistance: number, surface: Surface, profile: BotProfile, rng: Rng): number {
  const table = rollTable(surface);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (restDistance(table, mid, 0) >= lineDistance) hi = mid;
    else lo = mid;
  }
  return Math.min(1, Math.max(0, hi + gauss(rng) * profile.powerNoise));
}
