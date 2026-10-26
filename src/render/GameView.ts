import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { WORLD } from '../core/constants';
import { placementPoint, SHOOTER_ID, type Layout } from '../core/physics';
import type { Match } from '../core/match';
import { ARENAS, type ArenaId } from '../game/arenas';
import { MIB_LOOKS, uiColor, type MarbleLook } from '../game/marbles';
import { buildArena, type BuiltArena } from './arenaBuilder';
import { buildMarble, disposeObject, type Quality } from './marbleMesh';
import { Juice } from './juice';
import { buildPieces, type BuiltPieces } from './mapPieces';
import type { Piece } from '../core/types';
import { SurfaceFx, type Mover } from './surfaceFx';
import { radialGlowTexture } from './textures';

export type CamMode = 'attract' | 'aim' | 'top' | 'follow' | 'overview';

export interface AimView {
  placeAngle: number;
  aimAngle: number;
  power: number;
  spin: number;
  firstShot: boolean;
  /** Show the dotted guide (0 = none). Units of world length. */
  guideLength: number;
  /** Whether the local player may drag the shooter around the ring. */
  canPlace: boolean;
}

interface Burst {
  points: THREE.Points;
  vel: Float32Array;
  life: number;
}

interface Leaving {
  obj: THREE.Object3D;
  t: number;
}

