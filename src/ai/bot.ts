import { WORLD } from '../core/constants';
import { isOutsideRing, placementPoint, ShotSim, type Layout } from '../core/physics';
import { Rng } from '../core/rng';
import type { Piece, Shot, SurfaceParams } from '../core/types';
import type { BotProfile } from './profiles';

export interface BotContext {
  layout: Layout;
  firstShotOfTurn: boolean;
  seatAngle: number;
  surface: SurfaceParams;
  pieces?: Piece[];
}

interface Candidate {
  shot: Shot;
  prior: number;
  value?: number;
}

const TAU = Math.PI * 2;
const PLACE_R = WORLD.ringRadius + WORLD.shooterRadius + 0.02;

/** Let the UI breathe between imagined shots. */
const yieldToFrame = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Choose and execute a shot. `rng` must come from the shared match seed so that bots are
 * reproducible in replays and identical on every peer.
 */
export async function planBotShot(ctx: BotContext, profile: BotProfile, rng: Rng): Promise<Shot> {
  const cands = generateCandidates(ctx, profile, rng);
  cands.sort((a, b) => b.prior - a.prior);
  const pool = cands.slice(0, Math.max(4, profile.candidates));

  let i = 0;
  for (const c of pool) {
    c.value = imagine(ctx, c.shot, profile);
    if (++i % 6 === 0) await yieldToFrame();
  }

  // Careful players also ask "what if my thumb slips a little?" on their favourite shots.
  // How many they double-check grows with skill, one tier at a time: a hard on/off line
  // here made the step from regular to skilled a wall.
  pool.sort((a, b) => b.value! - a.value!);
  const careful = Math.round(profile.positional * 5);
  if (careful > 0) {
    for (const c of pool.slice(0, careful)) {
      let sum = c.value!;
      for (let k = 0; k < 2; k++) {
        sum += imagine(ctx, jitter(c.shot, profile, rng), profile);
      }
      c.value = sum / 3;
      await yieldToFrame();
    }
    pool.sort((a, b) => b.value! - a.value!);
  }

  let pick = pool[0];
  if (rng.next() < profile.blunder) {
    const n = Math.max(1, Math.floor(pool.length * 0.4));
    pick = pool[rng.int(n)];
  }
  return jitter(pick.shot, profile, rng);
}

/** Human hand tremor. Applied to the bot's intended shot before it is sent. */
function jitter(s: Shot, p: BotProfile, rng: Rng): Shot {
  const aimErr = (p.aimErrorDeg * Math.PI) / 180;
  return {
    placeAngle: s.placeAngle + rng.gaussian() * aimErr * 0.25,
    aimAngle: s.aimAngle + rng.gaussian() * aimErr,
    power: clamp(s.power * (1 + rng.gaussian() * p.powerError), 0.05, 1),
    spin: clamp(s.spin + rng.gaussian() * 0.08, -1, 1),
  };
}

function generateCandidates(ctx: BotContext, p: BotProfile, rng: Rng): Candidate[] {
  const out: Candidate[] = [];
  const rT = WORLD.targetRadius;
  const rS = WORLD.shooterRadius;
  const others = ctx.layout.targets;
  const powers = [0.42, 0.55, 0.7, 0.85, 1.0];
  const spins = p.usesSpin ? [0, -0.7] : [0];
  const fixedOrigin = !ctx.firstShotOfTurn && ctx.layout.shooter ? ctx.layout.shooter : null;

  for (const t of others) {
    const dist = Math.hypot(t.x, t.z);
    const baseExit = dist > 0.05 ? Math.atan2(t.z, t.x) : rng.range(0, TAU);
    for (const off of [0, -0.4, 0.4]) {
      const ea = baseExit + off;
      const ex = Math.cos(ea);
      const ez = Math.sin(ea);
      const gx = t.x - ex * (rT + rS);
      const gz = t.z - ez * (rT + rS);

      const origins: { x: number; z: number; place: number }[] = [];
      if (fixedOrigin) {
        origins.push({ x: fixedOrigin.x, z: fixedOrigin.z, place: ctx.seatAngle });
      } else {
        // Knuckle down directly behind the ghost ball, plus a couple of cut-shot spots.
        const s = rayCircle(gx, gz, -ex, -ez, PLACE_R);
        if (s !== null) {
          const ox = gx - ex * s;
          const oz = gz - ez * s;
          const pa = Math.atan2(oz, ox);
          // Wider spots too, for when posts and walls stand in the straight line.
          for (const d of [0, -0.18, 0.18, -0.45, 0.45]) {
            const pt = placementPoint(pa + d);
            origins.push({ x: pt.x, z: pt.z, place: pa + d });
          }
        }
      }

      for (const o of origins) {
        const ax = gx - o.x;
        const az = gz - o.z;
        const travel = Math.hypot(ax, az);
        if (travel < 1e-3) continue;
        const aim = Math.atan2(az, ax);
        const cut = Math.abs(wrap(aim - ea));
        if (cut > 1.15) continue; // too thin to move it meaningfully
        const blocked = pathBlocked(o.x, o.z, gx, gz, others, t.id) || obstacleOnPath(o.x, o.z, gx, gz, ctx.pieces, rS);
        // A wall or bumper between the mib and the ring line will stop it leaving.
        const exitBlocked = obstacleOnPath(t.x, t.z, t.x + ex * (WORLD.ringRadius + 0.5), t.z + ez * (WORLD.ringRadius + 0.5), ctx.pieces, rT);
        // Distance the target must travel to leave the ring along the exit line.
        const toEdge = WORLD.ringRadius - (t.x * ex + t.z * ez) + rT;
        for (const pw of powers) {
          for (const sp of spins) {
            const needed = 0.25 + 0.05 * travel + 0.06 * toEdge / Math.max(0.2, Math.cos(cut));
            const powerFit = -Math.abs(pw - Math.min(1, needed + 0.25));
            const prior = 3 - cut * 2 - (blocked ? 4 : 0) - (exitBlocked ? 2 : 0) + powerFit * 3 - travel * 0.05 + rng.next() * 0.3;
            out.push({ shot: { placeAngle: o.place, aimAngle: aim, power: pw, spin: sp }, prior });
          }
        }
      }
    }
  }
  if (out.length === 0) {
    // Nothing sensible: blast toward the middle.
    const from = fixedOrigin ?? placementPoint(ctx.seatAngle);
    out.push({
      shot: { placeAngle: ctx.seatAngle, aimAngle: Math.atan2(-from.z, -from.x), power: 0.8, spin: 0 },
      prior: 0,
    });
  }
  return out;
}

