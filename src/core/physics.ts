import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { QUANT, TARGET_COUNT, WORLD } from './constants';
import type { Shot, SurfaceParams, Vec3 } from './types';

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
}

export interface ImpactInfo {
  strength: number;
  pos: Vec3;
  kind: 'marble' | 'kerb';
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
  return {
    targets: l.targets.map(qm).sort((a, b) => a.id - b.id),
    shooter: l.shooter ? qm(l.shooter) : null,
  };
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

/** One shot's worth of physics. Create, step until `done`, read results, `free()`. */
export class ShotSim {
  readonly world: RAPIER.World;
  readonly bodies: BodyRec[] = [];
  private readonly events = new RAPIER.EventQueue(true);
  private readonly colliderKind = new Map<number, 'marble' | 'kerb' | 'ground'>();
  private restCount = 0;
  steps = 0;
  done = false;

  private readonly surface: SurfaceParams;

  constructor(layout: Layout, surface: SurfaceParams, shot: Shot | null, isFirstShotOfTurn: boolean) {
    this.surface = surface;
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

    // Kerb ring so nothing escapes the arena.
    const segs = 48;
    const kerb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const segLen = ((2 * Math.PI * WORLD.boundaryRadius) / segs) * 0.55;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const r = WORLD.boundaryRadius + 0.25;
      const c = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.25, 0.6, segLen)
          .setTranslation(Math.cos(a) * r, 0.6, Math.sin(a) * r)
          .setRotation(yawQuat(-a))
          .setRestitution(0.5)
          .setFriction(0.2)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(2),
        kerb,
      );
      this.colliderKind.set(c.handle, 'kerb');
    }

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
    this.bodies.push(rec);
    return rec;
  }

  /** Advance one fixed step. Returns impacts that happened during the step (for audio/FX). */
  step(): ImpactInfo[] {
    if (this.done) return [];
    this.world.step(this.events);
    this.steps++;
    const impacts: ImpactInfo[] = [];
    this.events.drainContactForceEvents((e) => {
      const k1 = this.colliderKind.get(e.collider1());
      const k2 = this.colliderKind.get(e.collider2());
      if (k1 === 'ground' || k2 === 'ground') return;
      const kind = k1 === 'kerb' || k2 === 'kerb' ? 'kerb' : 'marble';
      const p = this.world.getCollider(e.collider1()).translation();
      impacts.push({ strength: e.totalForceMagnitude(), pos: { x: p.x, y: p.y, z: p.z }, kind });
    });

    // Rolling resistance: constant deceleration while touching the ground.
    const dv = this.surface.rollDecel * WORLD.dt;
    for (const b of this.bodies) {
      const t = b.body.translation();
      if (t.y > b.radius + 0.03) continue;
      const v = b.body.linvel();
      const sp = Math.hypot(v.x, v.z);
      if (sp <= 0) continue;
      const f = Math.max(0, sp - dv) / sp;
      b.body.setLinvel({ x: v.x * f, y: v.y, z: v.z * f }, true);
      const w = b.body.angvel();
      b.body.setAngvel({ x: w.x * f, y: w.y * f, z: w.z * f }, true);
    }

    let resting = true;
    for (const b of this.bodies) {
      const v = b.body.linvel();
      const w = b.body.angvel();
      if (Math.hypot(v.x, v.y, v.z) > WORLD.restLinear || Math.hypot(w.x, w.y, w.z) > WORLD.restAngular) {
        resting = false;
        break;
      }
    }
    this.restCount = resting ? this.restCount + 1 : 0;
    if (this.restCount >= WORLD.restSteps || this.steps >= WORLD.maxShotSteps) this.done = true;
    return impacts;
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
      const m = { id: b.id, x: t.x, y: t.y, z: t.z };
      if (b.id === SHOOTER_ID) shooter = m;
      else targets.push(m);
    }
    return quantizeLayout({ targets, shooter });
  }

  free(): void {
    this.world.free();
    this.events.free();
  }
}

const MARBLE_FRICTION = 0.25;

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
  return (h >>> 0).toString(16).padStart(8, '0');
}
