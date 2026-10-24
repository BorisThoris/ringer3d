import { TARGET_COUNT, WORLD } from './constants';
import {
  isOutsideRing,
  layoutHash,
  quantizeShot,
  ShotSim,
  SHOOTER_ID,
  startingLayout,
  type Layout,
} from './physics';
import { Rng } from './rng';
import type { MatchEvent, Phase, PlayerInfo, Shot, SurfaceParams } from './types';

export interface MatchConfig {
  players: PlayerInfo[];
  seed: number;
  surface: SurfaceParams;
  /** If set, the first player to reach this score wins immediately. Defaults to a mathematical lock. */
  targetScore?: number;
}

export interface MatchSnapshot {
  layout: Layout;
  scores: number[];
  captured: number[][];
  current: number;
  firstShotOfTurn: boolean;
  shotsTaken: number;
  phase: Phase;
  winners: number[];
}

/**
 * Ringer rules, independent of rendering and networking.
 *
 * - The shooter knuckles down anywhere on the ring line for the first shot of a turn.
 * - Every target knocked fully out of the ring is kept by the shooter.
 * - Capture something and stay inside the ring → shoot again from where the shooter stopped.
 * - Miss, or let the shooter leave the ring → the turn passes. Marbles knocked out still count.
 * - The game ends when the ring is empty or the leader can no longer be caught.
 */
export class Match {
  readonly config: MatchConfig;
  layout: Layout;
  scores: number[];
  captured: number[][];
  current: number;
  firstShotOfTurn = true;
  shotsTaken = 0;
  phase: Phase = 'aim';
  winners: number[] = [];
  /** The in-flight simulation while phase === 'rolling'. */
  sim: ShotSim | null = null;
  lastShot: Shot | null = null;
  /** Every shot with the layout it was taken from: a replay record and a desync detective. */
  shotLog: { n: number; player: number; shot: Shot; before: string; first: boolean; after?: string }[] = [];
  private listeners: ((e: MatchEvent) => void)[] = [];

  constructor(config: MatchConfig) {
    this.config = config;
    this.layout = startingLayout();
    this.scores = config.players.map(() => 0);
    this.captured = config.players.map(() => []);
    // "Lagging" for first shot is resolved with the shared seed so every peer agrees.
    this.current = new Rng(config.seed).int(config.players.length);
  }

