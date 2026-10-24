/**
 * Ringer rules as a pure state machine. Every function returns a new state;
 * nothing here knows about rendering, physics or networking.
 *
 * The rules (traditional playground Ringer):
 * 1. 13 small marbles sit in a cross in the middle of the ring.
 * 2. Lagging decides the order: everyone rolls toward a line, closest goes first.
 * 3. A turn starts with the shooter knuckled down on the ring line, anywhere around it.
 * 4. Any target knocked out of the ring is kept by the shooter's player.
 * 5. If you knocked at least one out AND your shooter stayed in the ring, you
 *    shoot again from where the shooter stopped.
 * 6. A miss, or the shooter leaving the ring, ends the turn (you keep what you knocked out).
 * 7. When the ring is empty, most marbles wins. Optional: end as soon as someone
 *    holds a majority (tournament "first to 7").
 */
import { DEFAULT_CONFIG, type MarbleId, type PlayerInfo, type RingerConfig, type ShotInput, type ShotOutcome, type Vec2 } from './types';

export type Phase = 'lag' | 'aim' | 'rolling' | 'over';

export type ShooterStart = { kind: 'edge' } | { kind: 'spot'; pos: Vec2 };

export type TurnEvent =
  | { kind: 'start' }
  | { kind: 'lag-tie'; players: number[] }
  | { kind: 'order'; order: number[] }
  | { kind: 'shoot-again'; player: number; knocked: MarbleId[] }
  | { kind: 'turn-over'; player: number; knocked: MarbleId[]; reason: 'miss' | 'shooter-out'; next: number }
  | { kind: 'game-over'; winners: number[] };

export interface RingerState {
  config: RingerConfig;
  players: PlayerInfo[];
  phase: Phase;
  /** Lag distance per player (cm from the lag line); null = still to lag. */
  lag: (number | null)[];
  /** Player indices in turn order; empty until lagging is done. */
  order: number[];
  /** Index into `order` of the player whose turn it is. */
  turn: number;
  shooterStart: ShooterStart;
  /** Targets still inside the ring. */
  targets: Record<MarbleId, Vec2>;
  /** Marbles each player has won, by player index. */
  captured: MarbleId[][];
  shots: number;
  event: TurnEvent;
}

/** Positions for the traditional cross: one in the centre, the rest spread on four arms. */
export function startingCross(config: RingerConfig = DEFAULT_CONFIG): Record<MarbleId, Vec2> {
  const out: Record<MarbleId, Vec2> = { t0: { x: 0, z: 0 } };
  const dirs: Vec2[] = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }];
  for (let i = 1; i < config.targetCount; i++) {
    const arm = (i - 1) % 4;
    const step = Math.floor((i - 1) / 4) + 1;
    out[`t${i}`] = { x: dirs[arm].x * step * config.crossSpacing, z: dirs[arm].z * step * config.crossSpacing };
  }
  return out;
}

export function createMatch(
  players: PlayerInfo[],
  config: RingerConfig = DEFAULT_CONFIG,
  opts: { order?: number[] } = {},
): RingerState {
  if (players.length < 1) throw new Error('need at least one player');
  const base: RingerState = {
    config,
    players,
    phase: 'lag',
    lag: players.map(() => null),
    order: [],
    turn: 0,
    shooterStart: { kind: 'edge' },
    targets: startingCross(config),
    captured: players.map(() => []),
    shots: 0,
    event: { kind: 'start' },
  };
  if (opts.order) {
    if (!isPermutation(opts.order, players.length)) throw new Error('order must be a permutation of player indices');
    return { ...base, phase: 'aim', order: [...opts.order], event: { kind: 'order', order: [...opts.order] } };
  }
  return base;
}

/**
 * Record one player's lag. Once everyone has lagged, closest-to-the-line goes
 * first. Players who tie exactly for any position lag again.
 */
export function recordLag(state: RingerState, player: number, distance: number): RingerState {
  if (state.phase !== 'lag') throw new Error(`cannot lag during ${state.phase}`);
  if (state.lag[player] !== null) throw new Error(`player ${player} already lagged`);
  if (!(distance >= 0)) throw new Error('lag distance must be a non-negative number');
  const lag = state.lag.map((d, i) => (i === player ? distance : d));
  if (lag.some((d) => d === null)) return { ...state, lag };

  const tied = lag
    .map((d, i) => ({ d: d as number, i }))
    .filter((a, _, all) => all.some((b) => b.i !== a.i && b.d === a.d))
    .map((a) => a.i);
  if (tied.length > 0) {
    return { ...state, lag: lag.map((d, i) => (tied.includes(i) ? null : d)), event: { kind: 'lag-tie', players: tied } };
  }
  const order = lag.map((d, i) => ({ d: d as number, i })).sort((a, b) => a.d - b.d).map((a) => a.i);
  return { ...state, lag, order, phase: 'aim', turn: 0, event: { kind: 'order', order } };
}

