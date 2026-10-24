import { describe, it, expect } from 'vitest';
import { beginShot, createMatch, currentPlayer, recordLag, resolveShot, startingCross, validateShot, type RingerState, type TurnEvent } from './rules';
import { DEFAULT_CONFIG, type PlayerInfo, type ShotInput, type Vec2 } from './types';

const players: PlayerInfo[] = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
];

function shot(from: Vec2): ShotInput {
  return { from, yaw: 0, power: 0.5, spin: 0, english: 0 };
}

/** A two-player match, player 0 first, already mid-shot from the ring line. */
function rolling(state: RingerState = createMatch(players, DEFAULT_CONFIG, { order: [0, 1] })): RingerState {
  return beginShot(state, shot({ x: DEFAULT_CONFIG.ringRadius, z: 0 }));
}

function expectEvent<K extends TurnEvent['kind']>(e: TurnEvent, kind: K): Extract<TurnEvent, { kind: K }> {
  expect(e.kind).toBe(kind);
  return e as Extract<TurnEvent, { kind: K }>;
}

describe('startingCross', () => {
  const cross = startingCross();
  const positions = Object.values(cross);

  it('creates 13 marbles t0..t12 with t0 at the origin', () => {
    expect(Object.keys(cross)).toEqual(Array.from({ length: 13 }, (_, i) => `t${i}`));
    expect(cross.t0).toEqual({ x: 0, z: 0 });
  });

  it('places every marble at a distinct spot inside the ring', () => {
    expect(new Set(positions.map((p) => `${p.x},${p.z}`)).size).toBe(13);
    for (const p of positions) expect(Math.hypot(p.x, p.z)).toBeLessThan(DEFAULT_CONFIG.ringRadius);
  });

  it('arms reach exactly 3 spacings out', () => {
    expect(Math.max(...positions.map((p) => Math.hypot(p.x, p.z)))).toBeCloseTo(3 * DEFAULT_CONFIG.crossSpacing);
  });
});

describe('createMatch', () => {
  it('starts with lagging when no order is given', () => {
    expect(createMatch(players).phase).toBe('lag');
  });

  it('skips lagging with an explicit order', () => {
    const s = createMatch(players, DEFAULT_CONFIG, { order: [1, 0] });
    expect(s.phase).toBe('aim');
    expect(currentPlayer(s)).toBe(1);
  });

  it('rejects an order that is not a permutation', () => {
    expect(() => createMatch(players, DEFAULT_CONFIG, { order: [0, 0] })).toThrow();
  });
});

describe('recordLag', () => {
  it('sends the closest lag first', () => {
    const s1 = recordLag(createMatch(players), 0, 30);
    expect(s1.lag).toEqual([30, null]);
    const s2 = recordLag(s1, 1, 10);
    expect(s2.order).toEqual([1, 0]);
    expect(s2.phase).toBe('aim');
  });

  it('makes tied players lag again', () => {
    const s = recordLag(recordLag(createMatch(players), 0, 20), 1, 20);
    expect(s.lag).toEqual([null, null]);
    expect(s.phase).toBe('lag');
    expect(expectEvent(s.event, 'lag-tie').players).toEqual([0, 1]);
  });

  it('refuses a second lag from the same player', () => {
    expect(() => recordLag(recordLag(createMatch(players), 0, 30), 0, 10)).toThrow();
  });
});

describe('validateShot', () => {
  const s = createMatch(players, DEFAULT_CONFIG, { order: [0, 1] });

  it('requires the shooter on the ring line at the start of a turn', () => {
    expect(validateShot(s, shot({ x: 60, z: 0 }))).toBeNull();
    expect(validateShot(s, shot({ x: 0, z: -60 }))).toBeNull();
    expect(validateShot(s, shot({ x: 40, z: 0 }))).toMatch(/ring line/);
  });

  it('rejects out-of-range power and spin', () => {
    expect(validateShot(s, { ...shot({ x: 60, z: 0 }), power: 1.5 })).toMatch(/power/);
    expect(validateShot(s, { ...shot({ x: 60, z: 0 }), spin: -2 })).toMatch(/spin/);
  });

  it('requires the shooter where it stopped on a continued turn', () => {
    const again = resolveShot(rolling(), { shooterPos: { x: 10, z: 5 }, targets: { t1: { x: 70, z: 0 } } });
    expect(validateShot(again, shot({ x: 10, z: 5 }))).toBeNull();
    expect(validateShot(again, shot({ x: 60, z: 0 }))).toMatch(/came to rest/);
  });
});

