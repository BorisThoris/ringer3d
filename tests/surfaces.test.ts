import { beforeAll, describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/constants';
import { Match } from '../src/core/match';
import { initPhysics, layoutHash, placementPoint, ShotSim, startingLayout } from '../src/core/physics';
import { Rng } from '../src/core/rng';
import type { PlayerInfo, Shot, SurfaceParams } from '../src/core/types';
import { planBotShot } from '../src/ai/bot';
import { BOT_PROFILES } from '../src/ai/profiles';
import { ARENA_LIST, ARENAS, arenaId, type ArenaId } from '../src/game/arenas';

beforeAll(async () => {
  await initPhysics();
});

/** A flick along a lane tangent to the ring (clear of the cross): how far, how far off line, how long. */
function lane(surface: SurfaceParams, power: number, place: number) {
  const aim = place + Math.PI / 2;
  const start = placementPoint(place);
  const sim = new ShotSim(startingLayout(), surface, { placeAngle: place, aimAngle: aim, power, spin: 0 }, true);
  sim.runToEnd();
  const end = sim.resultLayout().shooter!;
  const steps = sim.steps;
  sim.free();
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  return { dist: Math.hypot(dx, dz), curl: Math.abs(-Math.sin(aim) * dx + Math.cos(aim) * dz), steps };
}

/** Averages over eight lanes around the ring, so one lucky bump does not decide it. */
function roll(id: ArenaId, power: number) {
  let dist = 0;
  let curl = 0;
  let steps = 0;
  for (let k = 0; k < 8; k++) {
    const r = lane(ARENAS[id].surface, power, (k / 8) * Math.PI * 2);
    dist += r.dist / 8;
    curl += r.curl / 8;
    steps = Math.max(steps, r.steps);
  }
  return { dist, curl, steps };
}

/** Mean distance of the mibs from the centre after a full-power break. */
function breakSpread(id: ArenaId): number {
  const shot: Shot = { placeAngle: 0.05, aimAngle: Math.PI + 0.03, power: 1, spin: 0 };
  const sim = new ShotSim(startingLayout(), ARENAS[id].surface, shot, true);
  sim.runToEnd();
  const ts = sim.resultLayout().targets;
  sim.free();
  return ts.reduce((m, t) => m + Math.hypot(t.x, t.z), 0) / ts.length;
}

describe('surfaces', () => {
  it('every field changes how far a marble rolls, in the order you would expect', () => {
    for (const power of [0.25, 0.5]) {
      const d = Object.fromEntries(ARENA_LIST.map((a) => [a.id, roll(a.id, power).dist])) as Record<ArenaId, number>;
      expect(d.sand).toBeLessThan(d.grass);
      expect(d.grass).toBeLessThan(d.culdesac);
      expect(d.culdesac).toBeLessThan(d.desk);
      expect(d.desk).toBeLessThan(d.ice);
      // Not cosmetic: ice carries the same flick several times further than sand.
      expect(d.ice / d.sand).toBeGreaterThan(3);
    }
  });

  it('a lumpy lawn bends slow rolls; a desk keeps them true', () => {
    const grass = roll('grass', 0.3);
    const desk = roll('desk', 0.3);
    expect(grass.curl / grass.dist).toBeGreaterThan(0.04);
    expect(grass.curl / grass.dist).toBeGreaterThan((desk.curl / desk.dist) * 1.5);
  });

  it('the same break scatters across ice and dies in sand', () => {
    expect(breakSpread('ice')).toBeGreaterThan(breakSpread('desk'));
    expect(breakSpread('desk')).toBeGreaterThan(breakSpread('sand'));
    expect(breakSpread('ice') - breakSpread('sand')).toBeGreaterThan(1.5);
  });

  it('nothing creeps: every shot on every field comes to rest well before the time cap', () => {
    for (const a of ARENA_LIST) for (const p of [0.1, 0.5, 1]) expect(roll(a.id, p).steps).toBeLessThan(WORLD.maxShotSteps * 0.5);
  });

  it('bumps and hops stay deterministic: the same shot gives the same table, bit for bit', () => {
    for (const a of ARENA_LIST) {
      const shot: Shot = { placeAngle: 0.7, aimAngle: 0.7 + Math.PI - 0.08, power: 0.9, spin: -0.3 };
      const run = () => {
        const s = new ShotSim(startingLayout(), a.surface, shot, true);
        s.runToEnd();
        const h = layoutHash(s.resultLayout());
        s.free();
        return h;
      };
      expect(run()).toBe(run());
    }
  });

  it('bots can still win on the deadest field', async () => {
    for (const a of [ARENAS.sand]) {
      const players: PlayerInfo[] = [
        { id: 'a', name: 'a', marble: 'ember', kind: 'bot', botProfile: 'casual' },
        { id: 'b', name: 'b', marble: 'tide', kind: 'bot', botProfile: 'casual' },
      ];
      const m = new Match({ players, seed: 42, surface: a.surface });
      const rng = new Rng(42);
      m.start();
      let guard = 0;
      while (m.phase !== 'gameOver' && guard++ < 400) {
        const shot = await planBotShot(
          { layout: m.layout, firstShotOfTurn: m.firstShotOfTurn, seatAngle: m.seatAngle(m.current), surface: a.surface },
          BOT_PROFILES.casual,
          rng,
        );
        m.shoot(shot);
        m.finishShot();
      }
      expect(m.phase, `${a.id} match did not finish`).toBe('gameOver');
    }
  }, 300_000);

  it('old field ids from earlier builds still resolve to a real field', () => {
    for (const legacy of ['schoolyard', 'zen', 'rooftop', 'glacier', 'caldera']) expect(ARENAS[arenaId(legacy)]).toBeDefined();
    expect(arenaId('desk')).toBe('desk');
    expect(arenaId(undefined)).toBe('culdesac');
  });
});
