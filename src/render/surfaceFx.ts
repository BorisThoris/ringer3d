import * as THREE from 'three';
import type { SurfaceKind } from '../game/arenas';
import { radialGlowTexture } from './textures';

/**
 * Visual surface effects: what the ground does when marbles roll and collide on it.
 *   sand     grains spray behind fast marbles; every roll leaves a groove that slowly fades
 *   grass    clippings kick up; rolls leave flattened, lighter trails
 *   ice      bright scratches along each path; frost sprays on hard hits
 *   concrete fine grey dust on launches and impacts
 *   wood     a faint dust puff on hard knocks
 * Purely cosmetic and local: nothing here touches the deterministic simulation.
 */

interface Style {
  /** Particle colour and how many per metre of fast rolling / per impact. */
  grain: THREE.Color;
  rollRate: number;
  impactCount: number;
  grainSize: number;
  gravity: number;
  /** Track mark: darker groove (multiply) or brighter scratch (add); 0 = no tracks. */
  track: 'dark' | 'light' | null;
  trackColor: THREE.Color;
  trackWidth: number;
  trackLife: number;
}

const STYLES: Record<SurfaceKind, Style> = {
  sand: { grain: new THREE.Color('#d9c49c'), rollRate: 26, impactCount: 26, grainSize: 0.07, gravity: 9, track: 'dark', trackColor: new THREE.Color('#9c8a6e'), trackWidth: 0.26, trackLife: 40 },
  grass: { grain: new THREE.Color('#6f9a3a'), rollRate: 8, impactCount: 12, grainSize: 0.06, gravity: 7, track: 'light', trackColor: new THREE.Color('#2a3318'), trackWidth: 0.3, trackLife: 18 },
  ice: { grain: new THREE.Color('#f2f8ff'), rollRate: 3, impactCount: 22, grainSize: 0.05, gravity: 6, track: 'light', trackColor: new THREE.Color('#5a6670'), trackWidth: 0.06, trackLife: 60 },
  concrete: { grain: new THREE.Color('#c9c5bd'), rollRate: 1.5, impactCount: 10, grainSize: 0.05, gravity: 2.5, track: null, trackColor: new THREE.Color('#000'), trackWidth: 0, trackLife: 0 },
  wood: { grain: new THREE.Color('#e9dcc4'), rollRate: 0, impactCount: 5, grainSize: 0.04, gravity: 1.5, track: null, trackColor: new THREE.Color('#000'), trackWidth: 0, trackLife: 0 },
};

const MAX_GRAINS = 900;
const MAX_TRACKS = 2400;
/** Below this ground speed a marble neither sprays nor marks. */
const MIN_SPEED = 1.2;

export interface Mover {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
}

export class SurfaceFx {
  private style: Style = STYLES.concrete;
  private kind: SurfaceKind = 'concrete';
  // Grains: pooled point sprites.
  private gPos = new Float32Array(MAX_GRAINS * 3);
  private gVel = new Float32Array(MAX_GRAINS * 3);
  private gLife = new Float32Array(MAX_GRAINS);
  private gNext = 0;
  private grains: THREE.Points;
  // Tracks: pooled flat quads; each one's strength fades with age.
  private tracks: THREE.InstancedMesh;
  private tBorn = new Float32Array(MAX_TRACKS).fill(-1e9);
  private tNext = 0;
  private lastMark = new Map<number, { x: number; z: number }>();
  private spray = new Map<number, number>();
  private time = 0;
  private dummy = new THREE.Object3D();
  private tmp = new THREE.Color();

