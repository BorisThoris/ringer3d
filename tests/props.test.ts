import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, layoutHash, ShotSim, type Layout } from '../src/core/physics';
import { propTraits } from '../src/core/props';
import type { Piece, Shot } from '../src/core/types';
import { ARENAS, type ArenaId } from '../src/game/arenas';
import { generateMap } from '../src/game/maps';

beforeAll(async () => {
  await initPhysics();
});

const start: Layout = { targets: [], shooter: { id: 100, x: 0, y: 0.21, z: 0 } };
const shot = (power: number): Shot => ({ placeAngle: 0, aimAngle: 0, power, spin: 0 });

function run(arena: ArenaId, pieces: Piece[], power: number, layout = start) {
  const sim = new ShotSim(layout, ARENAS[arena].surface, shot(power), false, pieces);
  const broke: number[] = [];
  while (!sim.done) {
    sim.step();
    broke.push(...sim.broke.map((p) => p.i));
  }
  const after = sim.resultLayout();
  sim.free();
  return { after, broke };
}

const eraser: Piece = { kind: 'wall', x: 3, z: 0, len: 0.5, thick: 0.25, h: 0.18, a: Math.PI / 2, skin: 'eraser' };
const pot: Piece = { kind: 'post', x: 3, z: 0, r: 0.26, h: 0.6, skin: 'pot' };
const kerb: Piece = { kind: 'wall', x: 3, z: 0, len: 1, thick: 0.3, h: 0.32, a: Math.PI / 2, skin: 'kerbstone' };

describe('props', () => {
  it('a loose prop is shoved by a hit, the same way every time', () => {
    const a = run('desk', [eraser], 1);
    const b = run('desk', [eraser], 1);
    const p = a.after.props![0];
    expect(p.x).toBeGreaterThan(4);
    expect(layoutHash(a.after)).toBe(layoutHash(b.after));
  });

  it('a pot survives a soft hit and breaks under a hard one, and stays broken', () => {
    expect(run('desk', [pot], 0.6).broke).toEqual([]);
    const hard = run('desk', [pot], 1);
    expect(hard.broke).toEqual([0]);
    expect(hard.after.props![0].broken).toBe(true);
    // The marble smashed on through rather than bouncing off the pot it broke.
    expect(hard.after.shooter!.x).toBeGreaterThan(3.3);
    // Next shot along the same line: nothing there any more, the marble rolls on through.
    const next = run('desk', [pot], 1, { ...hard.after, shooter: { id: 100, x: 0, y: 0.21, z: 0 } });
    expect(next.after.props![0].broken).toBe(true);
    expect(next.after.shooter!.x).toBeGreaterThan(3.5);
  });

  it('set stones never move', () => {
    const { after } = run('culdesac', [kerb], 1);
    expect(after.props).toBeUndefined();
    expect(propTraits(kerb)).toBeNull();
  });

  it('every field that has standing objects has some that move or break', () => {
    for (const arena of ['desk', 'culdesac', 'grass', 'sand', 'ice'] as const) {
      let maps = 0;
      for (let seed = 1; seed <= 20; seed++) {
        if (generateMap({ arena, difficulty: 'hard', seed }).pieces.some((p) => propTraits(p))) maps++;
      }
      // Most maps of every field have something to knock about (a few roll only set stones).
      expect(maps, arena).toBeGreaterThanOrEqual(12);
    }
  });
});