const R = WORLD.ringRadius;
/** Camera-distance fog: clear over the whole field, gone by the far bank. */
const FOG_NEAR = 24;
const FOG_FAR = 46;
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private container: HTMLElement;
  private arena: BuiltArena | null = null;
  private arenaId: ArenaId | null = null;
  private pmrem: THREE.PMREMGenerator;
  private envTex: THREE.Texture | null = null;
  quality: Quality;

  private marbleRoot = new THREE.Group();
  private targetMeshes = new Map<number, THREE.Group>();
  private shooterMeshes: THREE.Group[] = [];
  private activeShooter: THREE.Group | null = null;
  /** Ground caustic for each glass marble (kept flat, follows position only). */
  private caustics = new Map<THREE.Object3D, THREE.Mesh>();
  private sunDir = new THREE.Vector3(0, 1, 0);
  private causticStrength = 1;
  private visualQuat = new Map<number, THREE.Quaternion>();
  private prevBodyQuat = new Map<number, THREE.Quaternion>();
  private lastSim: unknown = null;
  private leaving: Leaving[] = [];
  private bursts: Burst[] = [];
  /** Sand spray and grooves, grass clippings, ice scratches, concrete dust. */
  private surfaceFx: SurfaceFx;
  private movers: Mover[] = [];
  /** Streaks, shockwaves, camera trauma. */
  private juice: Juice;
  /** This match's map pieces (obstacles, hazards, cups). */
  private pieces: BuiltPieces | null = null;
  private mapDef: readonly Piece[] | null = null;
  /** Game-time rate the session is playing at (slow motion < 1); effects follow it. */
  timeScale = 1;
  private baseFov = 48;
  private camTarget = new THREE.Vector3();
  private tmpColor = new THREE.Color();

  private match: Match | null = null;
  private looks: MarbleLook[] = [];
  aim: AimView | null = null;

  // Aim guide
  private guide = new THREE.Group();
  private guideLine1: THREE.Mesh;
  private guideLine2: THREE.Mesh;
  private guideLine3: THREE.Mesh;
  private ghost: THREE.Mesh;
  private chargeRing: THREE.Mesh;
  private placeArc: THREE.Mesh;

  // Camera rig
  camMode: CamMode = 'attract';
  userPitch = 0.62;
  /**
   * Slide the picture sideways (fraction of the width) so the ring sits in the open space
   * beside a menu column instead of behind it. Eased, so it glides when screens change.
   */
  frameShift = 0;
  private shiftNow = 0;
  userZoom = 1;
  private cam = { tx: 0, ty: 0, tz: 0, yaw: 0.8, pitch: 0.6, dist: 14 };
  private lastYaw = 0.8;

  private clock = new THREE.Clock();
  private elapsed = 0;
  private raf = 0;
  /** Called every frame before rendering with the real frame delta (seconds). */
  onTick: ((dt: number) => void) | null = null;
  private resizeObs: ResizeObserver;

  constructor(container: HTMLElement, quality: Quality) {
    this.container = container;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 400);
    this.scene.add(this.marbleRoot);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.surfaceFx = new SurfaceFx(this.scene);
    this.juice = new Juice(this.scene);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // Guide meshes
    const lineMat = (opacity: number) =>
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity, depthWrite: false });
    const lineGeo = new THREE.BoxGeometry(1, 0.008, 1);
    lineGeo.translate(0.5, 0, 0);
    this.guideLine1 = new THREE.Mesh(lineGeo, lineMat(0.85));
    this.guideLine2 = new THREE.Mesh(lineGeo, lineMat(0.6));
    this.guideLine3 = new THREE.Mesh(lineGeo, lineMat(0.35));
    this.ghost = new THREE.Mesh(
      new THREE.RingGeometry(WORLD.shooterRadius * 0.92, WORLD.shooterRadius, 40),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.ghost.rotation.x = -Math.PI / 2;
    this.chargeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.27, 0.295, 64),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.chargeRing.rotation.x = -Math.PI / 2;
    // A bright band along the ring line either side of the shooter: "you can slide along here".
    this.placeArc = new THREE.Mesh(
      new THREE.RingGeometry(R - 0.035, R + 0.035, 64, 1, -0.32, 0.64),
      new THREE.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.placeArc.rotation.x = -Math.PI / 2;
    this.placeArc.position.y = 0.012;
    this.guide.add(this.guideLine1, this.guideLine2, this.guideLine3, this.ghost, this.chargeRing, this.placeArc);
    this.guide.renderOrder = 5;
    this.guide.traverse((o) => (o.renderOrder = 5));
    this.scene.add(this.guide);
    this.guide.visible = false;

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop();
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
    this.renderer.shadowMap.enabled = q !== 'low';
    const id = this.arenaId;
    this.arenaId = null;
    if (id) this.loadArena(id);
    this.setMap(this.mapDef);
    if (this.match) this.bindMatch(this.match, this.looks);
    this.resize();
  }

  loadArena(id: ArenaId) {
    if (this.arenaId === id) return;
    this.arenaId = id;
    const def = ARENAS[id];
    if (this.arena) {
      this.scene.remove(this.arena.root);
      this.arena.dispose();
    }
    // A new field clears the old map; the session lays the next one.
    const keep = this.mapDef;
    this.setMap(null);
    this.mapDef = keep;
    const built = buildArena(def, this.quality);
    this.arena = built;
    this.scene.add(built.root);
    // Beyond the edge of play the world fades into fog: the ring is the whole stage.
    this.scene.fog = new THREE.Fog(built.fog, FOG_NEAR, FOG_FAR);
    this.scene.background = built.fog;
    this.renderer.toneMappingExposure = def.exposure;
    this.surfaceFx.setSurface(def.surfaceKind);
    // Gradient reflections until the field's HDRI arrives, then the real place.
    this.envTex?.dispose();
    this.envTex = this.pmrem.fromScene(built.envScene, 0.02).texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = def.envIntensity;
    void built.sky.then(({ hdr }) => {
      if (this.arena !== built || !hdr) return;
      this.envTex?.dispose();
      this.envTex = this.pmrem.fromEquirectangular(hdr).texture;
      this.scene.environment = this.envTex;
    });
    this.sunDir.set(...def.sun.dir).normalize();
    // Overcast fields throw weaker sunlight caustics.
    this.causticStrength = Math.min(1, def.sun.intensity / 3);
    // A whisper of glow on the hottest highlights only (glints, the shockwaves), never a
    // haze over sunlit string, chalk or wet ice.
    this.bloom.strength = 0.12;
    this.bloom.radius = 0.25;
    this.bloom.threshold = 0.96;
    this.bloom.enabled = this.quality !== 'low';
  }

  /** Lay out a map's pieces on the current field (null clears them). */
  setMap(pieces: readonly Piece[] | null) {
    this.mapDef = pieces;
    if (this.pieces) {
      this.scene.remove(this.pieces.group);
      this.pieces.dispose();
      this.pieces = null;
    }
    if (!pieces?.length || !this.arenaId) return;
    this.pieces = buildPieces(pieces, this.arenaId, this.quality);
    this.scene.add(this.pieces.group);
  }

  /** Attach a match: builds marble meshes for the 13 mibs and each player's shooter. */
  bindMatch(match: Match, looks: MarbleLook[]) {
    this.clearMarbles();
    this.surfaceFx.clear();
    this.juice.clear();
    this.match = match;
    this.looks = looks;
    for (const t of match.layout.targets) {
      const look = MIB_LOOKS[(t.id * 5) % MIB_LOOKS.length];
      const m = this.addMarble(look, WORLD.targetRadius, t.id * 1.37 + 0.5);
      m.position.set(t.x, t.y, t.z);
      this.targetMeshes.set(t.id, m);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(t.id, t.id * 2.1, t.id * 0.7));
      this.visualQuat.set(t.id, q);
    }
    this.shooterMeshes = looks.map((look, i) => {
      const m = this.addMarble(look, WORLD.shooterRadius, i + 7);
      m.visible = false;
      return m;
    });
    this.visualQuat.set(SHOOTER_ID, new THREE.Quaternion());
    this.lastSim = null;
  }

  private addMarble(look: MarbleLook, radius: number, seed: number): THREE.Group {
    const { group, caustic } = buildMarble(look, radius, this.quality, seed);
    this.marbleRoot.add(group);
    if (caustic && this.quality !== 'low') {
      this.marbleRoot.add(caustic);
      this.caustics.set(group, caustic);
    }
    return group;
  }

  private removeMarble(g: THREE.Object3D) {
    this.marbleRoot.remove(g);
    disposeObject(g);
    const c = this.caustics.get(g);
    if (c) {
      this.marbleRoot.remove(c);
      (c.material as THREE.Material).dispose();
      this.caustics.delete(g);
    }
  }

  /** Caustics land on the far side from the sun, stretched when the sun is low. */
  private updateCaustics() {
    const d = this.sunDir;
    const sx = d.y > 0.05 ? -d.x / d.y : 0;
    const sz = d.y > 0.05 ? -d.z / d.y : 0;
    const slen = Math.min(1.6, Math.hypot(sx, sz));
    const ang = Math.atan2(sz, sx);
    for (const [g, c] of this.caustics) {
      const radius = g.userData.radius ?? WORLD.targetRadius;
      const lift = Math.max(0, g.position.y - radius);
      const off = radius * (0.55 + slen * 0.6) + lift * slen;
      c.visible = g.visible;
      c.position.set(g.position.x + Math.cos(ang) * off, 0.012, g.position.z + Math.sin(ang) * off);
      (c.material as THREE.MeshBasicMaterial).opacity = (0.32 * this.causticStrength * g.scale.x) / (1 + lift * 0.3);
      c.scale.set(1 + slen * 0.35, 1, 1);
      c.rotation.z = -ang;
    }
  }

  unbindMatch() {
    this.clearMarbles();
    this.match = null;
    this.aim = null;
  }

  private clearMarbles() {
    for (const m of [...this.targetMeshes.values(), ...this.shooterMeshes]) this.removeMarble(m);
    for (const l of this.leaving) this.removeMarble(l.obj);
    this.leaving = [];
    this.targetMeshes.clear();
    this.shooterMeshes = [];
    this.activeShooter = null;
    this.visualQuat.clear();
    this.prevBodyQuat.clear();
  }

  /** Celebrate a captured mib: sparkle burst at its last position. */
  burst(pos: { x: number; y: number; z: number }, color: string, count = 40) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    const v = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = pos.x;
      p[i * 3 + 1] = pos.y + 0.1;
      p[i * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 2.5;
      v[i * 3] = Math.cos(a) * s;
      v[i * 3 + 1] = 2 + Math.random() * 3;
      v[i * 3 + 2] = Math.sin(a) * s;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: 0.16,
      map: radialGlowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.bursts.push({ points: pts, vel: v, life: 1 });
  }

  // ---- Picking ------------------------------------------------------------------------
  private raycaster = new THREE.Raycaster();
  private ndc(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  groundPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const ray = this.raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-4) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return null;
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  }

  /** True if the pointer is on (or near) the shooter. Generous radius for thumbs. */
  hitsShooter(clientX: number, clientY: number): boolean {
    if (!this.activeShooter?.visible) return false;
    const p = this.groundPoint(clientX, clientY);
    if (!p) return false;
    const s = this.activeShooter.position;
    return Math.hypot(p.x - s.x, p.z - s.z) < 0.9;
  }

  // ---- Frame ----------------------------------------------------------------------------
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, this.clock.getDelta());
    this.elapsed += dt;
    this.onTick?.(dt);
    this.syncMarbles(dt);
    this.updateGuide();
    this.updateEffects(dt);
    this.updateCamera(dt);
    this.arena?.update(this.elapsed, dt);
    this.pieces?.update(this.elapsed, dt);
    if (this.quality === 'low') this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);
  };

  private shooterAnchor(): { x: number; z: number } | null {
    const m = this.match;
    if (!m) return null;
    if (m.phase === 'aim') {
      if (m.firstShotOfTurn) return this.aim ? placementPoint(this.aim.placeAngle) : placementPoint(m.seatAngle(m.current));
      if (m.layout.shooter) return { x: m.layout.shooter.x, z: m.layout.shooter.z };
    }
    return null;
  }

  private syncMarbles(dt: number) {
    const m = this.match;
    if (!m) return;
    const shooter = this.shooterMeshes[m.current] ?? null;
    if (shooter !== this.activeShooter) {
      for (const s of this.shooterMeshes) s.visible = false;
      this.activeShooter = shooter;
    }

    const sim = m.sim;
    this.movers.length = 0;
    if (sim) {
      if (sim !== this.lastSim) {
        this.lastSim = sim;
        this.prevBodyQuat.clear();
      }
      for (const b of sim.bodies) {
        const mesh = b.id === SHOOTER_ID ? shooter : this.targetMeshes.get(b.id);
        if (!mesh) continue;
        const t = b.body.translation();
        const v = b.body.linvel();
        this.movers.push({ id: b.id, x: t.x, y: t.y, z: t.z, vx: v.x, vz: v.z, radius: b.radius });
        mesh.position.set(t.x, t.y, t.z);
        mesh.visible = true;
        const r = b.body.rotation();
        const cur = new THREE.Quaternion(r.x, r.y, r.z, r.w);
        const prev = this.prevBodyQuat.get(b.id) ?? new THREE.Quaternion();
        // visual = (cur * prev⁻¹) * visual
        tmpQ.copy(prev).invert().premultiply(cur);
        const vis = this.visualQuat.get(b.id) ?? new THREE.Quaternion();
        vis.premultiply(tmpQ).normalize();
        this.visualQuat.set(b.id, vis);
        mesh.quaternion.copy(vis);
        this.prevBodyQuat.set(b.id, cur);
      }
    } else {
      this.syncLayout(m.layout, shooter);
    }

    // Captured mibs fly away.
    const live = new Set(sim ? sim.bodies.map((b) => b.id) : m.layout.targets.map((t) => t.id));
    for (const [id, mesh] of this.targetMeshes) {
      if (!live.has(id)) {
        this.targetMeshes.delete(id);
        this.leaving.push({ obj: mesh, t: 0 });
      }
    }
    for (const l of this.leaving) {
      l.t += dt;
      const k = Math.min(1, l.t / 0.6);
      l.obj.position.y += dt * 3 * (1 - k);
      l.obj.scale.setScalar(Math.max(0.001, 1 - k * k));
    }
    this.leaving = this.leaving.filter((l) => {
      if (l.t >= 0.6) {
        this.removeMarble(l.obj);
        return false;
      }
      return true;
    });

    // Charge squash on the shooter while the player pulls back.
    if (shooter && this.aim && m.phase === 'aim') {
      const p = this.aim.power;
      shooter.scale.set(1 + p * 0.06, 1 - p * 0.08, 1 + p * 0.06);
    } else if (shooter) shooter.scale.setScalar(1);
    this.updateCaustics();
  }

  private syncLayout(layout: Layout, shooter: THREE.Group | null) {
    for (const t of layout.targets) {
      const mesh = this.targetMeshes.get(t.id);
      if (mesh) mesh.position.set(t.x, t.y, t.z);
    }
    const anchor = this.shooterAnchor();
    if (shooter) {
      if (anchor) {
        shooter.visible = true;
        shooter.position.set(anchor.x, WORLD.shooterRadius, anchor.z);
      } else {
        shooter.visible = false;
      }
    }
  }

  private updateGuide() {
    const m = this.match;
    const a = this.aim;
    const anchor = this.shooterAnchor();
    if (!m || !a || m.phase !== 'aim' || !anchor) {
      this.guide.visible = false;
      return;
    }
    this.guide.visible = true;
    // The aim line, ghost and placement band wear the colour of whoever is shooting.
    const c = this.tmpColor.set(uiColor(this.looks[m.current]));
    for (const mesh of [this.guideLine1, this.guideLine2, this.guideLine3, this.ghost, this.placeArc]) {
      (mesh.material as THREE.MeshBasicMaterial).color.copy(c);
    }
    const y = 0.015;
    const ox = anchor.x;
    const oz = anchor.z;
    const dx = Math.cos(a.aimAngle);
    const dz = Math.sin(a.aimAngle);

    // First collision along the aim ray (sphere sweep).
    const rr = WORLD.targetRadius + WORLD.shooterRadius;
    let best = Infinity;
    let hit: { x: number; z: number } | null = null;
    for (const t of m.layout.targets) {
      const fx = t.x - ox;
      const fz = t.z - oz;
      const proj = fx * dx + fz * dz;
      if (proj <= 0) continue;
      const perp2 = fx * fx + fz * fz - proj * proj;
      if (perp2 > rr * rr) continue;
      const s = proj - Math.sqrt(rr * rr - perp2);
      if (s < best) {
        best = s;
        hit = { x: t.x, z: t.z };
      }
    }
    const maxLen = a.guideLength;
    const showLines = maxLen > 0;
    const len1 = Math.min(best, hit ? best : maxLen);
    this.setLine(this.guideLine1, ox, oz, a.aimAngle, showLines ? Math.min(len1, maxLen) : 0, y, 0.035);
    if (hit && best <= maxLen && showLines) {
      const gx = ox + dx * best;
      const gz = oz + dz * best;
      this.ghost.visible = true;
      this.ghost.position.set(gx, y, gz);
      // Object ball direction: from ghost centre through target centre.
      const nAng = Math.atan2(hit.z - gz, hit.x - gx);
      this.setLine(this.guideLine2, hit.x, hit.z, nAng, Math.min(1.6, maxLen * 0.4), y, 0.03);
      // Shooter deflection: tangent line.
      const nx = Math.cos(nAng);
      const nz = Math.sin(nAng);
      const dot = dx * nx + dz * nz;
      const tx = dx - dot * nx;
      const tz = dz - dot * nz;
      const tl = Math.hypot(tx, tz);
      if (tl > 0.05) this.setLine(this.guideLine3, gx, gz, Math.atan2(tz, tx), Math.min(1.1, maxLen * 0.3) * tl, y, 0.025);
      else this.guideLine3.visible = false;
    } else {
      this.ghost.visible = false;
      this.guideLine2.visible = false;
      this.guideLine3.visible = false;
    }

    // Charge ring + placement arc.
    const cm = this.chargeRing.material as THREE.MeshBasicMaterial;
    cm.opacity = a.power > 0 ? 0.35 + a.power * 0.5 : 0;
    this.chargeRing.position.set(ox, 0.014, oz);
    const sc = 1 + a.power * 0.9;
    this.chargeRing.scale.set(sc, sc, sc);
    cm.color.setHSL(0.33 - a.power * 0.33, 0.9, 0.6);
    this.placeArc.visible = a.firstShot && a.canPlace;
    // Ring geometry lies in local XY; after the -90° X tilt a local angle φ maps to world -φ.
    this.placeArc.rotation.z = -a.placeAngle;
  }

  private setLine(mesh: THREE.Mesh, x: number, z: number, ang: number, len: number, y: number, width: number) {
    if (len <= 0.01) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, -ang, 0);
    mesh.scale.set(len, 1, width);
  }

  /** The ground answers a collision: sand spray, frost, dust. */
  surfaceImpact(pos: { x: number; y: number; z: number }, strength: number) {
    this.surfaceFx.impact(pos, strength);
  }

  /** A hit with weight: camera jolt and, for hard ones, a shockwave on the ground. */
  hitFeedback(pos: { x: number; z: number }, strength: number, kind: 'marble' | 'kerb' | 'bumper') {
    if (kind === 'bumper') this.pieces?.pulse(pos.x, pos.z, strength);
    if (strength < 120) return;
    this.juice.kick(Math.min(kind === 'marble' ? 0.45 : 0.25, strength / 2400));
    if (strength > 260) this.juice.shockwave(pos, strength, kind === 'bumper' ? '#ffd23f' : kind === 'kerb' ? '#ffd9a8' : '#ffffff');
  }

  /** The flick leaves the thumb. */
  launchFeedback(power: number) {
    this.juice.launch(power);
  }

  /** A mib knocked out of the ring. */
  captureFeedback(pos: { x: number; z: number }, color: string) {
    this.juice.kick(0.35);
    this.juice.shockwave(pos, 1200, color);
  }

  private updateEffects(realDt: number) {
    const dt = realDt * this.timeScale;
    this.surfaceFx.update(dt, this.match?.sim ? this.movers : []);
    this.juice.update(dt, this.match?.sim ? this.movers : []);
    for (const b of this.bursts) {
      b.life -= dt * 1.2;
      const pos = b.points.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        b.vel[i + 1] -= 9 * dt;
        arr[i] += b.vel[i] * dt;
        arr[i + 1] = Math.max(0.02, arr[i + 1] + b.vel[i + 1] * dt);
        arr[i + 2] += b.vel[i + 2] * dt;
      }
      pos.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = Math.max(0, b.life);
    }
    this.bursts = this.bursts.filter((b) => {
      if (b.life <= 0) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
  }

  private updateCamera(dt: number) {
    const aspect = this.camera.aspect;
    const portrait = aspect < 1;
    const fit = portrait ? 1 / Math.max(0.45, aspect) : 1;
    const want = { tx: 0, ty: 0, tz: 0, yaw: this.cam.yaw, pitch: 0.6, dist: 14 };
    const anchor = this.shooterAnchor();
    const a = this.aim;

    switch (this.camMode) {
      case 'attract':
        // A slow orbit, high enough to read the cross, close enough to see the glass.
        want.yaw = this.cam.yaw + dt * 0.06;
        want.pitch = 0.66;
        want.dist = 11 * Math.min(fit, 1.6);
        want.ty = 0;
        break;
      case 'aim':
        if (anchor && a) {
          // Over the shoulder: the shooter in the lower third, the line of the shot and
          // what it will hit filling the frame, the horizon kept near the top edge.
          const dx = Math.cos(a.aimAngle);
          const dz = Math.sin(a.aimAngle);
          const ahead = 1 + this.userZoom * 0.8;
          want.tx = anchor.x + dx * ahead;
          want.tz = anchor.z + dz * ahead;
          want.ty = 0;
          want.yaw = a.aimAngle + Math.PI;
          want.pitch = this.userPitch;
          want.dist = 6.4 * this.userZoom * Math.min(fit, 1.5);
        }
        break;
      case 'top': {
        const yaw = a ? a.aimAngle + Math.PI : this.cam.yaw;
        want.yaw = yaw;
        want.pitch = 1.42;
        want.dist = (R + 1.6) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (portrait ? 1 / aspect : 1) * 0.95 * this.userZoom;
        break;
      }
      case 'follow': {
        const sim = this.match?.sim;
        let sx = 0;
        let sz = 0;
        let w = 0;
        if (sim) {
          for (const b of sim.bodies) {
            const v = b.body.linvel();
            const sp = Math.hypot(v.x, v.z);
            if (sp < 0.3) continue;
            const t = b.body.translation();
            const k = b.id === SHOOTER_ID ? 2 + sp : sp;
            sx += t.x * k;
            sz += t.z * k;
            w += k;
          }
        }
        if (w > 0) {
          want.tx = THREE.MathUtils.clamp(sx / w, -R - 2, R + 2) * 0.6;
          want.tz = THREE.MathUtils.clamp(sz / w, -R - 2, R + 2) * 0.6;
        } else {
          want.tx = this.cam.tx;
          want.tz = this.cam.tz;
        }
        want.yaw = this.lastYaw;
        want.pitch = 0.95;
        want.dist = 11 * Math.min(fit, 1.6);
        break;
      }
      case 'overview':
        want.yaw = this.cam.yaw + dt * 0.04;
        want.pitch = 1.0;
        want.dist = 13.5 * Math.min(fit, 1.7);
        break;
    }
    if (this.camMode !== 'follow') this.lastYaw = want.yaw;

    const k = 1 - Math.exp(-dt * (this.camMode === 'aim' ? 9 : 3));
    // Shortest-path yaw interpolation.
    let dy = want.yaw - this.cam.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.cam.yaw += dy * k;
    this.cam.pitch += (want.pitch - this.cam.pitch) * k;
    this.cam.dist += (want.dist - this.cam.dist) * k;
    this.cam.tx += (want.tx - this.cam.tx) * k;
    this.cam.ty += (want.ty - this.cam.ty) * k;
    this.cam.tz += (want.tz - this.cam.tz) * k;

    const c = this.cam;
    tmpV.set(
      c.tx + Math.cos(c.yaw) * Math.cos(c.pitch) * c.dist,
      c.ty + Math.sin(c.pitch) * c.dist,
      c.tz + Math.sin(c.yaw) * Math.cos(c.pitch) * c.dist,
    );
    this.camera.position.copy(tmpV);
    this.camera.lookAt(c.tx, c.ty, c.tz);
    this.juice.applyToCamera(this.camera, this.camTarget.set(c.tx, c.ty, c.tz), this.baseFov, dt);

    // Only landscape screens have room beside the menu; phones keep the ring centred.
    const shift = aspect > 1.15 ? this.frameShift : 0;
    this.shiftNow += (shift - this.shiftNow) * (1 - Math.exp(-dt * 2.5));
    const w = this.renderer.domElement.width;
    const h = this.renderer.domElement.height;
    if (Math.abs(this.shiftNow) > 0.001) this.camera.setViewOffset(w, h, -this.shiftNow * w, 0, w, h);
    else if (this.camera.view) this.camera.clearViewOffset();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.baseFov = w / h < 1 ? 58 : 48;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  get canvas() {
    return this.renderer.domElement;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.clearMarbles();
    this.arena?.dispose();
    this.surfaceFx.dispose();
    this.juice.dispose();
    this.setMap(null);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
