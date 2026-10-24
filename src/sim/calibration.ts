/**
 * "Feel" for a surface: how fast a lone flicked marble is still going after
 * a given distance, for each power and spin. Measured once per surface by
 * rolling a single marble on an empty board, the way a player learns a
 * surface by practising. It describes the surface, never a particular shot,
 * so a bot using it is not seeing the future.
 */
import { DEFAULT_CONFIG, type RingerConfig } from '../core/types';
import { MarbleSim, SHOOTER_ID, launchSpeed, type Surface } from './physics';

export const CAL_SPINS = [0, -0.9] as const;
const POWERS = Array.from({ length: 41 }, (_, i) => i / 40);

interface Curve {
  power: number;
  /** (distance travelled cm, speed cm/s), distance increasing. */
  samples: { d: number; v: number }[];
  rest: number;
}

export interface RollTable {
  curves: Map<number, Curve[]>;
}

const cache = new WeakMap<Surface, RollTable>();

export function rollTable(surface: Surface, config: RingerConfig = DEFAULT_CONFIG): RollTable {
  const hit = cache.get(surface);
  if (hit) return hit;
  const curves = new Map<number, Curve[]>();
  // A huge ring so nothing counts as leaving the playfield while we measure.
  const sim = new MarbleSim({ ...config, ringRadius: 900 }, surface);
  for (const spin of CAL_SPINS) {
    const list: Curve[] = [];
    for (const power of POWERS) {
      sim.setup({}, { x: -800, z: 0 });
      sim.shoot({ from: { x: -800, z: 0 }, yaw: 0, power, spin, english: 0 });
      const samples = [{ d: 0, v: launchSpeed(power) }];
      let last = -800;
      let lastT = 0;
      let t = 0;
      while (!sim.settled() && t < 15) {
        sim.advance(1 / 60);
        t += 1 / 60;
        const x = sim.pos(SHOOTER_ID)?.x ?? last;
        if (t - lastT >= 1 / 30) {
          samples.push({ d: x + 800, v: Math.max(0, (x - last) / (t - lastT)) });
          last = x;
          lastT = t;
        }
      }
      const rest = (sim.pos(SHOOTER_ID)?.x ?? last) + 800;
      samples.push({ d: rest, v: 0 });
      list.push({ power, samples, rest });
    }
    curves.set(spin, list);
  }
  sim.dispose();
  const table = { curves };
  cache.set(surface, table);
  return table;
}

function curvesFor(table: RollTable, spin: number): Curve[] {
  let best: number = CAL_SPINS[0];
  for (const s of CAL_SPINS) if (Math.abs(s - spin) < Math.abs(best - spin)) best = s;
  return table.curves.get(best)!;
}

function speedOn(c: Curve, d: number): number {
  const s = c.samples;
  if (d >= c.rest) return 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i].d >= d) {
      const a = s[i - 1];
      const b = s[i];
      const k = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
      return a.v + (b.v - a.v) * k;
    }
  }
  return 0;
}

/** Speed (cm/s) a shooter flicked at `power`/`spin` still has after `d` cm. */
export function speedAfter(table: RollTable, power: number, spin: number, d: number): number {
  const cs = curvesFor(table, spin);
  const i = Math.min(cs.length - 2, Math.max(0, Math.floor(power * (cs.length - 1))));
  const k = power * (cs.length - 1) - i;
  return speedOn(cs[i], d) * (1 - k) + speedOn(cs[i + 1], d) * k;
}

/** Smallest power whose shooter still has `speed` after `d` cm, or null if none can. */
export function powerToArrive(table: RollTable, spin: number, d: number, speed: number): number | null {
  if (speedAfter(table, 1, spin, d) < speed) return null;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (speedAfter(table, mid, spin, d) >= speed) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Initial speed a struck, initially non-spinning marble needs to travel `d` cm.
 * Uses the spin-0 curves: a hit target leaves sliding, just like a flick.
 */
export function speedToTravel(table: RollTable, d: number): number | null {
  const cs = table.curves.get(0)!;
  for (let i = 0; i < cs.length; i++) {
    if (cs[i].rest >= d) {
      if (i === 0) return launchSpeed(0);
      const a = cs[i - 1];
      const b = cs[i];
      const k = (d - a.rest) / (b.rest - a.rest || 1);
      return launchSpeed(a.power + (b.power - a.power) * k);
    }
  }
  return null;
}

export function restDistance(table: RollTable, power: number, spin: number): number {
  const cs = curvesFor(table, spin);
  const i = Math.min(cs.length - 2, Math.max(0, Math.floor(power * (cs.length - 1))));
  const k = power * (cs.length - 1) - i;
  return cs[i].rest * (1 - k) + cs[i + 1].rest * k;
}
