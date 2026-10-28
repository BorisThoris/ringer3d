import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { QUANT, TARGET_COUNT, WORLD } from './constants';
import { initialProps, propTraits, type PropPiece, type PropState, type PropTraits } from './props';
import type { Piece, Shot, SurfaceParams, Vec3 } from './types';

let ready: Promise<void> | null = null;

/** Must resolve before any simulation is created. Safe to call repeatedly. */
export function initPhysics(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}

export const SHOOTER_ID = 100;

export interface LayoutMarble {
  id: number;
  x: number;
  y: number;
  z: number;
}

/**
 * The full state of the table between shots. Marbles are always at rest between shots, so
 * positions are all we need. Each shot rebuilds the physics world from a quantized layout,
 * which makes every shot's outcome a pure function of (layout, shot, surface): perfect for
 * peer-to-peer play, replays, reconnects and for bots that "imagine" a shot.
 */
export interface Layout {
  targets: LayoutMarble[];
  shooter: LayoutMarble | null;
  /** Loose and breakable obstacles where the last shot left them. Unset: as the map put them. */
  props?: PropState[];
}

export interface ImpactInfo {
  strength: number;
  pos: Vec3;
  kind: 'marble' | 'kerb' | 'bumper';
}

const q = (v: number, step: number) => Math.round(v / step) * step;
const qPos = (v: number) => Math.round(v * 1e5) / 1e5;

export function quantizeShot(s: Shot): Shot {
  return {
    placeAngle: q(s.placeAngle, QUANT.angle),
    aimAngle: q(s.aimAngle, QUANT.angle),
    power: Math.min(1, Math.max(0, q(s.power, QUANT.power))),
    spin: Math.min(1, Math.max(-1, q(s.spin, QUANT.spin))),
  };
}

export function quantizeLayout(l: Layout): Layout {
  const qm = (m: LayoutMarble): LayoutMarble => ({ id: m.id, x: qPos(m.x), y: qPos(m.y), z: qPos(m.z) });
  const out: Layout = {
    targets: l.targets.map(qm).sort((a, b) => a.id - b.id),
    shooter: l.shooter ? qm(l.shooter) : null,
  };
  if (l.props) {
    out.props = l.props
      .map((p) => ({ i: p.i, x: qPos(p.x), z: qPos(p.z), a: qPos(p.a), ...(p.broken ? { broken: true } : {}) }))
      .sort((a, b) => a.i - b.i);
  }
  return out;
}

/** Classic starting cross: one in the centre and three along each arm. */
export function startingLayout(): Layout {
  const targets: LayoutMarble[] = [];
  const s = WORLD.targetSpacing;
  const y = WORLD.targetRadius;
  targets.push({ id: 0, x: 0, y, z: 0 });
  let id = 1;
  const arms: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [ax, az] of arms) {
    for (let k = 1; k <= 3; k++) targets.push({ id: id++, x: ax * s * k, y, z: az * s * k });
  }
  if (targets.length !== TARGET_COUNT) throw new Error('bad layout');
  return quantizeLayout({ targets, shooter: null });
}

export function placementPoint(placeAngle: number): { x: number; z: number } {
  const r = WORLD.ringRadius + WORLD.shooterRadius + 0.02;
  return { x: Math.cos(placeAngle) * r, z: Math.sin(placeAngle) * r };
}

export function isOutsideRing(x: number, z: number): boolean {
  return Math.hypot(x, z) > WORLD.ringRadius;
}

interface BodyRec {
  id: number;
  body: RAPIER.RigidBody;
  radius: number;
}

/** A loose or breakable obstacle in this shot's world. */
export interface PropRec {
  /** Index in the map's pieces. */
  i: number;
  piece: PropPiece;
  traits: PropTraits;
  body: RAPIER.RigidBody;
  /** Where it started this shot, so a set prop that never moves reports exactly that. */
  start: PropState;
  broken: boolean;
}

/** One shot's worth of physics. Create, step until `done`, read results, `free()`. */
export class ShotSim {
  readonly world: RAPIER.World;
  readonly bodies: BodyRec[] = [];
  private readonly events = new RAPIER.EventQueue(true);
  private readonly colliderKind = new Map<number, 'marble' | 'kerb' | 'ground' | 'piece' | 'bumper'>();
  private readonly marbleOf = new Map<number, BodyRec>();
  private readonly struck = new Set<BodyRec>();
  readonly props: PropRec[] = [];
  private readonly propOf = new Map<number, PropRec>();
  /** Props broken during the last `step` (for effects). */
  readonly broke: PropRec[] = [];
  /** Props broken in earlier shots: no body, passed straight through to the result. */
  private readonly carried: PropState[] = [];
  private breakable = false;
  private readonly preStep = new Map<BodyRec, { x: number; y: number; z: number }>();
  private readonly smashers = new Set<BodyRec>();
  private restCount = 0;
  steps = 0;
  done = false;

