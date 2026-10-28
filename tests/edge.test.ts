import { beforeAll, describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/constants';
import { initPhysics, ShotSim, SHOOTER_ID, startingLayout, type Layout } from '../src/core/physics';
import { Rng } from '../src/core/rng';
import type { Piece } from '../src/core/types';
import { ARENA_LIST, ARENAS } from '../src/game/arenas';
import { generateMap } from '../src/game/maps';

beforeAll(async () => {
  await initPhysics();
});

const R = WORLD.ringRadius;
const B = WORLD.boundaryRadius;

describe('the edge of play', () => {
  // Hops used to carry marbles over the 1.2-high kerb; they fell off the world and the
  // shot ran on to its 16 s cap (5 of 120 hard shots on the desk, 8 on ice).
  it('no marble leaves the field, and every shot settles before the time cap', () => {
    for (const a of ARENA_LIST) {
      for (let s = 0; s < 12; s++) {
        const map = generateMap({ arena: a.id, difficulty: 'hard', seed: 50 + s });
        const rng = new Rng(9000 + s);
        const place = rng.next() * Math.PI * 2;
        const shot = { placeAngle: place, aimAngle: place + Math.PI + (rng.next() - 0.5) * 1.6, power: 0.8 + rng.next() * 0.2, spin: (rng.next() - 0.5) * 2 };
        const sim = new ShotSim(startingLayout(), a.surface, shot, true, map.pieces);
        while (!sim.done) {
          sim.step();
          for (const b of sim.bodies) {
            if (sim.holed.has(b.id)) continue;
            const t = b.body.translation();
            expect(Math.hypot(t.x, t.z), `${a.id} #${s}`).toBeLessThan(B + 0.6);
            expect(t.y, `${a.id} #${s}`).toBeGreaterThan(-0.5);
          }
        }
        expect(sim.steps, `${a.id} #${s} ran to the cap`).toBeLessThan(WORLD.maxShotSteps);
        sim.free();
      }
    }
  }, 120_000);

  it('a marble that somehow gets past the edge is set down inside it, and the shot ends', () => {
    const layout: Layout = { targets: [{ id: 0, x: B + 2, y: WORLD.targetRadius, z: 0 }], shooter: { id: SHOOTER_ID, x: 0, y: WORLD.shooterRadius, z: 0 } };
    const sim = new ShotSim(layout, ARENAS.desk.surface, { placeAngle: 0, aimAngle: Math.PI / 2, power: 0.1, spin: 0 }, false, []);
    sim.runToEnd();
    const t = sim.bodies.find((b) => b.id === 0)!.body.translation();
    expect(Math.hypot(t.x, t.z)).toBeGreaterThan(R);
    expect(Math.hypot(t.x, t.z)).toBeLessThan(B);
    expect(sim.steps).toBeLessThan(WORLD.maxShotSteps);
    sim.free();
  });
});

/** Where does each marble end up (distance from the centre), for a shot along +x, with and without a backstop? */
function finish(layout: Layout, power: number, pieces: Piece[]) {
  const sim = new ShotSim(layout, ARENAS.desk.surface, { placeAngle: 0, aimAngle: 0, power, spin: 0 }, false, pieces);
  sim.runToEnd();
  const out = new Map(sim.bodies.map((b) => [b.id, Math.hypot(b.body.translation().x, b.body.translation().z)]));
  sim.free();
  return out;
}

describe('backstops outside the ring', () => {
  const backstop: Piece = { kind: 'wall', x: R + 1.6, z: 0, len: 1.4, thick: 0.38, h: 0.5, a: Math.PI / 2, skin: 'book' };
  const powers = Array.from({ length: 14 }, (_, i) => 0.2 + i * 0.03);

  it('every field gets some, outside the ring', () => {
    for (const a of ARENA_LIST) {
      const outside = generateMap({ arena: a.id, difficulty: 'medium', seed: 3 }).pieces.filter((p) => p.kind === 'wall' && Math.hypot(p.x, p.z) > R + 1);
      expect(outside.length, a.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('can save a shooter that would have rolled out: it bounces back in and stays', () => {
    const layout: Layout = { targets: [], shooter: { id: SHOOTER_ID, x: 0, y: WORLD.shooterRadius, z: 0 } };
    const saved = powers.filter((p) => finish(layout, p, [])!.get(SHOOTER_ID)! > R && finish(layout, p, [backstop]).get(SHOOTER_ID)! < R);
    expect(saved.length).toBeGreaterThan(0);
  });

  it('can cancel a point: a mib knocked out bounces back into the ring', () => {
    const layout: Layout = { targets: [{ id: 0, x: 3.5, y: WORLD.targetRadius, z: 0 }], shooter: { id: SHOOTER_ID, x: 0, y: WORLD.shooterRadius, z: 0 } };
    const cancelled = powers.filter((p) => finish(layout, p, []).get(0)! > R && finish(layout, p, [backstop]).get(0)! < R);
    expect(cancelled.length).toBeGreaterThan(0);
  });
});