describe('resolveShot', () => {
  it('shoots again from the rest spot after a knockout with the shooter still in', () => {
    const s = resolveShot(rolling(), { shooterPos: { x: 10, z: 5 }, targets: { t1: { x: 70, z: 0 } } });
    expect(s.phase).toBe('aim');
    expect(currentPlayer(s)).toBe(0);
    expect(expectEvent(s.event, 'shoot-again').knocked).toEqual(['t1']);
    expect(s.shooterStart).toEqual({ kind: 'spot', pos: { x: 10, z: 5 } });
    expect(s.captured[0]).toEqual(['t1']);
    expect(s.targets).not.toHaveProperty('t1');
  });

  it('ends the turn but keeps the marble when the shooter leaves the ring', () => {
    const s = resolveShot(rolling(), { shooterPos: { x: 80, z: 0 }, targets: { t1: { x: 70, z: 0 } } });
    expect(currentPlayer(s)).toBe(1);
    const e = expectEvent(s.event, 'turn-over');
    expect(e.reason).toBe('shooter-out');
    expect(e.next).toBe(1);
    expect(s.shooterStart).toEqual({ kind: 'edge' });
    expect(s.captured[0]).toEqual(['t1']);
  });

  it('ends the turn on a miss', () => {
    const s = resolveShot(rolling(), { shooterPos: { x: 10, z: 5 }, targets: { t1: { x: 5, z: 5 } } });
    expect(currentPlayer(s)).toBe(1);
    expect(expectEvent(s.event, 'turn-over').reason).toBe('miss');
    expect(s.targets.t1).toEqual({ x: 5, z: 5 });
  });

  it('counts a marble that left the playfield as knocked out', () => {
    const s = resolveShot(rolling(), { shooterPos: { x: 10, z: 5 }, targets: { t1: null } });
    expect(s.captured[0]).toEqual(['t1']);
  });

  it('a shooter that left the playfield ends the turn', () => {
    const s = resolveShot(rolling(), { shooterPos: null, targets: { t1: null } });
    expect(expectEvent(s.event, 'turn-over').reason).toBe('shooter-out');
  });

  it('ends the game when the ring is empty and the most marbles wins', () => {
    const base = createMatch(players, DEFAULT_CONFIG, { order: [0, 1] });
    const last = rolling({ ...base, targets: { t0: { x: 0, z: 0 } }, captured: [['a', 'b'], ['c']] });
    const s = resolveShot(last, { shooterPos: { x: 10, z: 5 }, targets: { t0: { x: 70, z: 0 } } });
    expect(s.phase).toBe('over');
    expect(expectEvent(s.event, 'game-over').winners).toEqual([0]);
  });

  it('with endOnMajority, ends as soon as someone holds 7 of 13', () => {
    const base = createMatch(players, { ...DEFAULT_CONFIG, endOnMajority: true }, { order: [0, 1] });
    const s0 = rolling({
      ...base,
      targets: { t0: { x: 0, z: 0 }, t1: { x: 1, z: 1 } },
      captured: [['a', 'b', 'c', 'd', 'e', 'f'], ['h']],
    });
    const s = resolveShot(s0, { shooterPos: { x: 10, z: 5 }, targets: { t0: { x: 70, z: 0 } } });
    expect(s.phase).toBe('over');
    expect(expectEvent(s.event, 'game-over').winners).toEqual([0]);
    expect(Object.keys(s.targets)).toEqual(['t1']);
  });

  it('beginShot counts the shot and starts rolling', () => {
    const s = rolling();
    expect(s.shots).toBe(1);
    expect(s.phase).toBe('rolling');
  });

  it('refuses to resolve when nothing is rolling', () => {
    expect(() => resolveShot(createMatch(players, DEFAULT_CONFIG, { order: [0, 1] }), { shooterPos: null, targets: {} })).toThrow();
  });
});
