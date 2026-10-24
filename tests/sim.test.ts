import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, ShotSim, startingLayout } from '../src/core/physics';
import { Match } from '../src/core/match';
import { DEFAULT_SURFACE, type PlayerInfo, type Shot } from '../src/core/types';
import { Rng } from '../src/core/rng';

const players: PlayerInfo[] = [
  { id: 'a', name: 'A', marble: 'ember', kind: 'human' },
  { id: 'b', name: 'B', marble: 'tide', kind: 'human' },
];

beforeAll(async () => {
  await initPhysics();
});

describe('physics', () => {
  it('a straight break shot settles and scatters the cross', () => {
    const shot: Shot = { placeAngle: Math.PI / 2, aimAngle: -Math.PI / 2, power: 0.85, spin: 0 };
    const sim = new ShotSim(startingLayout(), DEFAULT_SURFACE, shot, true);
    sim.runToEnd();
    const after = sim.resultLayout();
    sim.free();
    expect(sim.steps).toBeLessThan(120 * 16);
    const moved = after.targets.filter((t) => Math.hypot(t.x, t.z) > 0 && t.id !== 0).length;
    expect(moved).toBeGreaterThan(0);
    // Every marble stays on the ground.
    for (const t of after.targets) expect(t.y).toBeLessThan(0.5);
  });

  it('is deterministic: same layout + same shot = identical result', () => {
    const shot: Shot = { placeAngle: 0.3, aimAngle: Math.PI + 0.25, power: 0.9, spin: -0.5 };
    const run = () => {
      const s = new ShotSim(startingLayout(), DEFAULT_SURFACE, shot, true);
      s.runToEnd();
      const l = s.resultLayout();
      s.free();
      return JSON.stringify(l);
    };
    expect(run()).toEqual(run());
  });

  it('plays a full random match to completion with identical outcomes on two "peers"', () => {
    const playOut = () => {
      const m = new Match({ players, seed: 1234, surface: DEFAULT_SURFACE });
      const rng = new Rng(99);
      m.start();
      let guard = 0;
      while (m.phase !== 'gameOver' && guard++ < 400) {
        // Aim roughly at a random remaining target.
        const t = m.layout.targets[rng.int(m.layout.targets.length)];
        const place = rng.range(0, Math.PI * 2);
        const from = m.shooterRestPosition() ?? { x: Math.cos(place) * 4.2, z: Math.sin(place) * 4.2 };
        const aim = Math.atan2(t.z - from.z, t.x - from.x) + rng.range(-0.05, 0.05);
        m.shoot({ placeAngle: place, aimAngle: aim, power: rng.range(0.5, 1), spin: rng.range(-1, 1) });
        m.finishShot();
      }
      return { hash: m.hash(), scores: m.scores, phase: m.phase, shots: m.shotsTaken };
    };
    const a = playOut();
    const b = playOut();
    expect(a).toEqual(b);
    expect(a.phase).toBe('gameOver');
    expect(a.scores[0] + a.scores[1]).toBeGreaterThanOrEqual(7);
  });
});
