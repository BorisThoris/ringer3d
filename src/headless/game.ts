import { WORLD } from '../core/constants';
import { Match } from '../core/match';
import { initPhysics } from '../core/physics';
import type { MatchEvent, Piece, PlayerInfo, Shot } from '../core/types';
import { ARENAS, type ArenaId } from '../game/arenas';
import { generateMap, type Difficulty, type MapDef } from '../game/maps';

/**
 * Ringer 3D with no screen: a map, a match and the rules, driven one shot at a time. This is
 * what every front end and every agent plugs into: the web and Play Store app (through
 * GameSession), the Steam build (the same bundle in Tauri), the Roblox port (which gets its
 * maps and marbles exported from here) and AI agents (in process, over stdio, or through the
 * `serve` loop). Nothing here touches the DOM, the clock or Math.random.
 */

export interface GameSpec {
  arena?: ArenaId;
  difficulty?: Difficulty;
  /** Same spec, same map and same opening on every machine. */
  seed?: number;
  players: { name: string; marble?: string }[];
  /** First to this many wins at once; otherwise the game ends when the leader can't be caught. */
  targetScore?: number;
  /** No obstacles: an open field. */
  openField?: boolean;
}

/** What an agent sees before it shoots. Plain JSON: it crosses process and language borders. */
export interface Observation {
  version: 1;
  /** The player to move (the one asked to act). */
  you: number;
  players: { name: string }[];
  scores: number[];
  /** Marbles still in the ring. */
  remaining: number;
  /** True: you knuckle down anywhere on the ring line (`placeAngle`). False: you shoot from where your shooter stopped. */
  firstShotOfTurn: boolean;
  /** Your default spot on the ring line (radians). */
  seatAngle: number;
  /** Your shooter, when you shoot again from where it stopped. */
  shooter: { x: number; z: number } | null;
  targets: { id: number; x: number; z: number }[];
  /** The obstacles: walls, posts, bumpers, lumps, ridges, zones, cups. See core/types.ts `Piece`. */
  pieces: Piece[];
  /** Loose or breakable obstacles moved or broken by earlier shots. */
  props: { i: number; x: number; z: number; a: number; broken?: boolean }[];
  arena: { id: ArenaId; name: string; rollDecel: number; friction: number };
  world: { ringRadius: number; boundaryRadius: number; targetRadius: number; shooterRadius: number; maxShotSpeed: number };
  /** The action: a Shot. Angles in radians (0 = +x, counter-clockwise from above); power 0..1; spin -1..1. */
  action: { placeAngle: [number, number]; aimAngle: [number, number]; power: [number, number]; spin: [number, number] };
}

export interface StepResult {
  events: MatchEvent[];
  done: boolean;
  winners: number[];
  scores: number[];
}

export class HeadlessGame {
  readonly spec: Required<Omit<GameSpec, 'targetScore'>> & { targetScore?: number };
  readonly map: MapDef;
  readonly match: Match;
  private pending: MatchEvent[] = [];

  /** Load the physics engine once, then build games synchronously. */
  static async create(spec: GameSpec): Promise<HeadlessGame> {
    await initPhysics();
    return new HeadlessGame(spec);
  }

  constructor(spec: GameSpec) {
    this.spec = {
      arena: spec.arena ?? 'desk',
      difficulty: spec.difficulty ?? 'medium',
      seed: spec.seed ?? 1,
      players: spec.players,
      openField: spec.openField ?? false,
      targetScore: spec.targetScore,
    };
    const { arena, difficulty, seed } = this.spec;
    this.map = this.spec.openField ? { arena, difficulty, seed, name: 'Open field', pieces: [] } : generateMap({ arena, difficulty, seed });
    const players: PlayerInfo[] = spec.players.map((p, i) => ({ id: `p${i}`, name: p.name, marble: p.marble ?? 'ember', kind: 'bot' }));
    this.match = new Match({ players, seed, surface: ARENAS[arena].surface, pieces: this.map.pieces, targetScore: spec.targetScore });
    this.match.on((e) => this.pending.push(e));
    this.match.start();
    this.pending = [];
  }

  get done(): boolean {
    return this.match.phase === 'gameOver';
  }

  get current(): number {
    return this.match.current;
  }

  observe(): Observation {
    const m = this.match;
    const arena = ARENAS[this.spec.arena];
    const TAU = Math.PI * 2;
    return {
      version: 1,
      you: m.current,
      players: this.spec.players.map((p) => ({ name: p.name })),
      scores: [...m.scores],
      remaining: m.remaining,
      firstShotOfTurn: m.firstShotOfTurn,
      seatAngle: m.seatAngle(m.current),
      shooter: m.shooterRestPosition(),
      targets: m.layout.targets.map((t) => ({ id: t.id, x: t.x, z: t.z })),
      pieces: this.map.pieces,
      props: (m.layout.props ?? []).map((p) => ({ ...p })),
      arena: { id: arena.id, name: arena.name, rollDecel: arena.surface.rollDecel, friction: arena.surface.friction },
      world: {
        ringRadius: WORLD.ringRadius,
        boundaryRadius: WORLD.boundaryRadius,
        targetRadius: WORLD.targetRadius,
        shooterRadius: WORLD.shooterRadius,
        maxShotSpeed: WORLD.maxShotSpeed,
      },
      action: { placeAngle: [0, TAU], aimAngle: [-Math.PI, Math.PI], power: [0, 1], spin: [-1, 1] },
    };
  }

  /**
   * Play one shot for the player to move and run it to rest. An illegal shot (no power, game
   * over) changes nothing and comes back with no events.
   */
  act(shot: Shot): StepResult {
    this.pending = [];
    const clean: Shot = {
      placeAngle: finite(shot.placeAngle),
      aimAngle: finite(shot.aimAngle),
      power: Math.min(1, Math.max(0, finite(shot.power))),
      spin: Math.min(1, Math.max(-1, finite(shot.spin))),
    };
    if (this.match.shoot(clean)) this.match.finishShot();
    const events = this.pending;
    this.pending = [];
    return { events, done: this.done, winners: [...this.match.winners], scores: [...this.match.scores] };
  }

  dispose() {
    this.match.dispose();
  }
}

const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
