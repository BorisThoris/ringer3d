import { beforeAll, describe, expect, it } from 'vitest';
import { startingCross } from '../core/rules';
import { DEFAULT_CONFIG } from '../core/types';
import { MarbleSim, SHOOTER_ID, SURFACES, initPhysics, launchSpeed, rollDistance } from './physics';

beforeAll(() => initPhysics());

function freshSim(surface = SURFACES.dirt) {
  const sim = new MarbleSim(DEFAULT_CONFIG, surface);
  const targets = startingCross();
  sim.setup(targets, { x: DEFAULT_CONFIG.ringRadius, z: 0 });
  return { sim, ids: Object.keys(targets) };
}

describe('MarbleSim', () => {
  it('targets sit still when nothing is shot', () => {
    const { sim, ids } = freshSim();
    sim.advance(1);
    const out = sim.outcome(ids);
    expect(out.targets.t0!.x).toBeCloseTo(0, 1);
    expect(out.targets.t1!.x).toBeCloseTo(DEFAULT_CONFIG.crossSpacing, 1);
  });

  it('a hard shot straight down the arm breaks the cross', () => {
    const { sim, ids } = freshSim();
    // From +x on the ring line, aiming at the centre (yaw = PI points to -x).
    sim.shoot({ from: { x: 60, z: 0 }, yaw: Math.PI, power: 1, spin: 0, english: 0 });
    sim.runToRest();
    const out = sim.outcome(ids);
    const moved = ids.filter((id) => {
      const p = out.targets[id];
      const s = startingCross()[id];
      return !p || Math.hypot(p.x - s.x, p.z - s.z) > 1;
    });
    expect(moved.length).toBeGreaterThan(0);
    const outOfRing = ids.filter((id) => {
      const p = out.targets[id];
      return !p || Math.hypot(p.x, p.z) >= DEFAULT_CONFIG.ringRadius;
    });
    expect(outOfRing.length).toBeGreaterThan(0);
  });

  it('a shot aimed away from the cross touches nothing and the shooter rolls out', () => {
    const { sim, ids } = freshSim();
    sim.shoot({ from: { x: 60, z: 0 }, yaw: 0, power: 0.3, spin: 0, english: 0 });
    sim.runToRest();
    const out = sim.outcome(ids);
    for (const id of ids) expect(out.targets[id]).not.toBeNull();
    expect(out.targets.t0!.x).toBeCloseTo(0, 1);
    expect(out.shooterPos === null || out.shooterPos.x > 60).toBe(true);
  });

  it('a gentle roll stops about where rolling resistance predicts', () => {
    const sim = new MarbleSim(DEFAULT_CONFIG, SURFACES.pavement);
    sim.setup({}, { x: -50, z: 0 });
    // Pre-rolled (spin 0.625 * 1.6 = 1 => natural roll) so there is no sliding phase.
    sim.shoot({ from: { x: -50, z: 0 }, yaw: 0, power: 0.15, spin: 0.625, english: 0 });
    sim.runToRest();
    const travelled = sim.pos(SHOOTER_ID)!.x + 50;
    const predicted = rollDistance(launchSpeed(0.15), SURFACES.pavement);
    expect(travelled).toBeGreaterThan(predicted * 0.6);
    expect(travelled).toBeLessThan(predicted * 1.4);
  });

  it('settles within the time cap', () => {
    const { sim } = freshSim();
    sim.shoot({ from: { x: 60, z: 0 }, yaw: Math.PI, power: 1, spin: 1, english: 1 });
    let t = 0;
    while (!sim.settled() && t < 30) {
      sim.advance(1 / 60);
      t += 1 / 60;
    }
    expect(sim.settled()).toBe(true);
    expect(t).toBeLessThan(16);
  });
});