  private readonly surface: SurfaceParams;
  private readonly zones: Extract<Piece, { kind: 'zone' }>[];
  private readonly holes: Extract<Piece, { kind: 'hole' }>[];
  /** Marbles that dropped into a cup this shot, and where. */
  readonly holed = new Map<number, { x: number; z: number }>();

  constructor(layout: Layout, surface: SurfaceParams, shot: Shot | null, isFirstShotOfTurn: boolean, pieces: readonly Piece[] = []) {
    this.surface = surface;
    this.zones = pieces.filter((p): p is Extract<Piece, { kind: 'zone' }> => p.kind === 'zone');
    this.holes = pieces.filter((p): p is Extract<Piece, { kind: 'hole' }> => p.kind === 'hole');
    const L = quantizeLayout(layout);
    this.world = new RAPIER.World({ x: 0, y: WORLD.gravity, z: 0 });
    this.world.timestep = WORLD.dt;
    this.world.integrationParameters.numSolverIterations = 8;

    // Ground slab.
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    const gc = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(WORLD.boundaryRadius + 3, 0.5, WORLD.boundaryRadius + 3)
        .setFriction(surface.friction / MARBLE_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setRestitution(0.15)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
      ground,
    );
    this.colliderKind.set(gc.handle, 'ground');

    // The edge of play: the kerb you see, carried on up as a wall you don't, far above the
    // highest hop (about 7 units), so a marble thrown up over the kerb comes back down inside.
    const segs = 48;
    const kerb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const segLen = ((2 * Math.PI * WORLD.boundaryRadius) / segs) * 0.55;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const r = WORLD.boundaryRadius + 0.25;
      const c = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.25, EDGE_H / 2, segLen)
          .setTranslation(Math.cos(a) * r, EDGE_H / 2, Math.sin(a) * r)
          .setRotation(yawQuat(-a))
          .setRestitution(surface.edge.restitution)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setFriction(surface.edge.friction)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(2),
        kerb,
      );
      this.colliderKind.set(c.handle, 'kerb');
    }

    this.addPieces(pieces);
    this.addProps(pieces, L.props ?? initialProps(pieces), surface);

    for (const t of L.targets) this.addMarble(t, WORLD.targetRadius, surface, 2.6);

    let shooter = L.shooter;
    if (shot && isFirstShotOfTurn) {
      const p = placementPoint(shot.placeAngle);
      shooter = { id: SHOOTER_ID, x: qPos(p.x), y: WORLD.shooterRadius, z: qPos(p.z) };
    }
    if (shooter) {
      const rec = this.addMarble({ ...shooter, id: SHOOTER_ID }, WORLD.shooterRadius, surface, 2.6);
      if (shot) launch(rec, quantizeShot(shot));
    }
    if (!shot) this.done = true;
  }

  /** The map's solid pieces: fixed colliders. Zones and holes act in `step`. */
  private addPieces(pieces: readonly Piece[]) {
    if (!pieces.length) return;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const hard = (d: RAPIER.ColliderDesc, restitution: number, friction: number) =>
      d
        .setRestitution(restitution)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setFriction(friction)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2);
    for (const p of pieces) {
      // Props get bodies of their own (addProps).
      if (propTraits(p)) continue;
      let d: RAPIER.ColliderDesc | null = null;
      switch (p.kind) {
        case 'wall':
          d = hard(RAPIER.ColliderDesc.cuboid(p.len / 2, p.h / 2, p.thick / 2), 0.55, 0.3)
            .setTranslation(p.x, p.h / 2, p.z)
            .setRotation(yawQuat(-p.a));
          break;
        case 'post':
          d = hard(RAPIER.ColliderDesc.cylinder(p.h / 2, p.r), 0.5, 0.3).setTranslation(p.x, p.h / 2, p.z);
          break;
        case 'bumper':
          // Rubber with a spring in it: gives back more than it takes.
          d = hard(RAPIER.ColliderDesc.cylinder(BUMPER_H / 2, p.r), BUMPER_BOUNCE, 0.1).setTranslation(p.x, BUMPER_H / 2, p.z);
          break;
        case 'bump':
          // A sphere mostly buried: its cap is the lump a marble rides over.
          d = hard(RAPIER.ColliderDesc.ball(p.r), 0.2, 0.6).setTranslation(p.x, p.r * (1 - 2 * p.sink), p.z);
          break;
        case 'ridge': {
          const dx = p.x2 - p.x1;
          const dz = p.z2 - p.z1;
          const len = Math.hypot(dx, dz);
          if (len < 1e-3) break;
          // A capsule lying flat along the line, sunk so only a sliver stands proud.
          d = hard(RAPIER.ColliderDesc.capsule(len / 2, p.r), 0.2, 0.5)
            .setTranslation((p.x1 + p.x2) / 2, -p.r * 0.35, (p.z1 + p.z2) / 2)
            .setRotation(lyingQuat(Math.atan2(dz, dx)));
          break;
        }
      }
      if (!d) continue;
      const c = this.world.createCollider(d, body);
      this.colliderKind.set(c.handle, p.kind === 'bumper' ? 'bumper' : 'piece');
    }
  }

  /**
   * Loose props are dynamic bodies that stay upright (they slide and turn, never topple);
   * set ones that can only break are fixed. Broken props are simply left out.
   */
  private addProps(pieces: readonly Piece[], states: readonly PropState[], surface: SurfaceParams) {
    for (const s of states) {
      const piece = pieces[s.i] as PropPiece | undefined;
      const traits = piece && propTraits(piece);
      if (!piece || !traits) continue;
      if (s.broken) {
        this.carried.push(s);
        continue;
      }
      const h = piece.h;
      const loose = traits.density !== undefined;
      const desc = (loose ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed())
        .setTranslation(s.x, h / 2, s.z)
        .setRotation(yawQuat(-s.a));
      if (loose) {
        desc
          .enabledRotations(false, true, false)
          // Props drag along the ground and come to rest quickly, whatever the field.
          .setLinearDamping(PROP_DAMPING + surface.linearDamping)
          .setAngularDamping(PROP_DAMPING * 2)
          .setCanSleep(false);
      }
      const body = this.world.createRigidBody(desc);
      const shape =
        piece.kind === 'wall'
          ? RAPIER.ColliderDesc.cuboid(piece.len / 2, h / 2, piece.thick / 2)
          : RAPIER.ColliderDesc.cylinder(h / 2, piece.r);
      shape
        .setRestitution(0.35)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setFriction(PROP_FRICTION)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2);
      if (loose) shape.setDensity(traits.density!);
      const c = this.world.createCollider(shape, body);
      this.colliderKind.set(c.handle, 'piece');
      if (traits.breakAt !== undefined) this.breakable = true;
      const rec: PropRec = { i: s.i, piece, traits, body, start: { ...s }, broken: false };
      this.props.push(rec);
      this.propOf.set(c.handle, rec);
    }
  }

  private addMarble(m: LayoutMarble, radius: number, surface: SurfaceParams, density: number): BodyRec {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(m.x, Math.max(m.y, radius), m.z)
        .setLinearDamping(surface.linearDamping)
        .setAngularDamping(surface.angularDamping)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    const c = this.world.createCollider(
      RAPIER.ColliderDesc.ball(radius)
        .setDensity(density)
        .setFriction(MARBLE_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setRestitution(surface.marbleRestitution)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(8),
      body,
    );
    this.colliderKind.set(c.handle, 'marble');
    const rec = { id: m.id, body, radius };
    this.marbleOf.set(c.handle, rec);
    this.bodies.push(rec);
    return rec;
  }

  /** Advance one fixed step. Returns impacts that happened during the step (for audio/FX). */
  step(): ImpactInfo[] {
    if (this.done) return [];
    this.broke.length = 0;
    // Only needed to undo a bounce off a prop that broke; skipped when nothing can break.
    if (this.breakable) for (const b of this.bodies) this.preStep.set(b, b.body.linvel());
    this.world.step(this.events);
    this.steps++;
    const impacts: ImpactInfo[] = [];
    this.events.drainContactForceEvents((e) => {
      const k1 = this.colliderKind.get(e.collider1());
      const k2 = this.colliderKind.get(e.collider2());
      if (k1 === 'ground' || k2 === 'ground') return;
      const kind = k1 === 'bumper' || k2 === 'bumper' ? 'bumper' : k1 === 'marble' && k2 === 'marble' ? 'marble' : 'kerb';
      const p = this.world.getCollider(e.collider1()).translation();
      impacts.push({ strength: e.totalForceMagnitude(), pos: { x: p.x, y: p.y, z: p.z }, kind });
      if (kind !== 'marble') {
        const m = this.marbleOf.get(e.collider1()) ?? this.marbleOf.get(e.collider2());
        if (m) this.struck.add(m);
      }
      const prop = this.propOf.get(e.collider1()) ?? this.propOf.get(e.collider2());
      const at = prop?.traits.breakAt;
      if (prop && at !== undefined && !prop.broken && e.totalForceMagnitude() > at) {
        prop.broken = true;
        this.broke.push(prop);
        const m = this.marbleOf.get(e.collider1()) ?? this.marbleOf.get(e.collider2());
        if (m) this.smashers.add(m);
      }
    });
    // A broken prop leaves the table at once, and the marble that smashed it punches on
    // through, slowed, instead of bouncing off something that is no longer there.
    for (const p of this.broke) p.body.setEnabled(false);
    for (const m of this.smashers) {
      const v = this.preStep.get(m);
      if (!v) continue;
      const k = SMASH_KEEP;
      m.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
      m.body.setAngvel({ x: (v.z * k) / m.radius, y: 0, z: (-v.x * k) / m.radius }, true);
      this.struck.delete(m);
    }
    this.smashers.clear();
    // An obstacle meets a marble at its middle, so the rebound leaves it rolling the new way.
    // Keeping the old forward roll let ground friction drag it straight back into the
    // obstacle: every bounce died on the spot, as if the hit had been undone.
    for (const b of this.struck) {
      const v = b.body.linvel();
      const w = b.body.angvel();
      b.body.setAngvel({ x: v.z / b.radius, y: w.y, z: -v.x / b.radius }, true);
    }
    this.struck.clear();

    // Safety net: anything that still gets past the edge or under the ground is set down
    // at rest just inside the kerb (out of the ring), instead of falling for the rest of
    // the shot's time.
    for (const b of this.bodies) {
      if (this.holed.has(b.id)) continue;
      const t = b.body.translation();
      const r = Math.hypot(t.x, t.z);
      if (t.y > -0.5 && r < WORLD.boundaryRadius + 0.6) continue;
      const k = r > 1e-6 ? (WORLD.boundaryRadius - 1) / r : 0;
      b.body.setTranslation({ x: r > 1e-6 ? t.x * k : WORLD.boundaryRadius - 1, y: b.radius, z: t.z * k }, true);
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // The ground underfoot: slopes steer, bumps throw fast marbles up, and rolling
    // resistance brings everything to rest (it outweighs every slope, so nothing creeps).
    const S = this.surface;
    const dv = S.rollDecel * WORLD.dt;
    const pull = ROLL_G * WORLD.dt;
    for (const b of this.bodies) {
      if (this.holed.has(b.id)) continue;
      const t = b.body.translation();
      if (t.y > b.radius + 0.03) continue;
      let { x: vx, y: vy, z: vz } = b.body.linvel();
      // A cup takes any marble slow enough to fall in before it reaches the far lip.
      const cup = this.holes.find((h) => (t.x - h.x) ** 2 + (t.z - h.z) ** 2 < (h.r - b.radius * 0.3) ** 2);
      if (cup && vx * vx + vz * vz < HOLE_SPEED * HOLE_SPEED) {
        this.drop(b, cup);
        continue;
      }
      // Patches of different ground under this marble.
      let decel = dv;
      for (const z of this.zones) {
        if ((t.x - z.x) ** 2 + (t.z - z.z) ** 2 > z.r * z.r) continue;
        if (z.effect === 'sticky') decel *= z.k ?? STICKY;
        else if (z.effect === 'slick') decel *= z.k ?? SLICK;
        else {
          vx += Math.cos(z.a) * BOOST * WORLD.dt;
          vz += Math.sin(z.a) * BOOST * WORLD.dt;
        }
      }
      let sx = S.camber.x;
      let sz = S.camber.z;
      if (S.bumps.amp > 0) {
        bumpSlope(t.x, t.z, S.bumps, slope);
        sx += slope.x;
        sz += slope.z;
      }
      // A marble at rest sits in its dimple: slopes only act on moving marbles.
      const sp0 = Math.hypot(vx, vz);
      const hold = Math.min(1, sp0 / SETTLE_SPEED);
      vx -= sx * pull * hold;
      vz -= sz * pull * hold;
      const sp = Math.hypot(vx, vz);
      if (sp <= 0) continue;
      // Rolling uphill over a bump at speed launches the marble a little.
      if (S.hop > 0 && sp > HOP_MIN_SPEED && vy < 0.05 && t.y < b.radius + 0.01) {
        const rise = (sx * vx + sz * vz) / sp;
        if (rise > 0) vy = Math.max(vy, Math.min(HOP_MAX, S.hop * sp * rise));
      }
      const f = Math.max(0, sp - decel) / sp;
      b.body.setLinvel({ x: vx * f, y: vy, z: vz * f }, true);
      const w = b.body.angvel();
      b.body.setAngvel({ x: w.x * f, y: w.y * f, z: w.z * f }, true);
    }

    let resting = true;
    for (const b of this.bodies) {
      if (this.holed.has(b.id)) continue;
      const v = b.body.linvel();
      const w = b.body.angvel();
      if (Math.hypot(v.x, v.y, v.z) > WORLD.restLinear || Math.hypot(w.x, w.y, w.z) > WORLD.restAngular) {
        resting = false;
        break;
      }
    }
    // A shoved prop still sliding keeps the shot going too.
    if (resting) {
      for (const p of this.props) {
        if (p.broken || p.traits.density === undefined) continue;
        const v = p.body.linvel();
        if (Math.hypot(v.x, v.z) > WORLD.restLinear || Math.abs(p.body.angvel().y) > WORLD.restAngular) {
          resting = false;
          break;
        }
      }
    }
    this.restCount = resting ? this.restCount + 1 : 0;
    if (this.restCount >= WORLD.restSteps || this.steps >= WORLD.maxShotSteps) this.done = true;
    return impacts;
  }

  /** The marble drops into the cup and leaves the table. */
  private drop(b: BodyRec, cup: { x: number; z: number }) {
    this.holed.set(b.id, { x: cup.x, z: cup.z });
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    b.body.setTranslation({ x: cup.x, y: -1, z: cup.z }, false);
    b.body.setEnabled(false);
  }

  /** Run to completion (bots, tests, network catch-up). */
  runToEnd(): void {
    while (!this.done) this.step();
  }

  /** Final positions, quantized, ready to be the next layout. */
  resultLayout(): Layout {
    const targets: LayoutMarble[] = [];
    let shooter: LayoutMarble | null = null;
    for (const b of this.bodies) {
      const t = b.body.translation();
      // A holed marble is off the table: report it in a pocket beyond the ring, where
      // the rules already count it as knocked out (or the shooter as gone).
      const m = this.holed.has(b.id) ? { id: b.id, ...POCKET } : { id: b.id, x: t.x, y: t.y, z: t.z };
      if (b.id === SHOOTER_ID) shooter = m;
      else targets.push(m);
    }
    if (!this.props.length && !this.carried.length) return quantizeLayout({ targets, shooter });
    const props: PropState[] = [...this.carried];
    for (const p of this.props) {
      if (p.broken) props.push({ ...p.start, broken: true });
      else if (p.traits.density === undefined) props.push(p.start);
      else {
        const t = p.body.translation();
        const r = p.body.rotation();
        props.push({ i: p.i, x: t.x, z: t.z, a: -2 * Math.atan2(r.y, r.w) });
      }
    }
    return quantizeLayout({ targets, shooter, props });
  }

  free(): void {
    this.world.free();
    this.events.free();
  }
}

const MARBLE_FRICTION = 0.25;
/** Loose props: grip on the ground (scaled by the field's) and how fast they settle. */
const PROP_FRICTION = 0.45;
const PROP_DAMPING = 1.6;
/** Share of its speed a marble keeps after smashing through a breakable prop. */
const SMASH_KEEP = 0.6;
/** A rolling solid sphere accelerates down a slope at 5/7 g. */
const ROLL_G = (5 / 7) * -WORLD.gravity;
/** Below this speed bumps steer but never lift. */
const HOP_MIN_SPEED = 4;
/** Highest lift a bump can give (units/s): about a marble's height in the air. */
const HOP_MAX = 2.6;
/** Below this speed slopes fade out, so marbles come to rest instead of creeping. */
const SETTLE_SPEED = 0.3;

const slope = { x: 0, z: 0 };

/** Map pieces. */
const BUMPER_H = 0.45;
const BUMPER_BOUNCE = 1.25;
/** Faster than this (units/s) a marble rolls straight over a cup's lip. */
const HOLE_SPEED = 7;
const STICKY = 2.2;
const SLICK = 0.2;
/** Speed-pad push (units/s²). */
const BOOST = 22;
/** Height of the wall around the edge of play (the visible kerb is its bottom 1.2). */
const EDGE_H = 14;
/** Where holed marbles are reported: well outside the ring. */
const POCKET = { x: WORLD.boundaryRadius + 4, y: WORLD.targetRadius, z: 0 };

/** Rotation that lays a capsule (axis +Y) flat along the ground at yaw `a` (radians). */
function lyingQuat(a: number) {
  // Tip +Y onto +X (−90° about Z), then turn about Y by −a so +X points along (cos a, sin a).
  const s = Math.SQRT1_2;
  const qz = { x: 0, y: 0, z: -s, w: s };
  const qy = { x: 0, y: Math.sin(-a / 2), z: 0, w: Math.cos(-a / 2) };
  // q = qy * qz
  return {
    x: qy.w * qz.x + qy.x * qz.w + qy.y * qz.z - qy.z * qz.y,
    y: qy.w * qz.y - qy.x * qz.z + qy.y * qz.w + qy.z * qz.x,
    z: qy.w * qz.z + qy.x * qz.y - qy.y * qz.x + qy.z * qz.w,
    w: qy.w * qz.w - qy.x * qz.x - qy.y * qz.y - qy.z * qz.z,
  };
}

/** Integer lattice hash to [-1, 1). Integer maths only: identical on every peer. */
function lattice(ix: number, iz: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;
}

/**
 * Gradient of one octave of value noise at (u, v), in noise units per lattice cell, added
 * into `out`. Quintic fade; only + - * / so the result is bit-identical everywhere.
 */
function noiseGrad(u: number, v: number, w: number, out: { x: number; z: number }) {
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  const fu = u - iu;
  const fv = v - iv;
  const a = lattice(iu, iv);
  const b = lattice(iu + 1, iv);
  const c = lattice(iu, iv + 1);
  const d = lattice(iu + 1, iv + 1);
  const su = fu * fu * fu * (fu * (fu * 6 - 15) + 10);
  const sv = fv * fv * fv * (fv * (fv * 6 - 15) + 10);
  const du = 30 * fu * fu * (fu * (fu - 2) + 1);
  const dvv = 30 * fv * fv * (fv * (fv - 2) + 1);
  out.x += w * du * (b - a + (a - b - c + d) * sv);
  out.z += w * dvv * (c - a + (a - b - c + d) * su);
}

/** Slope (rise over run) of the field's bump surface at (x, z): two octaves, ~`amp` typical. */
export function bumpSlope(x: number, z: number, p: SurfaceParams['bumps'], out: { x: number; z: number }) {
  out.x = 0;
  out.z = 0;
  // Ridges: long along x, short across z.
  const u = x / (p.scale * p.stretch);
  const v = z / p.scale;
  noiseGrad(u, v, 1, out);
  noiseGrad(u * 2.03 + 17.1, v * 2.03 + 5.3, 0.5, out);
  // A cell spans scale·stretch along x but only scale along z.
  const k = p.amp * 0.8;
  out.x *= k / p.stretch;
  out.z *= k;
}

function yawQuat(a: number) {
  return { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) };
}

