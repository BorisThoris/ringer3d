/**
 * Shared types. Units are centimetres on the ground plane (x, z); y is up.
 * Nothing in `core/` imports three.js or Rapier, so the rules can be unit
 * tested, run on a lobby server, or replayed without a renderer.
 */

export interface Vec2 {
  x: number;
  z: number;
}

export type MarbleId = string;

/** One playable move. Humans and bots both produce exactly this, nothing more. */
export interface ShotInput {
  /** Shooter start position on the ground plane. */
  from: Vec2;
  /** Aim direction in radians: 0 = +x, PI/2 = +z. */
  yaw: number;
  /** 0..1, mapped to launch speed by the sim. */
  power: number;
  /** -1..1: negative = backspin (stop/draw), positive = topspin (follow). */
  spin: number;
  /** -1..1: side english, curves the shooter slightly after contact. */
  english: number;
}

/**
 * What the physics reports once every body has come to rest. Raw positions
 * only: deciding what is "out" is the rules' job, not the sim's.
 */
export interface ShotOutcome {
  /** Where the shooter came to rest, or null if it left the playfield. */
  shooterPos: Vec2 | null;
  /** Rest position of every target that was in the ring before the shot; null = left the playfield. */
  targets: Record<MarbleId, Vec2 | null>;
}

export interface RingerConfig {
  /** Ring radius in cm. The traditional ring is 10 ft across; casual rings 3-6 ft. */
  ringRadius: number;
  targetRadius: number;
  shooterRadius: number;
  /** Gap between neighbouring marbles in the starting cross, centre to centre. */
  crossSpacing: number;
  /** Number of target marbles (13 is the traditional cross). */
  targetCount: number;
  /**
   * End as soon as one player has more than half the marbles (official
   * tournament Ringer: first to 7 of 13). Off = play until the ring is empty.
   */
  endOnMajority: boolean;
}

export const DEFAULT_CONFIG: RingerConfig = {
  ringRadius: 60,
  targetRadius: 1.2,
  shooterRadius: 1.5,
  crossSpacing: 7.6,
  targetCount: 13,
  endOnMajority: false,
};

export interface PlayerInfo {
  id: string;
  name: string;
  /** Present for bots: the bot profile id used to drive them. */
  botProfile?: string;
}
