/**
 * Marble physics on Rapier. The outside world speaks centimetres (see
 * core/types); internally the sim runs in metres, which is the scale
 * Rapier's contact tolerances are tuned for.
 *
 * Multiplayer note: Rapier's compat build is not guaranteed bit-identical
 * across machines, so the network layer must not rely on lockstep. Peers
 * replay the shot locally for the visuals and the host's settled positions
 * win (see `applyRest`).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { MarbleId, RingerConfig, ShotInput, ShotOutcome, Vec2 } from '../core/types';

const CM = 0.01;
const STEP = 1 / 240;
/** Launch speed at power 0 and power 1, cm/s. */
export const MIN_SPEED = 40;
export const MAX_SPEED = 380;

export interface Surface {
  /** Rolling resistance as a deceleration, cm/s^2. Carpet high, pavement low. */
  rollingDecel: number;
  /** Sliding friction coefficient against the ground. */
  friction: number;
  restitution: number;
}

export const SURFACES = {
  dirt: { rollingDecel: 150, friction: 0.55, restitution: 0.25 },
  pavement: { rollingDecel: 95, friction: 0.45, restitution: 0.4 },
  carpet: { rollingDecel: 210, friction: 0.7, restitution: 0.15 },
} satisfies Record<string, Surface>;

export type SurfaceKind = keyof typeof SURFACES;

export const SHOOTER_ID = 'shooter';

export interface BodyPose {
  id: MarbleId;
  radius: number;
  /** cm */
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface HitEvent {
  a: MarbleId;
  b: MarbleId | 'ground';
  /** Approach speed, cm/s: drives sound volume and camera shake. */
  speed: number;
  x: number;
  z: number;
}

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

/** Speed in cm/s the shooter leaves the hand at for a given power. */
export function launchSpeed(power: number): number {
  return MIN_SPEED + Math.max(0, Math.min(1, power)) * (MAX_SPEED - MIN_SPEED);
}

/** How far a rolling marble travels from `speed` before stopping, cm. Ignores collisions. */
export function rollDistance(speed: number, surface: Surface): number {
  return (speed * speed) / (2 * surface.rollingDecel);
}

export class MarbleSim {
  private world: RAPIER.World;
  private bodies = new Map<MarbleId, { body: RAPIER.RigidBody; radius: number }>();
  private handleToId = new Map<number, MarbleId>();
  private groundHandle: number;
  private events: RAPIER.EventQueue;
  private accumulator = 0;
  private stillSteps = 0;
  private elapsed = 0;
  private lost = new Set<MarbleId>();
  private lastHits: HitEvent[] = [];
  /** Beyond this distance from the centre a marble has left the playfield, cm. */
  readonly playfieldRadius: number;

