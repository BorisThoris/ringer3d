import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, placementPoint, ShotSim, startingLayout } from '../src/core/physics';
import type { Shot } from '../src/core/types';
import { ARENA_LIST, ARENAS, arenaId, type ArenaId } from '../src/game/arenas';

beforeAll(async () => {
  await initPhysics();
});

/** How far the same gentle flick rolls on a field's surface (along the ring line, clear of the cross). */
function rollDistance(id: ArenaId, power = 0.25): number {
  const shot: Shot = { placeAngle: 0, aimAngle: Math.PI / 2, power, spin: 0 };
  const start = placementPoint(0);
  const sim = new ShotSim(startingLayout(), ARENAS[id].surface, shot, true);
  sim.runToEnd();
  const end = sim.resultLayout().shooter!;
  sim.free();
  return Math.hypot(end.x - start.x, end.z - start.z);
}

describe('surfaces', () => {
  it('every field changes how far a marble rolls, in the order you would expect', () => {
    const d = Object.fromEntries(ARENA_LIST.map((a) => [a.id, rollDistance(a.id)])) as Record<ArenaId, number>;
    console.log('roll distance by field:', Object.entries(d).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '));
    expect(d.sand).toBeLessThan(d.grass);
    expect(d.grass).toBeLessThan(d.culdesac);
    expect(d.culdesac).toBeLessThan(d.desk);
    expect(d.desk).toBeLessThan(d.ice);
    // Not cosmetic: ice carries the same flick several times further than sand.
    expect(d.ice / d.sand).toBeGreaterThan(3);
  });

  it('old field ids from earlier builds still resolve to a real field', () => {
    for (const legacy of ['schoolyard', 'zen', 'rooftop', 'glacier', 'caldera']) expect(ARENAS[arenaId(legacy)]).toBeDefined();
    expect(arenaId('desk')).toBe('desk');
    expect(arenaId(undefined)).toBe('culdesac');
  });
});
