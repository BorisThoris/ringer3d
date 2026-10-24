/**
 * Everything three.js. The game loop pushes body poses in; the scene never
 * decides anything about the game.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { RingerConfig, Vec2 } from '../core/types';
import type { BodyPose } from '../sim/physics';
import { SHOOTER_ID } from '../sim/physics';
import { arenaById, type ArenaDef } from './arenas';
import { createMarble, TARGET_LOOKS, TAWS, type MarbleLook, type MarbleMesh, type Quality } from './marble';
import { chalkTexture, groundTextures } from './textures';

export type CameraMode = 'aim' | 'follow' | 'top' | 'lag' | 'showcase';

/** Phones and low-DPR integrated GPUs start on the cheaper glass. */
export function defaultQuality(): Quality {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 900);
  return mobile ? 'low' : 'high';
}

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 1, 12000);
  private marbles = new Map<string, MarbleMesh>();
  private arenaRoot = new THREE.Group();
  private sun = new THREE.DirectionalLight();
  private sunDir = new THREE.Vector3(0.5, 1, 0.35).normalize();
  private hemi = new THREE.HemisphereLight();
  private ringMesh?: THREE.Mesh;
  private lagLine?: THREE.Mesh;
  private aim = new THREE.Group();
  private aimLine: THREE.Line;
  private ghost: THREE.Mesh;
  private targetLine: THREE.Line;
  private powerRing: THREE.Mesh;
  private pulse: THREE.Mesh;
  private bursts: { points: THREE.Points; vel: Float32Array; life: number }[] = [];
  private shooterLook: MarbleLook = TAWS[0];
  private quality: Quality = 'high';
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;

  // Camera rig: spherical coordinates around a focus point, smoothed.
  private focus = new THREE.Vector3();
  private focusGoal = new THREE.Vector3();
  private yaw = 0;
  private yawGoal = 0;
  private pitch = 0.55;
  private pitchGoal = 0.55;
  private dist = 150;
  private distGoal = 150;
  /** User orbit offset on top of the mode's framing. */
  userYaw = 0;
  userZoom = 1;
  mode: CameraMode = 'showcase';
  private shake = 0;
  private time = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly config: RingerConfig) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -config.ringRadius * 2.6;
    sc.right = sc.top = config.ringRadius * 2.6;
    sc.near = 10;
    sc.far = 2000;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.3;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.arenaRoot, this.aim);

    // Aim guide: dashed shot line, ghost ball at contact, object-ball direction.
    const dashed = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 2.2, gapSize: 1.6, transparent: true, opacity: 0.85, depthTest: false });
    this.aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), dashed);
    this.targetLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
      new THREE.LineBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(config.shooterRadius, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    this.powerRing = new THREE.Mesh(
      new THREE.RingGeometry(config.shooterRadius * 1.6, config.shooterRadius * 2.1, 48, 1, 0, Math.PI * 2),
      new THREE.MeshBasicMaterial({ color: 0x5cff9d, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.powerRing.rotation.x = -Math.PI / 2;
    this.pulse = new THREE.Mesh(
      new THREE.RingGeometry(config.shooterRadius * 1.4, config.shooterRadius * 1.75, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.pulse.rotation.x = -Math.PI / 2;
    this.aimLine.renderOrder = this.targetLine.renderOrder = 10;
    this.aim.add(this.aimLine, this.targetLine, this.ghost, this.powerRing);
    this.scene.add(this.pulse);
    this.aim.visible = false;
    this.pulse.visible = false;
    this.setQuality(defaultQuality());
  }

  setShooterLook(look: MarbleLook): void {
    if (JSON.stringify(look) === JSON.stringify(this.shooterLook)) return;
    this.shooterLook = look;
    this.dropMarble(SHOOTER_ID);
  }

  getQuality(): Quality {
    return this.quality;
  }

  /** High: transmissive glass + bloom. Low: clearcoat glass, no post. Rebuilds the marbles. */
  setQuality(q: Quality): void {
    this.quality = q;
    for (const id of [...this.marbles.keys()]) this.dropMarble(id);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : 1.5));
    if (q === 'high' && !this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.45, 0.88);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    } else if (q === 'low' && this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloom = null;
    }
    this.resize();
  }

  private dropMarble(id: string): void {
    const m = this.marbles.get(id);
    if (!m) return;
    this.scene.remove(m.group);
    if (m.caustic) this.scene.remove(m.caustic);
    m.dispose();
    this.marbles.delete(id);
  }

  loadArena(arena: ArenaDef | string): void {
    const a = typeof arena === 'string' ? arenaById(arena) : arena;
    this.arenaRoot.clear();
    const R = this.config.ringRadius;

    // Sky dome with a vertical gradient.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(8000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { top: { value: new THREE.Color(a.sky[0]) }, horizon: { value: new THREE.Color(a.sky[1]) } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.15,0.0,1.0); gl_FragColor = vec4(mix(horizon, top, pow(h,0.8)),1.0); }',
      }),
    );
    this.arenaRoot.add(sky);
    this.scene.fog = new THREE.Fog(a.fog, 900, 4200);

    const { map, bump } = groundTextures(a.ground, a.groundTint);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(2600, 64),
      new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: a.ground === 'carpet' ? 1.2 : 0.6, roughness: a.ground === 'stone' ? 0.75 : 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.arenaRoot.add(ground);

    // Chalk ring.
    const chalk = chalkTexture(36);
    this.ringMesh = new THREE.Mesh(
      new THREE.RingGeometry(R - 0.9, R + 0.9, 192, 1),
      new THREE.MeshBasicMaterial({ map: chalk, transparent: true, depthWrite: false, color: a.ringColor }),
    );
    this.ringMesh.rotation.x = -Math.PI / 2;
    this.ringMesh.position.y = 0.05;
    this.arenaRoot.add(this.ringMesh);

    // Lag line, only shown while lagging.
    this.lagLine = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 70),
      new THREE.MeshBasicMaterial({ map: chalkTexture(4), transparent: true, depthWrite: false, color: a.ringColor }),
    );
    this.lagLine.rotation.x = -Math.PI / 2;
    this.lagLine.visible = false;
    this.arenaRoot.add(this.lagLine);

    this.sun.color.set(a.sun.color);
    this.sun.intensity = a.sun.intensity;
    this.sunDir.set(...a.sun.dir).normalize();
    this.causticStrength = Math.min(1, a.sun.intensity / 3);
    this.hemi.color.set(a.ambient.sky);
    this.hemi.groundColor.set(a.ambient.ground);
    this.hemi.intensity = a.ambient.intensity;
    this.renderer.toneMappingExposure = a.exposure;
    for (const l of a.lamps) {
      const p = new THREE.PointLight(l.color, l.intensity, 0, 2);
      p.position.set(...l.pos);
      this.arenaRoot.add(p);
    }
    let seed = a.id.length * 7919;
    a.props(this.arenaRoot, () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    });
  }

  showLagLine(x: number | null, z = 0): void {
    if (!this.lagLine) return;
    this.lagLine.visible = x !== null;
    if (x !== null) this.lagLine.position.set(x, 0.06, z);
  }

  private makeMarble(id: string, radius: number): MarbleMesh {
    const n = parseInt(id.slice(1), 10) || 0;
    // Spread looks so neighbours in the cross differ.
    const look = id === SHOOTER_ID ? this.shooterLook : TARGET_LOOKS[(n * 3) % TARGET_LOOKS.length];
    const m = createMarble(look, radius, this.quality, id);
    this.scene.add(m.group);
    if (m.caustic) this.scene.add(m.caustic);
    this.marbles.set(id, m);
    return m;
  }

  /** Sync meshes to the sim. Marbles not in `poses` are removed. */
  syncBodies(poses: BodyPose[]): void {
    const seen = new Set<string>();
    // Caustics land on the far side from the sun, inside the shadow.
    const sx = this.sunDir.y > 0.05 ? -this.sunDir.x / this.sunDir.y : 0;
    const sz = this.sunDir.y > 0.05 ? -this.sunDir.z / this.sunDir.y : 0;
    const slen = Math.min(1.6, Math.hypot(sx, sz));
    const ang = Math.atan2(sz, sx);
    for (const p of poses) {
      seen.add(p.id);
      const m = this.marbles.get(p.id) ?? this.makeMarble(p.id, p.radius);
      m.group.position.set(p.x, p.y, p.z);
      m.group.quaternion.set(p.qx, p.qy, p.qz, p.qw);
      if (m.caustic) {
        const lift = Math.max(0, p.y - p.radius);
        const off = p.radius * (0.55 + slen * 0.6) + lift * slen;
        m.caustic.position.set(p.x + Math.cos(ang) * off, 0.08, p.z + Math.sin(ang) * off);
        m.caustic.visible = p.y > -p.radius;
        (m.caustic.material as THREE.MeshBasicMaterial).opacity = 0.55 * this.causticStrength / (1 + lift * 0.3);
        m.caustic.scale.set(1 + slen * 0.35, 1, 1);
        m.caustic.rotation.z = -ang;
      }
    }
    for (const id of [...this.marbles.keys()]) if (!seen.has(id)) this.dropMarble(id);
  }

  /** Lamp-lit night arenas throw weaker sunlight caustics. */
  private causticStrength = 1;

  marblePos(id: string): THREE.Vector3 | null {
    return this.marbles.get(id)?.group.position.clone() ?? null;
  }

  /**
   * Aim guide from `from` along `yaw`: dashed line to the first marble it
   * would hit, a ghost ball at contact and the struck marble's direction.
   */
  showAim(from: Vec2 | null, yaw = 0, power = 0, targets: Record<string, Vec2> = {}, guideLength = 1): void {
    this.aim.visible = from !== null;
    this.pulse.visible = from !== null && power === 0;
    if (!from) return;
    const y = this.config.shooterRadius;
    const dir = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const start = new THREE.Vector3(from.x, y, from.z);
    const contact = this.config.shooterRadius + this.config.targetRadius;
    let best = Infinity;
    let hit: Vec2 | null = null;
    for (const t of Object.values(targets)) {
      const rel = { x: t.x - from.x, z: t.z - from.z };
      const along = rel.x * dir.x + rel.z * dir.z;
      if (along <= 0) continue;
      const perp2 = rel.x * rel.x + rel.z * rel.z - along * along;
      if (perp2 > contact * contact) continue;
      const s = along - Math.sqrt(contact * contact - perp2);
      if (s < best) {
        best = s;
        hit = t;
      }
    }
    const maxLen = this.config.ringRadius * 2.2 * guideLength;
    const len = Math.min(best, maxLen);
    const end = start.clone().addScaledVector(dir, len);
    this.aimLine.geometry.setFromPoints([start, end]);
    this.aimLine.computeLineDistances();
    this.ghost.visible = hit !== null && best <= maxLen;
    this.targetLine.visible = this.ghost.visible;
    if (hit && this.ghost.visible) {
      this.ghost.position.copy(end);
      const tp = new THREE.Vector3(hit.x, this.config.targetRadius, hit.z);
      const push = tp.clone().sub(end).setY(0).normalize();
      this.targetLine.geometry.setFromPoints([tp, tp.clone().addScaledVector(push, 18 * guideLength + 6)]);
    }
    this.powerRing.position.set(from.x, 0.1, from.z);
    this.powerRing.visible = power > 0;
    this.powerRing.scale.setScalar(1 + power * 1.6);
    (this.powerRing.material as THREE.MeshBasicMaterial).color.setHSL(0.33 - power * 0.33, 1, 0.55);
    this.pulse.position.set(from.x, 0.1, from.z);
  }

  /** Little glass-spark burst, e.g. when a marble leaves the ring. */
  burst(x: number, z: number, color = '#ffd23f'): void {
    const n = 40;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([x, 2, z], i * 3);
      const a = Math.random() * Math.PI * 2;
      const s = 20 + Math.random() * 50;
      vel.set([Math.cos(a) * s, 30 + Math.random() * 60, Math.sin(a) * s], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 1.6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(points);
    this.bursts.push({ points, vel, life: 1 });
  }

  addShake(amount: number): void {
    this.shake = Math.min(3, this.shake + amount);
  }

  /** Frame the camera for a mode. `subject` = the shooter for aim, the lag marble for lag. */
  frame(mode: CameraMode, subject?: Vec2, yaw?: number): void {
    this.mode = mode;
    const R = this.config.ringRadius;
    if (mode === 'aim' && subject) {
      // Behind the shooter, looking along the aim, a little above the ground.
      const y = yaw ?? Math.atan2(-subject.z, -subject.x);
      this.focusGoal.set(subject.x + Math.cos(y) * R * 0.3, 0, subject.z + Math.sin(y) * R * 0.3);
      this.yawGoal = y + Math.PI;
      this.pitchGoal = 0.5;
      this.distGoal = R * 0.95;
    } else if (mode === 'follow') {
      this.focusGoal.set(subject?.x ?? 0, 0, subject?.z ?? 0).multiplyScalar(0.5);
      this.pitchGoal = 0.95;
      this.distGoal = R * 2.4;
    } else if (mode === 'top') {
      this.focusGoal.set(0, 0, 0);
      this.pitchGoal = 1.45;
      this.distGoal = R * 3.3;
    } else if (mode === 'lag' && subject) {
      this.focusGoal.set(subject.x, 0, subject.z);
      this.yawGoal = Math.PI;
      this.pitchGoal = 0.5;
      this.distGoal = R * 1.6;
    } else if (mode === 'showcase') {
      this.focusGoal.set(0, 0, 0);
      this.pitchGoal = 0.5;
      this.distGoal = R * 2.6;
    }
  }

  /** Point the aim camera along a new yaw without re-framing everything. */
  setAimYaw(subject: Vec2, yaw: number): void {
    if (this.mode !== 'aim') return;
    this.frame('aim', subject, yaw);
  }

  /** Ground point under a screen position, or null when looking at the sky. */
  groundAt(clientX: number, clientY: number): Vec2 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return null;
    return { x: p.x, z: p.z };
  }

  /** Screen position (CSS px) of a world point. */
  toScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, visible: v.z < 1 };
  }

  /** Camera right and forward, flattened onto the ground; for mapping drags to aim. */
  groundBasis(): { right: Vec2; forward: Vec2 } {
    const yaw = this.yaw + this.userYaw;
    // The camera sits at focus + (cos yaw, sin yaw) * d and looks back at the focus.
    const forward = { x: -Math.cos(yaw), z: -Math.sin(yaw) };
    const right = { x: -forward.z, z: forward.x };
    return { right, forward };
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.camera.aspect = w / h;
    // Portrait phones need more vertical field of view to keep the ring in frame.
    this.camera.fov = w < h ? 58 : 42;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number): void {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 4);
    this.focus.lerp(this.focusGoal, k);
    let dy = this.yawGoal - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * k;
    if (this.mode === 'showcase') this.yawGoal += dt * 0.12;
    this.pitch += (this.pitchGoal - this.pitch) * k;
    this.dist += (this.distGoal * this.userZoom - this.dist) * k;
    const yaw = this.yaw + this.userYaw;
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.focus.x + Math.cos(yaw) * cp * this.dist,
      this.focus.y + Math.sin(this.pitch) * this.dist,
      this.focus.z + Math.sin(yaw) * cp * this.dist,
    );
    if (this.shake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 8);
    }
    this.camera.lookAt(this.focus);
    this.sun.target.position.copy(this.focus);
    // The shadow camera follows the action so its 2048px map stays sharp.
    this.sun.position.copy(this.focus).addScaledVector(this.sunDir, 600);

    const s = 1 + Math.sin(this.time * 5) * 0.12;
    this.pulse.scale.setScalar(s);
    (this.pulse.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(this.time * 5) * 0.25;

    for (const b of [...this.bursts]) {
      b.life -= dt * 1.2;
      const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < b.vel.length; i += 3) {
        b.vel[i + 1] -= 200 * dt;
        pos.array[i] += b.vel[i] * dt;
        pos.array[i + 1] = Math.max(0.3, (pos.array[i + 1] as number) + b.vel[i + 1] * dt);
        pos.array[i + 2] += b.vel[i + 2] * dt;
      }
      pos.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = Math.max(0, b.life);
      if (b.life <= 0) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        this.bursts.splice(this.bursts.indexOf(b), 1);
      }
    }
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