  constructor(readonly config: RingerConfig, readonly surface: Surface) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.events = new RAPIER.EventQueue(true);
    this.playfieldRadius = config.ringRadius * 2.4;
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    const groundCol = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(20, 0.5, 20)
        .setFriction(surface.friction)
        .setRestitution(surface.restitution)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      ground,
    );
    this.groundHandle = groundCol.handle;
  }

  /** Put the board in a known state: targets at rest, shooter at `shooter` (or off the board). */
  setup(targets: Record<MarbleId, Vec2>, shooter: Vec2 | null): void {
    for (const { body } of this.bodies.values()) this.world.removeRigidBody(body);
    this.bodies.clear();
    this.handleToId.clear();
    this.lost.clear();
    for (const [id, p] of Object.entries(targets)) this.addMarble(id, p, this.config.targetRadius);
    if (shooter) this.addMarble(SHOOTER_ID, shooter, this.config.shooterRadius);
  }

  private addMarble(id: MarbleId, p: Vec2, radiusCm: number): void {
    const r = radiusCm * CM;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x * CM, r, p.z * CM)
        .setCcdEnabled(true)
        .setAngularDamping(0.05)
        .setCanSleep(false),
    );
    const col = this.world.createCollider(
      // Glass: 2.5 g/cm^3. Bouncy against glass, and the ground collider sets
      // its own friction/restitution which averages with these.
      RAPIER.ColliderDesc.ball(r)
        .setDensity(2500)
        .setRestitution(0.88)
        .setFriction(0.15)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.bodies.set(id, { body, radius: radiusCm });
    this.handleToId.set(col.handle, id);
  }

  /** Move the shooter (aiming, knuckling down) without starting a shot. */
  placeShooter(p: Vec2): void {
    const s = this.bodies.get(SHOOTER_ID);
    if (!s) return this.addMarble(SHOOTER_ID, p, this.config.shooterRadius);
    s.body.setTranslation({ x: p.x * CM, y: s.radius * CM, z: p.z * CM }, true);
    s.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    s.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  removeShooter(): void {
    const s = this.bodies.get(SHOOTER_ID);
    if (!s) return;
    this.world.removeRigidBody(s.body);
    this.bodies.delete(SHOOTER_ID);
  }

  shoot(shot: ShotInput): void {
    this.placeShooter(shot.from);
    const s = this.bodies.get(SHOOTER_ID)!;
    const v = launchSpeed(shot.power) * CM;
    const dx = Math.cos(shot.yaw);
    const dz = Math.sin(shot.yaw);
    const r = s.radius * CM;
    s.body.setLinvel({ x: dx * v, y: 0, z: dz * v }, true);
    // Natural roll for velocity v is w = (vz, 0, -vx) / r. A thumb flick leaves
    // the marble mostly sliding; spin adds over- or back-spin on top, english
    // spins it about the vertical axis.
    const roll = (v / r) * 1.6 * shot.spin;
    s.body.setAngvel({ x: dz * roll, y: shot.english * 60, z: -dx * roll }, true);
    this.stillSteps = 0;
    this.elapsed = 0;
    this.accumulator = 0;
  }

  /** Advance by real time; runs whole fixed steps. Returns hits since the last call. */
  advance(dt: number): HitEvent[] {
    this.accumulator += Math.min(dt, 0.1);
    this.lastHits = [];
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      this.stepOnce();
    }
    return this.lastHits;
  }

  /** Run until everything rests (or the time cap); for bots' lag and tests. */
  runToRest(maxSeconds = 20): void {
    const steps = Math.ceil(maxSeconds / STEP);
    for (let i = 0; i < steps && !this.settled(); i++) this.stepOnce();
    this.freeze();
  }

  private stepOnce(): void {
    this.applyRollingResistance();
    this.world.step(this.events);
    this.elapsed += STEP;
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.handleToId.get(h1) ?? (h1 === this.groundHandle ? 'ground' : undefined);
      const b = this.handleToId.get(h2) ?? (h2 === this.groundHandle ? 'ground' : undefined);
      if (!a || !b || a === 'ground') return;
      const ba = this.bodies.get(a)!.body;
      const va = ba.linvel();
      const vb = b === 'ground' ? { x: 0, y: 0, z: 0 } : this.bodies.get(b)!.body.linvel();
      const speed = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z) / CM;
      if (b === 'ground' && speed < 15) return;
      const t = ba.translation();
      this.lastHits.push({ a, b, speed, x: t.x / CM, z: t.z / CM });
    });
    this.cullLost();
    let moving = false;
    for (const { body } of this.bodies.values()) {
      const v = body.linvel();
      if (Math.hypot(v.x, v.y, v.z) > 0.004) moving = true;
    }
    this.stillSteps = moving ? 0 : this.stillSteps + 1;
  }

  /**
   * Rapier has no rolling resistance, so marbles on a flat plane would roll
   * forever. Remove a fixed deceleration from each grounded marble and keep
   * the spin consistent with it.
   */
  private applyRollingResistance(): void {
    const dv = this.surface.rollingDecel * CM * STEP;
    for (const { body, radius } of this.bodies.values()) {
      const t = body.translation();
      if (t.y > radius * CM * 1.15) continue;
      const v = body.linvel();
      const speed = Math.hypot(v.x, v.z);
      const k = speed > dv ? (speed - dv) / speed : 0;
      body.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true);
      const w = body.angvel();
      const wk = speed > dv ? k : 0.6;
      body.setAngvel({ x: w.x * wk, y: w.y * 0.985, z: w.z * wk }, true);
    }
  }

  private cullLost(): void {
    for (const [id, { body }] of this.bodies) {
      const t = body.translation();
      if (Math.hypot(t.x, t.z) / CM > this.playfieldRadius || t.y < -0.2) {
        this.world.removeRigidBody(body);
        this.bodies.delete(id);
        this.lost.add(id);
      }
    }
  }

  /** At rest: nothing has moved for a quarter second, or the 15 s cap has passed. */
  settled(): boolean {
    return this.stillSteps > 60 || this.elapsed > 15;
  }

  private freeze(): void {
    for (const { body } of this.bodies.values()) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  outcome(targetIds: MarbleId[]): ShotOutcome {
    this.freeze();
    const targets: Record<MarbleId, Vec2 | null> = {};
    for (const id of targetIds) targets[id] = this.lost.has(id) ? null : this.pos(id);
    return { shooterPos: this.lost.has(SHOOTER_ID) ? null : this.pos(SHOOTER_ID), targets };
  }

  pos(id: MarbleId): Vec2 | null {
    const b = this.bodies.get(id);
    if (!b) return null;
    const t = b.body.translation();
    return { x: t.x / CM, z: t.z / CM };
  }

  /** Remove targets that the rules took off the board (knocked out). */
  removeMarbles(ids: MarbleId[]): void {
    for (const id of ids) {
      const b = this.bodies.get(id);
      if (!b) continue;
      this.world.removeRigidBody(b.body);
      this.bodies.delete(id);
    }
  }

  /** Snap to authoritative rest positions (network host), keeping rotations. */
  applyRest(positions: Record<MarbleId, Vec2>): void {
    for (const [id, p] of Object.entries(positions)) {
      const b = this.bodies.get(id);
      if (!b) continue;
      b.body.setTranslation({ x: p.x * CM, y: b.radius * CM, z: p.z * CM }, true);
    }
    this.freeze();
  }

  poses(): BodyPose[] {
    const out: BodyPose[] = [];
    for (const [id, { body, radius }] of this.bodies) {
      const t = body.translation();
      const q = body.rotation();
      out.push({ id, radius, x: t.x / CM, y: t.y / CM, z: t.z / CM, qx: q.x, qy: q.y, qz: q.z, qw: q.w });
    }
    return out;
  }

  dispose(): void {
    this.events.free();
    this.world.free();
  }
}