function launch(rec: BodyRec, shot: Shot) {
  const speed = shot.power * WORLD.maxShotSpeed;
  const dx = Math.cos(shot.aimAngle);
  const dz = Math.sin(shot.aimAngle);
  rec.body.setLinvel({ x: dx * speed, y: 0, z: dz * speed }, true);
  // Rolling-without-slipping angular velocity is (v / r) * (up × dir).
  // up × dir = (0,1,0) × (dx,0,dz) = (dz, 0, -dx).
  const k = (speed / rec.radius) * shot.spin * 1.0;
  rec.body.setAngvel({ x: dz * k, y: 0, z: -dx * k }, true);
}

/** Compact fingerprint of a layout, used to detect peer desyncs. */
export function layoutHash(l: Layout): string {
  let h = 2166136261;
  const mix = (n: number) => {
    h ^= Math.round(n * 1e4) | 0;
    h = Math.imul(h, 16777619);
  };
  for (const t of l.targets) {
    mix(t.id);
    mix(t.x);
    mix(t.z);
  }
  if (l.shooter) {
    mix(l.shooter.x);
    mix(l.shooter.z);
  }
  for (const p of l.props ?? []) {
    mix(p.i);
    mix(p.x);
    mix(p.z);
    mix(p.a);
    mix(p.broken ? 1 : 0);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
