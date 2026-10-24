import * as THREE from 'three';
import type { MarbleLook } from '../game/marbles';
import { marbleTexture } from './textures';

/**
 * Marbles. A glass marble is a transmissive shell (real refraction, a touch of dispersion,
 * tinted by attenuation) around an interior built from actual geometry: twisted cat's-eye
 * blades, spiral swirl ribbons, aventurine flecks, onionskin streaks and bubbles. Steelies are
 * polished metal, clay is clay. Each glass marble also throws a coloured caustic on the ground.
 *
 * Glass interiors and caustics are ported from the parallel "Playable game, glass marbles"
 * implementation; quality "low" swaps transmission for a cheaper clearcoat shell.
 */

export type Quality = 'low' | 'medium' | 'high';

export interface BuiltMarble {
  /** Rotates with the physics body. */
  group: THREE.Group;
  /** Lies flat on the ground and follows position only (null for opaque marbles). */
  caustic: THREE.Mesh | null;
}

function rng(seed: number): () => number {
  let s = Math.floor(seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const geoCache = new Map<string, THREE.BufferGeometry>();
const cachedSet = new Set<THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
    cachedSet.add(g);
  }
  return g as T;
}

function sphere(r: number, seg: number) {
  return cached(`sphere-${r}-${seg}`, () => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7)));
}

/** A cat's-eye blade: flame-shaped along the y axis, twisted a little and gently curved. */
function vaneGeometry(r: number, twist: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // A broad, flame-shaped blade; several of them fan out like a propeller.
  const L = r * 0.74;
  const W = r * 0.26;
  shape.moveTo(0, -L);
  shape.bezierCurveTo(W, -L * 0.5, W * 1.15, L * 0.45, 0, L);
  shape.bezierCurveTo(-W * 1.15, L * 0.45, -W, -L * 0.5, 0, -L);
  const g = new THREE.ShapeGeometry(shape, 24);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = (v.y / L) * twist;
    pos.setXYZ(i, v.x * Math.cos(a), v.y, v.x * Math.sin(a) + (v.y * v.y) / (L * 8));
  }
  g.computeVertexNormals();
  return g;
}

/** A flat ribbon following a curve: swirls and onionskin streaks. */
function ribbonGeometry(curve: THREE.Curve<THREE.Vector3>, width: number, segments = 80): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(segments, true);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const p = curve.getPointAt(i / segments);
    const n = frames.normals[i];
    const w = width * Math.sin((Math.PI * i) / segments) ** 0.6;
    pos.push(p.x + n.x * w, p.y + n.y * w, p.z + n.z * w, p.x - n.x * w, p.y - n.y * w, p.z - n.z * w);
    if (i < segments) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

class SpiralCurve extends THREE.Curve<THREE.Vector3> {
  private r: number;
  private turns: number;
  private phase: number;
  private tilt: number;
  constructor(r: number, turns: number, phase: number, tilt: number) {
    super();
    this.r = r;
    this.turns = turns;
    this.phase = phase;
    this.tilt = tilt;
  }
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const y = (t * 2 - 1) * this.r * 0.85;
    const rad = Math.sqrt(Math.max(0, this.r * this.r * 0.72 - y * y)) * 0.85;
    const a = this.phase + t * this.turns * Math.PI * 2;
    target.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
    return target.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.tilt);
  }
}

let causticTex: THREE.Texture | null = null;
function causticTexture(): THREE.Texture {
  if (causticTex) return causticTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  causticTex = new THREE.CanvasTexture(c);
  return causticTex;
}