export function currentPlayer(state: RingerState): number {
  return state.order[state.turn];
}

export function distance(a: Vec2, b: Vec2 = { x: 0, z: 0 }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function isInRing(config: RingerConfig, pos: Vec2): boolean {
  return distance(pos) < config.ringRadius;
}

/** Project any point onto the ring line: where a knuckled-down shooter sits. */
export function snapToEdge(config: RingerConfig, pos: Vec2): Vec2 {
  const d = distance(pos);
  if (d < 1e-6) return { x: config.ringRadius, z: 0 };
  return { x: (pos.x / d) * config.ringRadius, z: (pos.z / d) * config.ringRadius };
}

const POSITION_TOLERANCE = 0.5;

/** Why a shot is illegal, or null if it may be taken. */
export function validateShot(state: RingerState, shot: ShotInput): string | null {
  if (state.phase !== 'aim') return `not aiming (phase ${state.phase})`;
  if (!Number.isFinite(shot.yaw)) return 'yaw must be finite';
  if (!(shot.power >= 0 && shot.power <= 1)) return 'power must be within 0..1';
  if (!(shot.spin >= -1 && shot.spin <= 1)) return 'spin must be within -1..1';
  if (!(shot.english >= -1 && shot.english <= 1)) return 'english must be within -1..1';
  if (state.shooterStart.kind === 'edge') {
    if (Math.abs(distance(shot.from) - state.config.ringRadius) > POSITION_TOLERANCE) return 'shooter must start on the ring line';
  } else if (distance(shot.from, state.shooterStart.pos) > POSITION_TOLERANCE) {
    return 'shooter must start where it came to rest';
  }
  return null;
}

export function beginShot(state: RingerState, shot: ShotInput): RingerState {
  const err = validateShot(state, shot);
  if (err) throw new Error(err);
  return { ...state, phase: 'rolling', shots: state.shots + 1 };
}

export function resolveShot(state: RingerState, outcome: ShotOutcome): RingerState {
  if (state.phase !== 'rolling') throw new Error(`cannot resolve during ${state.phase}`);
  const player = currentPlayer(state);
  const knocked: MarbleId[] = [];
  const targets: Record<MarbleId, Vec2> = {};
  for (const id of Object.keys(state.targets)) {
    // A target the sim did not report is assumed unmoved.
    const pos = id in outcome.targets ? outcome.targets[id] : state.targets[id];
    if (pos && isInRing(state.config, pos)) targets[id] = pos;
    else knocked.push(id);
  }
  const captured = state.captured.map((c, i) => (i === player ? [...c, ...knocked] : c));
  const next: RingerState = { ...state, targets, captured };

  const winners = finished(next);
  if (winners) return { ...next, phase: 'over', event: { kind: 'game-over', winners } };

  const shooterIn = outcome.shooterPos !== null && isInRing(state.config, outcome.shooterPos);
  if (knocked.length > 0 && shooterIn) {
    return {
      ...next,
      phase: 'aim',
      shooterStart: { kind: 'spot', pos: outcome.shooterPos as Vec2 },
      event: { kind: 'shoot-again', player, knocked },
    };
  }
  const turn = (state.turn + 1) % state.order.length;
  return {
    ...next,
    phase: 'aim',
    turn,
    shooterStart: { kind: 'edge' },
    event: { kind: 'turn-over', player, knocked, reason: shooterIn ? 'miss' : 'shooter-out', next: state.order[turn] },
  };
}

/** Winning player indices if the match is decided, else null. Ties share the win. */
export function finished(state: RingerState): number[] | null {
  const counts = state.captured.map((c) => c.length);
  const remaining = Object.keys(state.targets).length;
  const best = Math.max(...counts);
  const leaders = counts.flatMap((c, i) => (c === best ? [i] : []));
  if (remaining === 0) return leaders;
  if (state.config.endOnMajority && best > state.config.targetCount / 2) return leaders;
  return null;
}

/** Final standings, highest score first. */
export function standings(state: RingerState): { player: number; score: number }[] {
  return state.captured.map((c, player) => ({ player, score: c.length })).sort((a, b) => b.score - a.score);
}

function isPermutation(order: number[], n: number): boolean {
  return order.length === n && new Set(order).size === n && order.every((i) => Number.isInteger(i) && i >= 0 && i < n);
}
