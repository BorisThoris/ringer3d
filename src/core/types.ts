export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Everything needed to reproduce a shot. This is the only thing peers exchange during play:
 * every client runs the same deterministic simulation from it.
 */
export interface Shot {
  /** Only used on the first shot of a turn: where on the ring line the player knuckles down (radians). */
  placeAngle: number;
  /** Direction of travel on the ground plane (radians, 0 = +X, counter-clockwise seen from above). */
  aimAngle: number;
  /** 0..1 */
  power: number;
  /** -1 (backspin / "stick") .. 0 (stun / slide) .. 1 (topspin / "follow"). */
  spin: number;
}

export type Phase = 'aim' | 'rolling' | 'gameOver';

export interface PlayerInfo {
  id: string;
  name: string;
  /** Marble cosmetic id from game/marbles.ts */
  marble: string;
  kind: 'human' | 'bot' | 'remote';
  botProfile?: string;
}

export interface MarbleState {
  id: number;
  pos: Vec3;
  /** Quaternion x,y,z,w */
  rot: [number, number, number, number];
  inPlay: boolean;
}

export interface SurfaceParams {
  /** Linear damping — rolling resistance of the surface. */
  linearDamping: number;
  /** Angular damping. */
  angularDamping: number;
  /** Coulomb friction between marble and ground. */
  friction: number;
  /** Marble-to-marble restitution. */
  marbleRestitution: number;
  /** Constant rolling-resistance deceleration (units/s²) applied to grounded marbles. */
  rollDecel: number;
  /**
   * The ground is never perfectly flat. A deterministic bump field steers slow rolls:
   * `amp` is the steepest slope (rise over run), `scale` the bump size in units, and
   * `stretch` > 1 squashes bumps across z into long ridges (sand ripples).
   */
  bumps: { amp: number; scale: number; stretch: number };
  /** Constant tilt of the whole field (rise over run along x and z): a road's camber. */
  camber: { x: number; z: number };
  /** Fast marbles hop over bumps: fraction of the bump slope turned into lift. 0 = never. */
  hop: number;
  /** What stops marbles past the ring: a hard kerb bounces them back, a snowbank or long grass swallows them. */
  edge: { restitution: number; friction: number };
}

export const DEFAULT_SURFACE: SurfaceParams = {
  linearDamping: 0.08,
  angularDamping: 0.3,
  friction: 0.6,
  marbleRestitution: 0.93,
  rollDecel: 11,
  bumps: { amp: 0, scale: 1, stretch: 1 },
  camber: { x: 0, z: 0 },
  hop: 0,
  edge: { restitution: 0.5, friction: 0.2 },
};

/**
 * One thing placed on a map. All coordinates are world units on the ground plane; angles in
 * radians. Pieces are plain data so a host can send a whole map to its peers.
 *  wall    a block (book, kerb stone, fence plank): bounces marbles, blocks lines
 *  post    a round stake or bollard
 *  bumper  a rubber ring that throws marbles back harder than they came
 *  bump    a rounded lump sunk into the ground (pebble, molehill, coin): marbles ride over it
 *          and come off line; `sink` is how much of the sphere is buried (0..1)
 *  ridge   a low raised line (ice crack, concrete crack, pencil) that kicks marbles that cross it
 *  zone    a patch of different ground: sticky (mud, sand trap), slick (puddle, black ice) or
 *          boost (a speed pad pushing along `a`)
 *  hole    a cup: a slow marble drops in (a mib counts as knocked out; a shooter ends the turn),
 *          a fast one skims across the lip
 * `skin` says what the piece is (a book, a rock, a puddle) and only changes how it looks.
 * A zone's `k` scales its effect (how sticky the mud, how slick the paper).
 */
export type Piece = (
  | { kind: 'wall'; x: number; z: number; len: number; thick: number; h: number; a: number }
  | { kind: 'post'; x: number; z: number; r: number; h: number }
  | { kind: 'bumper'; x: number; z: number; r: number }
  | { kind: 'bump'; x: number; z: number; r: number; sink: number }
  | { kind: 'ridge'; x1: number; z1: number; x2: number; z2: number; r: number }
  | { kind: 'zone'; x: number; z: number; r: number; effect: 'sticky' | 'slick' | 'boost'; a: number; k?: number }
  | { kind: 'hole'; x: number; z: number; r: number }
) & { skin?: string };

export type MatchEvent =
  | { type: 'shot'; player: number; shot: Shot }
  | { type: 'impact'; strength: number; pos: Vec3; kind: 'marble' | 'kerb' | 'bumper' }
  | { type: 'capture'; player: number; marbleId: number; pos: Vec3 }
  | { type: 'shooterOut'; player: number }
  | { type: 'shootAgain'; player: number }
  | { type: 'turnStart'; player: number }
  | { type: 'gameOver'; winners: number[] };
