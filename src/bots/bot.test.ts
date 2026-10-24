import { beforeAll, describe, expect, it } from 'vitest';
import { beginShot, createMatch, currentPlayer, resolveShot, type RingerState } from '../core/rules';
import { DEFAULT_CONFIG } from '../core/types';
import { MarbleSim, SURFACES, initPhysics } from '../sim/physics';
import { BOT_PROFILES, chooseShot, planShots, seededRng } from './bot';

beforeAll(() => initPhysics());

/** Play a whole match headlessly: the same loop the game runs, minus rendering. */
function playMatch(profiles: string[], seed: number, surface = SURFACES.dirt) {
  const rng = seededRng(seed);
  let state: RingerState = createMatch(
    profiles.map((p, i) => ({ id: `p${i}`, name: p, botProfile: p })),
    DEFAULT_CONFIG,
    { order: profiles.map((_, i) => i) },
  );
  const sim = new MarbleSim(DEFAULT_CONFIG, surface);
  let shots = 0;
  let knockouts = 0;
  while (state.phase !== 'over' && shots < 300) {
    const me = currentPlayer(state);
    const plan = chooseShot(state, surface, BOT_PROFILES[profiles[me]], rng);
    sim.setup(state.targets, null);
    state = beginShot(state, plan.shot);
    sim.shoot(plan.shot);
    sim.runToRest();
    const before = Object.keys(state.targets).length;
    state = resolveShot(state, sim.outcome(Object.keys(state.targets)));
    knockouts += before - Object.keys(state.targets).length;
    shots++;
  }
  sim.dispose();
  return { state, shots, knockouts };
}

describe('bot planner', () => {
  it('finds clean shots on the opening cross', () => {
    const state = createMatch([{ id: 'a', name: 'A' }], DEFAULT_CONFIG, { order: [0] });
    const plans = planShots(state, SURFACES.dirt, BOT_PROFILES.master);
    expect(plans.length).toBeGreaterThan(10);
    for (const p of plans.slice(0, 5)) {
      expect(Math.hypot(p.shot.from.x, p.shot.from.z)).toBeCloseTo(DEFAULT_CONFIG.ringRadius, 3);
      expect(p.shot.power).toBeGreaterThan(0);
      expect(p.shot.power).toBeLessThanOrEqual(1);
    }
  });

  it('a noiseless top plan from the line knocks a marble out', () => {
    const state = createMatch([{ id: 'a', name: 'A' }], DEFAULT_CONFIG, { order: [0] });
    const plan = planShots(state, SURFACES.dirt, BOT_PROFILES.master)[0];
    const sim = new MarbleSim(DEFAULT_CONFIG, SURFACES.dirt);
    sim.setup(state.targets, null);
    sim.shoot(plan.shot);
    sim.runToRest();
    const next = resolveShot(beginShot(state, plan.shot), sim.outcome(Object.keys(state.targets)));
    expect(next.captured[0].length).toBeGreaterThan(0);
  });
});

describe('bot matches', () => {
  it('bot-vs-bot matches always finish and every marble is accounted for', () => {
    for (const seed of [1, 2, 3]) {
      const { state, shots } = playMatch(['regular', 'sharp'], seed);
      expect(state.phase).toBe('over');
      expect(shots).toBeLessThan(300);
      expect(state.captured.flat().length).toBe(13);
    }
  }, 60000);

  it('skill shows: masters clear the ring faster than rookies', () => {
    const rate = (p: string) => {
      let k = 0;
      let s = 0;
      for (const seed of [11, 12, 13, 14]) {
        const r = playMatch([p], seed);
        k += r.knockouts;
        s += r.shots;
      }
      return k / s;
    };
    const master = rate('master');
    const rookie = rate('rookie');
    console.log(`knockouts per shot: master ${master.toFixed(2)}, rookie ${rookie.toFixed(2)}`);
    expect(master).toBeGreaterThan(rookie);
  }, 60000);
});
