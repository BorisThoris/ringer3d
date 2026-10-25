import * as THREE from 'three';
import type { Mover } from './surfaceFx';

/**
 * Feedback that gives shots weight: motion streaks behind fast marbles, shockwave rings
 * where hard hits land, and camera trauma (shake + a field-of-view punch on the flick).
 * All cosmetic: nothing here feeds back into the simulation.
 */

const MAX_STREAKS = 24;
const MAX_WAVES = 12;
/** Streaks appear above this speed (units/s) and reach full strength at STREAK_FULL. */
const STREAK_MIN = 3.5;
const STREAK_FULL = 14;

export class Juice {
  private streaks: THREE.InstancedMesh;
  private waves: { mesh: THREE.Mesh; t: number; life: number; size: number }[] = [];
  private wavePool: THREE.Mesh[] = [];
  private dummy = new THREE.Object3D();
  private tmp = new THREE.Color();
  /** 0..1; shake grows with its square so small knocks stay small. */
  private trauma = 0;
  private fovKick = 0;
  private time = 0;

  constructor(private scene: THREE.Scene) {
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    // Head at local x = 0, tail at x = -1.
    quad.translate(-0.5, 0, 0);
    this.streaks = new THREE.InstancedMesh(quad, streakMaterial(), MAX_STREAKS);
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 2;
    this.streaks.count = 0;
    scene.add(this.streaks);

    const ring = new THREE.RingGeometry(0.82, 1, 48);
    ring.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_WAVES; i++) {
      const m = new THREE.Mesh(
        ring,
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.wavePool.push(m);
    }
  }

  /** Add camera trauma (0..1). */
  kick(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** The flick: a short zoom punch and a nudge, scaled by power. */
  launch(power: number) {
    this.fovKick = Math.max(this.fovKick, 2 + power * 5);
    this.kick(0.12 + power * 0.18);
  }

  /** A ring of displaced air (or dust) where a hard hit lands. */
  shockwave(pos: { x: number; z: number }, strength: number, color: string) {
    const m = this.wavePool.pop() ?? this.waves.shift()?.mesh;
    if (!m) return;
    const k = Math.min(1, strength / 1200);
    (m.material as THREE.MeshBasicMaterial).color.set(color);
    m.position.set(pos.x, 0.02, pos.z);
    m.visible = true;
    this.waves.push({ mesh: m, t: 0, life: 0.35 + k * 0.25, size: 0.5 + k * 1.3 });
  }

  update(dt: number, movers: Mover[]) {
    this.time += dt;
    // Streaks: a soft smear trailing each fast marble, longer and brighter with speed.
    let n = 0;
    for (const m of movers) {
      if (n >= MAX_STREAKS) break;
      const sp = Math.hypot(m.vx, m.vz);
      if (sp < STREAK_MIN) continue;
      const k = Math.min(1, (sp - STREAK_MIN) / (STREAK_FULL - STREAK_MIN));
      this.dummy.position.set(m.x, m.y, m.z);
      this.dummy.rotation.set(0, -Math.atan2(m.vz, m.vx), 0);
      this.dummy.scale.set(Math.min(2.6, sp * 0.09), 1, m.radius * 1.7);
      this.dummy.updateMatrix();
      this.streaks.setMatrixAt(n, this.dummy.matrix);
      this.streaks.setColorAt(n, this.tmp.setScalar(0.25 + 0.75 * k));
      n++;
    }
    this.streaks.count = n;
    this.streaks.instanceMatrix.needsUpdate = true;
    if (this.streaks.instanceColor) this.streaks.instanceColor.needsUpdate = true;

    for (const w of this.waves) {
      w.t += dt;
      const k = Math.min(1, w.t / w.life);
      const s = w.size * (0.25 + 0.75 * (1 - (1 - k) * (1 - k)));
      w.mesh.scale.setScalar(s);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
    }
    this.waves = this.waves.filter((w) => {
      if (w.t < w.life) return true;
      w.mesh.visible = false;
      this.wavePool.push(w.mesh);
      return false;
    });
  }

  /** Shake the camera about its resting pose; call after the rig has placed it. */
  applyToCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3, baseFov: number, dt: number) {
    const shake = this.trauma * this.trauma;
    if (shake > 0.0001) {
      const d = camera.position.distanceTo(target);
      const a = shake * d * 0.012;
      // Smooth noise rather than white jitter: reads as a jolt, not a glitch.
      const t = this.time * 31;
      camera.position.x += a * (Math.sin(t * 1.3) + Math.sin(t * 2.9 + 1.7) * 0.5);
      camera.position.y += a * (Math.sin(t * 1.7 + 0.4) + Math.sin(t * 3.3) * 0.5);
      camera.position.z += a * (Math.sin(t * 1.1 + 2.1) + Math.sin(t * 2.3 + 0.9) * 0.5);
      camera.lookAt(target);
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    if (this.fovKick > 0.01 || camera.fov !== baseFov) {
      camera.fov = baseFov + this.fovKick;
      camera.updateProjectionMatrix();
      this.fovKick *= Math.exp(-dt * 7);
      if (this.fovKick < 0.01) this.fovKick = 0;
    }
  }

  clear() {
    this.trauma = 0;
    this.fovKick = 0;
    this.streaks.count = 0;
    for (const w of this.waves) {
      w.mesh.visible = false;
      this.wavePool.push(w.mesh);
    }
    this.waves = [];
  }

  dispose() {
    this.scene.remove(this.streaks);
    this.streaks.geometry.dispose();
    (this.streaks.material as THREE.Material).dispose();
    const geo = this.wavePool[0]?.geometry ?? this.waves[0]?.mesh.geometry;
    for (const m of [...this.wavePool, ...this.waves.map((w) => w.mesh)]) {
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
    }
    geo?.dispose();
  }
}

/** A soft additive smear: bright at the marble, fading to nothing at the tail and edges. */
function streakMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
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
      varying vec2 vUv;
      varying float vK;
      void main() {
        float along = vUv.x;            // 1 at the marble, 0 at the tail
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float a = pow(along, 1.6) * smoothstep(0.0, 0.8, across) * vK * 0.42;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