  on(fn: (e: MatchEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  private emit(e: MatchEvent) {
    for (const l of this.listeners) l(e);
  }

  start() {
    this.emit({ type: 'turnStart', player: this.current });
  }

  get currentPlayer(): PlayerInfo {
    return this.config.players[this.current];
  }

  get remaining(): number {
    return this.layout.targets.length;
  }

  /** Seat angle: where a player knuckles down by default. */
  seatAngle(player: number): number {
    const n = this.config.players.length;
    return Math.PI / 2 + (player / n) * Math.PI * 2;
  }

  /** Begin a shot. Returns false if it is not a legal moment to shoot. */
  shoot(rawShot: Shot): boolean {
    if (this.phase !== 'aim') return false;
    const shot = quantizeShot(rawShot);
    if (shot.power <= 0) return false;
    this.lastShot = shot;
    this.shotLog.push({ n: this.shotsTaken, player: this.current, shot, before: layoutHash(this.layout), first: this.firstShotOfTurn });
    this.sim = new ShotSim(this.layout, this.config.surface, shot, this.firstShotOfTurn);
    this.phase = 'rolling';
    this.shotsTaken++;
    this.emit({ type: 'shot', player: this.current, shot });
    return true;
  }

  /** Advance the in-flight shot by one fixed step. Call at WORLD.dt cadence. */
  step(): void {
    if (this.phase !== 'rolling' || !this.sim) return;
    for (const imp of this.sim.step()) this.emit({ type: 'impact', ...imp });
    if (this.sim.done) this.resolve();
  }

  /** Instantly finish the in-flight shot (fast-forward, network catch-up, headless tests). */
  finishShot(): void {
    while (this.phase === 'rolling') this.step();
  }

  private resolve() {
    const sim = this.sim!;
    const after = sim.resultLayout();
    const log = this.shotLog[this.shotLog.length - 1];
    if (log) log.after = layoutHash(after);
    sim.free();
    this.sim = null;

    const p = this.current;
    const capturedNow: { id: number; x: number; y: number; z: number }[] = [];
    after.targets = after.targets.filter((t) => {
      if (isOutsideRing(t.x, t.z)) {
        capturedNow.push(t);
        return false;
      }
      return true;
    });
    for (const t of capturedNow) {
      this.scores[p]++;
      this.captured[p].push(t.id);
      this.emit({ type: 'capture', player: p, marbleId: t.id, pos: { x: t.x, y: t.y, z: t.z } });
    }

    const shooter = after.shooter;
    const shooterOut = !shooter || isOutsideRing(shooter.x, shooter.z);
    if (shooterOut) this.emit({ type: 'shooterOut', player: p });

    this.layout = after;

    if (this.checkGameOver()) return;

    if (capturedNow.length > 0 && !shooterOut) {
      this.firstShotOfTurn = false;
      this.phase = 'aim';
      this.emit({ type: 'shootAgain', player: p });
      return;
    }

    // Turn passes: the shooter is picked up.
    this.layout = { ...this.layout, shooter: null };
    this.firstShotOfTurn = true;
    this.current = (this.current + 1) % this.config.players.length;
    this.phase = 'aim';
    this.emit({ type: 'turnStart', player: this.current });
  }

  private checkGameOver(): boolean {
    const remaining = this.layout.targets.length;
    const best = Math.max(...this.scores);
    const leaders = this.scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
    const others = this.scores.filter((_, i) => !leaders.includes(i));
    const secondBest = others.length ? Math.max(...others) : -Infinity;
    const locked = leaders.length === 1 && best > secondBest + remaining;
    const reachedTarget = this.config.targetScore !== undefined && best >= this.config.targetScore;
    if (remaining === 0 || locked || reachedTarget) {
      this.phase = 'gameOver';
      this.winners = leaders;
      this.layout = { ...this.layout, shooter: null };
      this.emit({ type: 'gameOver', winners: leaders });
      return true;
    }
    return false;
  }

  /** Position the shooter will be shot from (for the first shot this depends on placeAngle). */
  shooterRestPosition(): { x: number; z: number } | null {
    if (this.firstShotOfTurn || !this.layout.shooter) return null;
    return { x: this.layout.shooter.x, z: this.layout.shooter.z };
  }

  hash(): string {
    return `${layoutHash(this.layout)}:${this.scores.join(',')}:${this.current}`;
  }

  snapshot(): MatchSnapshot {
    return {
      layout: structuredClone(this.layout),
      scores: [...this.scores],
      captured: this.captured.map((c) => [...c]),
      current: this.current,
      firstShotOfTurn: this.firstShotOfTurn,
      shotsTaken: this.shotsTaken,
      phase: this.phase === 'rolling' ? 'aim' : this.phase,
      winners: [...this.winners],
    };
  }

  /** Restore from a snapshot (host → late joiner, or reconnect). */
  restore(s: MatchSnapshot) {
    this.sim?.free();
    this.sim = null;
    this.layout = structuredClone(s.layout);
    this.scores = [...s.scores];
    this.captured = s.captured.map((c) => [...c]);
    this.current = s.current;
    this.firstShotOfTurn = s.firstShotOfTurn;
    this.shotsTaken = s.shotsTaken;
    this.phase = s.phase;
    this.winners = [...s.winners];
  }

  dispose() {
    this.sim?.free();
    this.sim = null;
    this.listeners = [];
  }
}

export { SHOOTER_ID, TARGET_COUNT, WORLD };
