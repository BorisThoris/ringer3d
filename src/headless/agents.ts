import { planBotShot } from '../ai/bot';
import { BOT_PROFILES } from '../ai/profiles';
import { ARENAS } from '../game/arenas';
import { hashString, Rng } from '../core/rng';
import type { Shot } from '../core/types';
import { HeadlessGame, type GameSpec, type Observation } from './game';

/**
 * Anything that can take a shot: the built-in bots, a random player, a person at a keyboard,
 * a program in another language (see node.ts `stdioAgent`), a learning agent.
 */
export interface Agent {
  readonly name: string;
  act(obs: Observation): Shot | Promise<Shot>;
  /** Told when a game ends. */
  end?(result: MatchResult, seat: number): void | Promise<void>;
  close?(): void | Promise<void>;
}

/** One of the game's own bots (rookie ... legend), deterministic for a given seed. */
export function botAgent(profileId: string, seed = 1): Agent {
  const profile = BOT_PROFILES[profileId];
  if (!profile) throw new Error(`no bot profile "${profileId}" (have: ${Object.keys(BOT_PROFILES).join(', ')})`);
  const rng = new Rng(hashString(`bot:${profileId}:${seed}`));
  return {
    name: `bot:${profileId}`,
    act(obs) {
      const surface = ARENAS[obs.arena.id].surface;
      return planBotShot(
        {
          layout: {
            targets: obs.targets.map((t) => ({ ...t, y: 0 })),
            shooter: obs.shooter ? { id: 100, x: obs.shooter.x, y: 0, z: obs.shooter.z } : null,
            props: obs.props,
          },
          firstShotOfTurn: obs.firstShotOfTurn,
          seatAngle: obs.seatAngle,
          surface,
          pieces: obs.pieces,
        },
        profile,
        rng,
      );
    },
  };
}

/** Shoots roughly at the middle with random power: a baseline every agent should beat. */
export function randomAgent(seed = 1): Agent {
  const rng = new Rng(hashString(`random:${seed}`));
  return {
    name: 'random',
    act(obs) {
      const from = obs.shooter ?? { x: Math.cos(obs.seatAngle) * obs.world.ringRadius, z: Math.sin(obs.seatAngle) * obs.world.ringRadius };
      const toCentre = Math.atan2(-from.z, -from.x);
      return { placeAngle: obs.seatAngle, aimAngle: toCentre + rng.range(-0.35, 0.35), power: rng.range(0.35, 0.9), spin: 0 };
    },
  };
}

export interface MatchResult {
  winners: number[];
  scores: number[];
  shots: number;
  map: string;
  seed: number;
  /** Every shot as played: enough to replay the match exactly. */
  log: { player: number; shot: Shot }[];
}

/** Play a whole match between agents (one per seat). */
export async function playMatch(spec: Omit<GameSpec, 'players'>, agents: Agent[], maxShots = 400): Promise<MatchResult> {
  const game = await HeadlessGame.create({ ...spec, players: agents.map((a) => ({ name: a.name })) });
  const log: MatchResult['log'] = [];
  try {
    while (!game.done && log.length < maxShots) {
      const seat = game.current;
      let shot = await agents[seat].act(game.observe());
      // A shot that changes nothing (no power) would loop forever: it becomes a nudge.
      if (!game.act(shot).events.length) {
        shot = { placeAngle: shot?.placeAngle ?? 0, aimAngle: shot?.aimAngle ?? 0, power: 0.05, spin: 0 };
        game.act(shot);
      }
      log.push({ player: seat, shot });
    }
    const result: MatchResult = { winners: [...game.match.winners], scores: [...game.match.scores], shots: log.length, map: game.map.name, seed: game.spec.seed, log };
    for (let i = 0; i < agents.length; i++) await agents[i].end?.(result, i);
    return result;
  } finally {
    game.dispose();
  }
}