  constructor(private scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.gPos, 3));
    this.grains = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.06, map: radialGlowTexture(), transparent: true, depthWrite: false, vertexColors: false }),
    );
    this.grains.frustumCulled = false;
    scene.add(this.grains);
    for (let i = 0; i < MAX_GRAINS; i++) this.gPos[i * 3 + 1] = -100;

    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    this.tracks = new THREE.InstancedMesh(quad, trackMaterial(), MAX_TRACKS);
    this.tracks.frustumCulled = false;
    this.tracks.renderOrder = 1;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < MAX_TRACKS; i++) {
      this.tracks.setMatrixAt(i, this.dummy.matrix);
      this.tracks.setColorAt(i, new THREE.Color(0, 0, 0));
    }
    scene.add(this.tracks);
  }

  setSurface(kind: SurfaceKind) {
    this.kind = kind;
    this.style = STYLES[kind];
    const pm = this.grains.material as THREE.PointsMaterial;
    pm.color.copy(this.style.grain);
    pm.size = this.style.grainSize;
    const tm = this.tracks.material as THREE.ShaderMaterial;
    // Grooves lay a translucent shade over the ground; scratches add light to it.
    tm.blending = this.style.track === 'light' ? THREE.AdditiveBlending : THREE.NormalBlending;
    tm.uniforms.color.value.copy(this.style.trackColor);
    tm.uniforms.additive.value = this.style.track === 'light' ? 1 : 0;
    tm.needsUpdate = true;
    this.clear();
  }

  /** Wipe all marks (new match, new field). */
  clear() {
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < MAX_TRACKS; i++) {
      this.tBorn[i] = -1e9;
      this.tracks.setMatrixAt(i, this.dummy.matrix);
    }
    this.tracks.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < MAX_GRAINS; i++) {
      this.gLife[i] = 0;
      this.gPos[i * 3 + 1] = -100;
    }
    this.lastMark.clear();
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) {
    const i = this.gNext;
    this.gNext = (this.gNext + 1) % MAX_GRAINS;
    this.gPos.set([x, y, z], i * 3);
    this.gVel.set([vx, vy, vz], i * 3);
    this.gLife[i] = life;
  }

  /** A marble-marble hit (or a hard landing): a burst of whatever the ground is made of. */
  impact(pos: { x: number; y: number; z: number }, strength: number) {
    const k = Math.min(1, strength / 400);
    const n = Math.round(this.style.impactCount * (0.3 + k));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.6 + Math.random()) * (1 + k * 2);
      this.emit(pos.x, 0.05, pos.z, Math.cos(a) * s, (1.5 + Math.random() * 2) * (0.6 + k), Math.sin(a) * s, 0.6 + Math.random() * 0.5);
    }
  }

  /** Every frame, with the marbles currently on the board. */
  update(dt: number, movers: Mover[]) {
    this.time += dt;
    const st = this.style;
    for (const m of movers) {
      const sp = Math.hypot(m.vx, m.vz);
      const grounded = m.y < m.radius + 0.05;
      if (!grounded || sp < MIN_SPEED) {
        this.lastMark.delete(m.id);
        continue;
      }
      // Spray: grains thrown up and back from the contact patch.
      if (st.rollRate > 0) {
        const acc = (this.spray.get(m.id) ?? 0) + sp * dt * st.rollRate * 0.04 * Math.min(2, sp / 6);
        let n = Math.floor(acc);
        this.spray.set(m.id, acc - n);
        while (n-- > 0) {
          const back = -0.25 - Math.random() * 0.35;
          const side = (Math.random() - 0.5) * 0.8;
          const ux = m.vx / sp;
          const uz = m.vz / sp;
          this.emit(
            m.x - ux * m.radius,
            0.03,
            m.z - uz * m.radius,
            (ux * back - uz * side) * sp * 0.35,
            0.6 + Math.random() * 1.2 * Math.min(1, sp / 8),
            (uz * back + ux * side) * sp * 0.35,
            0.35 + Math.random() * 0.4,
          );
        }
      }
      // Track: a flat mark every ~0.12 units travelled.
      if (st.track) {
        const last = this.lastMark.get(m.id);
        if (!last) {
          this.lastMark.set(m.id, { x: m.x, z: m.z });
        } else {
          const dx = m.x - last.x;
          const dz = m.z - last.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.12) {
            const i = this.tNext;
            this.tNext = (this.tNext + 1) % MAX_TRACKS;
            this.dummy.position.set((m.x + last.x) / 2, 0.006, (m.z + last.z) / 2);
            this.dummy.rotation.set(0, -Math.atan2(dz, dx), 0);
            this.dummy.scale.set(d + 0.02, 1, st.trackWidth * (m.radius / 0.18));
            this.dummy.updateMatrix();
            this.tracks.setMatrixAt(i, this.dummy.matrix);
            this.tBorn[i] = this.time;
            this.lastMark.set(m.id, { x: m.x, z: m.z });
          }
        }
      }
    }

    // Grains fly and fall.
    for (let i = 0; i < MAX_GRAINS; i++) {
      if (this.gLife[i] <= 0) continue;
      this.gLife[i] -= dt;
      const j = i * 3;
      this.gVel[j + 1] -= st.gravity * dt;
      this.gPos[j] += this.gVel[j] * dt;
      this.gPos[j + 1] += this.gVel[j + 1] * dt;
      this.gPos[j + 2] += this.gVel[j + 2] * dt;
      if (this.gPos[j + 1] < 0.01) {
        this.gPos[j + 1] = 0.01;
        this.gVel[j] *= 0.5;
        this.gVel[j + 2] *= 0.5;
      }
      if (this.gLife[i] <= 0) this.gPos[j + 1] = -100;
    }
    this.grains.geometry.attributes.position.needsUpdate = true;

    // Tracks fade over their lifetime (strength rides in the instance colour).
    if (st.track) {
      for (let i = 0; i < MAX_TRACKS; i++) {
        const age = this.time - this.tBorn[i];
        if (age < 0 || age > st.trackLife + 1) continue;
        const k = Math.max(0, 1 - age / st.trackLife);
        this.tmp.setScalar(k * k);
        this.tracks.setColorAt(i, this.tmp);
      }
      this.tracks.instanceColor!.needsUpdate = true;
      this.tracks.instanceMatrix.needsUpdate = true;
    }
  }

  get surface(): SurfaceKind {
    return this.kind;
  }

  dispose() {
    this.scene.remove(this.grains, this.tracks);
    this.grains.geometry.dispose();
    (this.grains.material as THREE.Material).dispose();
    this.tracks.geometry.dispose();
    (this.tracks.material as THREE.Material).dispose();
  }
}

/**
 * Instanced track marks: a soft stripe across the quad's width, its strength (0..1) in the
 * instance colour. Grooves draw `color` at that alpha; scratches add `color * strength`.
 */
function trackMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { color: { value: new THREE.Color('#000') }, additive: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      varying float vK;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING_COLOR
          vK = instanceColor.r;
        #else
          vK = 1.0;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float additive;
      varying vec2 vUv;
      varying float vK;
      void main() {
        float p = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
        float a = p * vK;
        if (a < 0.003) discard;
        gl_FragColor = additive > 0.5 ? vec4(color * a, 1.0) : vec4(color, a * 0.85);
        #include <colorspace_fragment>
      }`,
  });
}