export function buildMarble(look: MarbleLook, radius: number, quality: Quality, seed = 1): BuiltMarble {
  const group = new THREE.Group();
  group.userData.radius = radius;
  const r = radius;
  const rand = rng(seed + look.id.length * 0.37);
  const seg = quality === 'low' ? 20 : quality === 'medium' ? 32 : 48;
  const interior = (color: string, glow: number) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.35,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(color),
      emissiveIntensity: glow,
    });
  const glowK = Math.max(0.25, look.glow);

  // ---- Opaque marbles ----------------------------------------------------------------------
  if (look.core === 'steelie') {
    const s = new THREE.Mesh(
      sphere(r, seg),
      // Chrome is nothing but reflection: push the environment hard.
      new THREE.MeshPhysicalMaterial({ color: look.base, metalness: 1, roughness: 0.04, clearcoat: 0.6, clearcoatRoughness: 0.05, envMapIntensity: 3 }),
    );
    s.castShadow = true;
    group.add(s);
    return { group, caustic: null };
  }
  if (look.core === 'solid' || look.clarity < 0.05) {
    const s = new THREE.Mesh(
      sphere(r, seg),
      new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: marbleTexture('clay', look.base, look.accent2, 3), roughness: 0.75, clearcoat: 0.15 }),
    );
    s.castShadow = true;
    group.add(s);
    return { group, caustic: null };
  }

  // ---- Interiors ---------------------------------------------------------------------------
  const colors = [look.accent, look.accent2, look.base];
  switch (look.core) {
    case 'catseye': {
      const n = 3 + Math.floor(rand() * 2);
      const g = cached(`vane-${r}`, () => vaneGeometry(r, 1.1));
      for (let i = 0; i < n; i++) {
        const v = new THREE.Mesh(g, interior(colors[i % 2], glowK));
        v.rotation.y = (i / n) * Math.PI + rand() * 0.15;
        group.add(v);
      }
      break;
    }
    case 'swirl':
    case 'onionskin': {
      const onion = look.core === 'onionskin';
      const n = onion ? 7 : 4;
      for (let i = 0; i < n; i++) {
        const curve = new SpiralCurve(r * (onion ? 0.95 : 0.85), 0.6 + rand() * 0.8, (i / n) * Math.PI * 2, (rand() - 0.5) * 0.6);
        group.add(new THREE.Mesh(ribbonGeometry(curve, r * (onion ? 0.15 : 0.07 + rand() * 0.05)), interior(colors[i % 2], glowK)));
      }
      if (onion) group.add(new THREE.Mesh(sphere(r * 0.55, 24), interior('#f6f1e6', 0.05)));
      break;
    }
    case 'galaxy': {
      // Deep core with aventurine flecks that catch the light (and the bloom).
      group.add(new THREE.Mesh(sphere(r * 0.55, 24), interior(look.base, 0.05)));
      const flake = cached(`flake-${r}`, () => new THREE.OctahedronGeometry(r * 0.018, 0));
      const count = quality === 'low' ? 90 : 240;
      const inst = new THREE.InstancedMesh(
        flake,
        new THREE.MeshStandardMaterial({ color: look.accent2, emissive: new THREE.Color(look.accent2), emissiveIntensity: 2.2, metalness: 0.6, roughness: 0.2 }),
        count,
      );
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const p = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        do p.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
        while (p.lengthSq() > 1);
        p.multiplyScalar(r * 0.7);
        q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6));
        m.compose(p, q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.5 + rand()));
        inst.setMatrixAt(i, m);
      }
      group.add(inst);
      group.add(new THREE.Mesh(ribbonGeometry(new SpiralCurve(r * 0.8, 1.2, rand() * 6, 0.4), r * 0.09), interior(look.accent, 0.45)));
      break;
    }
    case 'neon': {
      for (let i = 0; i < 3; i++) {
        const curve = new SpiralCurve(r * 0.92, 0.9 + i * 0.3, (i / 3) * Math.PI * 2, 0.3 * (i - 1));
        group.add(new THREE.Mesh(ribbonGeometry(curve, r * 0.1), interior(colors[i % 2], 1.6)));
      }
      group.add(new THREE.Mesh(sphere(r * 0.5, 24), interior(look.base, 0.02)));
      break;
    }
    case 'onyx': {
      const tex = marbleTexture('cracks', look.accent, look.accent2, Math.floor(seed * 10) + 11);
      group.add(
        new THREE.Mesh(
          sphere(r * 0.96, seg),
          new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffffff').multiplyScalar(look.glow * 1.6), roughness: 0.5 }),
        ),
      );
      break;
    }
    case 'opal':
      group.add(
        new THREE.Mesh(
          sphere(r * 0.7, seg),
          new THREE.MeshPhysicalMaterial({ color: look.accent, iridescence: 1, roughness: 0.3, emissive: new THREE.Color(look.accent2).multiplyScalar(look.glow) }),
        ),
      );
      break;
    case 'clearie':
      // A single faint wisp, like a stretched air line in the glass.
      group.add(new THREE.Mesh(ribbonGeometry(new SpiralCurve(r * 0.7, 0.35, rand() * 6, 0.9), r * 0.035), interior(look.accent, 0.5)));
      break;
    default:
      break;
  }

  // Bubbles: every glass marble has a few, clearies more.
  const bubbles = look.core === 'clearie' ? 9 : 3;
  const bubbleMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.05, metalness: 0.2 });
  for (let i = 0; i < bubbles; i++) {
    const b = new THREE.Mesh(cached('bubble', () => new THREE.SphereGeometry(1, 10, 8)), bubbleMat);
    b.position.copy(new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(r * (0.3 + rand() * 0.55)));
    b.scale.setScalar(r * (0.02 + rand() * 0.035));
    group.add(b);
  }
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.renderOrder = 1;
  });

  // ---- Glass shell --------------------------------------------------------------------------
  const tint = new THREE.Color(look.base);
  const glass =
    quality === 'low'
      ? new THREE.MeshPhysicalMaterial({
          color: tint,
          roughness: 0.03,
          clearcoat: 1,
          clearcoatRoughness: 0.03,
          transparent: true,
          opacity: look.core === 'clearie' ? 0.5 : 1 - look.clarity * 0.7,
          envMapIntensity: 2,
          depthWrite: false,
        })
      : new THREE.MeshPhysicalMaterial({
          color: '#ffffff',
          roughness: 0,
          transmission: look.clarity,
          // three's transmission is screen-space: thickness sets how far the refracted image
          // shifts. A full diameter smears the interior to the rim; ~0.6r gives a real
          // marble's gentle magnification.
          thickness: r * 0.6,
          ior: 1.5,
          attenuationColor: tint,
          attenuationDistance: look.core === 'clearie' ? r * 2.6 : r * 7,
          dispersion: quality === 'high' ? 0.35 : 0,
          specularIntensity: 1,
          envMapIntensity: 1.15,
          iridescence: look.core === 'opal' ? 1 : look.core === 'galaxy' ? 0.4 : 0,
          iridescenceIOR: 1.6,
        });
  const shell = new THREE.Mesh(sphere(r, seg), glass);
  shell.castShadow = true;
  shell.renderOrder = 2;
  group.add(shell);

  // Coloured caustic: the light focused through the glass lands on the ground.
  const cc = new THREE.Color(look.core === 'clearie' ? look.base : look.accent).lerp(new THREE.Color('#ffffff'), 0.35);
  const caustic = new THREE.Mesh(
    cached(`caustic-${r}`, () => new THREE.PlaneGeometry(r * 3.2, r * 3.2)),
    new THREE.MeshBasicMaterial({ map: causticTexture(), color: cc, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  caustic.rotation.x = -Math.PI / 2;
  caustic.renderOrder = 1;
  return { group, caustic };
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.dispose();
      // Shared cached geometry stays; per-marble ribbons are freed.
      if (m.geometry && !cachedSet.has(m.geometry)) m.geometry.dispose();
    }
  });
}
