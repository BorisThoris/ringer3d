import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, ShotSim } from '../src/core/physics';
import type { Piece } from '../src/core/types';
import { ARENAS } from '../src/game/arenas';

beforeAll(async () => {
  await initPhysics();
});

/** Roll a lone marble along +x into `piece`; how far back does it come before it stops? */
function rebound(piece: Piece): number {
  const sim = new ShotSim({ targets: [], shooter: { id: -1, x: 0, y: 0.21, z: 0 } }, ARENAS.desk.surface, { placeAngle: 0, aimAngle: 0, power: 0.35, spin: 0 }, false, [piece]);
  const b = sim.bodies[0];
  let peak = -Infinity;
  let bounced = false;
  while (!sim.done) {
    sim.step();
    const x = b.body.translation().x;
    if (!bounced && b.body.linvel().x < 0) bounced = true;
    if (!bounced) peak = Math.max(peak, x);
  }
  const back = peak - b.body.translation().x;
  sim.free();
  return back;
}

describe('bouncing off obstacles', () => {
  // The marble used to keep its forward roll through the hit, and ground friction then
  // dragged it back into the obstacle: rebounds died on the spot (0.24 off a wall, 0.68
  // off a bumper).
  it('a wall sends a marble back, it does not just stop it', () => {
    expect(rebound({ kind: 'wall', x: 3, z: 0, len: 3, thick: 0.2, h: 0.4, a: Math.PI / 2 })).toBeGreaterThan(0.45);
  });

  it('a bumper gives back a real bounce', () => {
    expect(rebound({ kind: 'bumper', x: 3, z: 0, r: 0.4 })).toBeGreaterThan(1.2);
  });
});
