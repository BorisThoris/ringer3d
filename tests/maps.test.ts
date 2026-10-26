import { beforeAll, describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/constants';
import { Match } from '../src/core/match';
import { initPhysics, layoutHash, ShotSim, startingLayout, SHOOTER_ID } from '../src/core/physics';
import { Rng } from '../src/core/rng';
import type { PlayerInfo, Shot } from '../src/core/types';
import { planBotShot } from '../src/ai/bot';
import { BOT_PROFILES } from '../src/ai/profiles';
import { ARENA_LIST, ARENAS } from '../src/game/arenas';
import { DIFFICULTIES, generateMap } from '../src/game/maps';

beforeAll(async () => {
  await initPhysics();
});

const ALL = ARENA_LIST.flatMap((a) => DIFFICULTIES.map((difficulty) => ({ arena: a.id, difficulty })));

describe('generated maps', () => {
  it('the same spec builds the same map; another seed builds another', () => {
    for (const s of ALL) {
      const a = generateMap({ ...s, seed: 7 });
      expect(generateMap({ ...s, seed: 7 })).toEqual(a);
      if (s.difficulty !== 'easy') expect(generateMap({ ...s, seed: 8 }).pieces).not.toEqual(a.pieces);
    }
  });

  it('harder maps carry more pieces, and nothing solid sits on the cross or the ring line', () => {
    for (const a of ARENA_LIST) {
      const n = DIFFICULTIES.map((difficulty) => {
        let total = 0;
        for (let seed = 1; seed <= 6; seed++) total += generateMap({ arena: a.id, difficulty, seed }).pieces.length;
        return total;
      });
      expect(n[2], `${a.id} hard vs easy`).toBeGreaterThan(n[0]);
      for (let seed = 1; seed <= 6; seed++) {
        for (const p of generateMap({ arena: a.id, difficulty: 'hard', seed }).pieces) {
          if (p.kind !== 'wall' && p.kind !== 'post' && p.kind !== 'bumper' && p.kind !== 'hole') continue;
          const d = Math.hypot(p.x, p.z);
          expect(d, `${a.id} ${p.kind} near the cross`).toBeGreaterThan(1.9);
          expect(Math.abs(d - WORLD.ringRadius), `${a.id} ${p.kind} on the ring line`).toBeGreaterThan(0.45);
        }
      }
    }
  });

  it('a cup takes a slow marble and lets a fast one skim over', () => {
    const cup = { kind: 'hole' as const, x: 0, z: 3, r: 0.3 };
    const layout = { targets: [{ id: 0, x: 0, y: WORLD.targetRadius, z: 0 }], shooter: null };
    // Gentle: the shooter rolls up the line and drops in.
    const slow = new ShotSim(layout, ARENAS.culdesac.surface, { placeAngle: Math.PI / 2, aimAngle: -Math.PI / 2, power: 0.34, spin: 0 }, true, [cup]);
    slow.runToEnd();
    expect(slow.holed.has(SHOOTER_ID)).toBe(true);
    expect(Math.hypot(slow.resultLayout().shooter!.x, slow.resultLayout().shooter!.z)).toBeGreaterThan(WORLD.ringRadius);
    slow.free();
    // Hard: it flies across the lip.
    const fast = new ShotSim(layout, ARENAS.culdesac.surface, { placeAngle: Math.PI / 2, aimAngle: -Math.PI / 2, power: 1, spin: 0 }, true, [cup]);
    fast.runToEnd();
    expect(fast.holed.has(SHOOTER_ID)).toBe(false);
    fast.free();
  });

  it('every map plays the same shot the same way, bit for bit', () => {
    const shot: Shot = { placeAngle: 0.7, aimAngle: 0.7 + Math.PI - 0.08, power: 0.95, spin: -0.3 };
    for (const s of ALL) {
      const map = generateMap({ ...s, seed: 3 });
      const run = () => {
        const sim = new ShotSim(startingLayout(), ARENAS[s.arena].surface, shot, true, map.pieces);
        sim.runToEnd();
        const h = layoutHash(sim.resultLayout());
        sim.free();
        return h;
      };
      expect(run(), `${s.arena}/${s.difficulty}`).toBe(run());
    }
  });

  it('bots can finish a match on the hardest map of every field', async () => {
    for (const a of ARENA_LIST) {
      const map = generateMap({ arena: a.id, difficulty: 'hard', seed: 11 });
      const players: PlayerInfo[] = [
        { id: 'a', name: 'a', marble: 'ember', kind: 'bot', botProfile: 'casual' },
        { id: 'b', name: 'b', marble: 'tide', kind: 'bot', botProfile: 'casual' },
      ];
      const m = new Match({ players, seed: 5, surface: a.surface, pieces: map.pieces });
      const rng = new Rng(5);
      m.start();
      let guard = 0;
      while (m.phase !== 'gameOver' && guard++ < 220) {
        const shot = await planBotShot(
          { layout: m.layout, firstShotOfTurn: m.firstShotOfTurn, seatAngle: m.seatAngle(m.current), surface: a.surface, pieces: map.pieces },
          BOT_PROFILES.casual,
          rng,
        );
        m.shoot(shot);
        m.finishShot();
      }
      expect(m.phase, `${a.id} hard map did not finish (${m.scores.join('-')} after ${m.shotsTaken})`).toBe('gameOver');
    }
  }, 600_000);
});