/** Simulate an intended shot exactly as the game would and score the outcome. */
function imagine(ctx: BotContext, shot: Shot, p: BotProfile): number {
  const sim = new ShotSim(ctx.layout, ctx.surface, shot, ctx.firstShotOfTurn, ctx.pieces);
  sim.runToEnd();
  const after = sim.resultLayout();
  sim.free();

  const captures = after.targets.filter((t) => isOutsideRing(t.x, t.z)).length;
  const left = after.targets.filter((t) => !isOutsideRing(t.x, t.z));
  const s = after.shooter;
  const shooterIn = !!s && !isOutsideRing(s.x, s.z);

  let v = captures * 10;
  if (captures > 0 && shooterIn) {
    v += 6;
    // Leave: a target close by makes the next shot easy.
    let nearest = Infinity;
    for (const t of left) nearest = Math.min(nearest, Math.hypot(t.x - s!.x, t.z - s!.z));
    if (left.length) v += p.positional * Math.max(0, 3 - nearest);
  }
  if (captures === 0 || !shooterIn) {
    // Turn passes: don't hand the opponent easy marbles sitting on the line.
    const gifts = left.filter((t) => Math.hypot(t.x, t.z) > WORLD.ringRadius - 0.6).length;
    v -= p.positional * gifts * 1.5;
  }
  if (!shooterIn) v -= 1;
  return v;
}

/** Does a solid map piece (post, bumper, wall) stand within `clear` of the segment? */
function obstacleOnPath(x0: number, z0: number, x1: number, z1: number, pieces: Piece[] | undefined, clear: number): boolean {
  if (!pieces) return false;
  for (const p of pieces) {
    if (p.kind === 'post' || p.kind === 'bumper') {
      if (segPointDist(x0, z0, x1, z1, p.x, p.z) < p.r + clear) return true;
    } else if (p.kind === 'wall') {
      const hx = (Math.cos(p.a) * p.len) / 2;
      const hz = (Math.sin(p.a) * p.len) / 2;
      if (segSegDist(x0, z0, x1, z1, p.x - hx, p.z - hz, p.x + hx, p.z + hz) < p.thick / 2 + clear) return true;
    }
  }
  return false;
}

function segPointDist(x0: number, z0: number, x1: number, z1: number, px: number, pz: number): number {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((px - x0) * dx + (pz - z0) * dz) / len2, 0, 1);
  return Math.hypot(x0 + dx * t - px, z0 + dz * t - pz);
}

function segSegDist(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const cross = (ux: number, uz: number, vx: number, vz: number) => ux * vz - uz * vx;
  const d1 = cross(bx - ax, bz - az, cx - ax, cz - az);
  const d2 = cross(bx - ax, bz - az, dx - ax, dz - az);
  const d3 = cross(dx - cx, dz - cz, ax - cx, az - cz);
  const d4 = cross(dx - cx, dz - cz, bx - cx, bz - cz);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(segPointDist(ax, az, bx, bz, cx, cz), segPointDist(ax, az, bx, bz, dx, dz), segPointDist(cx, cz, dx, dz, ax, az), segPointDist(cx, cz, dx, dz, bx, bz));
}

function pathBlocked(x0: number, z0: number, x1: number, z1: number, ms: Layout['targets'], skip: number) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  const clear = WORLD.targetRadius + WORLD.shooterRadius;
  for (const m of ms) {
    if (m.id === skip) continue;
    const t = clamp(((m.x - x0) * dx + (m.z - z0) * dz) / len2, 0, 1);
    const px = x0 + dx * t - m.x;
    const pz = z0 + dz * t - m.z;
    if (px * px + pz * pz < clear * clear) return true;
  }
  return false;
}

/** Distance s ≥ 0 along (dx,dz) from (x,z) to the circle of radius r, or null. */
function rayCircle(x: number, z: number, dx: number, dz: number, r: number): number | null {
  const b = x * dx + z * dz;
  const c = x * x + z * z - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = -b + Math.sqrt(disc);
  return s >= 0 ? s : null;
}

function wrap(a: number) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}
