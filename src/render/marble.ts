/**
 * Marbles. A glass marble is a transmissive shell (real refraction of what is
 * inside and behind it, a touch of dispersion, tinted by attenuation) around
 * an interior built from actual geometry: cat's-eye vanes, swirl ribbons,
 * aventurine sparkle, bubbles. Steelies are polished metal. Each glass marble
 * also throws a coloured caustic on the ground.
 *
 * Quality "low" swaps transmission for a cheaper clearcoat shell so older
 * phones keep their frame rate; the interiors stay.
 */
import * as THREE from 'three';

export type MarblePattern = 'catseye' | 'swirl' | 'galaxy' | 'clearie' | 'onionskin' | 'steelie';

export interface MarbleLook {
  name?: string;
  /** Glass tint (clear glass is near white). */
  base: string;
  /** Interior colours. */
  swirl: string[];
  pattern: MarblePattern;
}

export type Quality = 'high' | 'low';

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}

/** A cat's-eye vane: a flame-shaped blade along the y axis, twisted a little. */
function vaneGeometry(r: number, twist: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const L = r * 0.8;
  const W = r * 0.2;
  shape.moveTo(0, -L);
  shape.bezierCurveTo(W, -L * 0.5, W * 1.15, L * 0.45, 0, L);
  shape.bezierCurveTo(-W * 1.15, L * 0.45, -W, -L * 0.5, 0, -L);
  const g = new THREE.ShapeGeometry(shape, 24);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = (v.y / L) * twist;
    // Twist about the long axis and curve the blade slightly.
    const x = v.x * Math.cos(a);
    const z = v.x * Math.sin(a) + (v.y * v.y) / (L * 8);
    pos.setXYZ(i, x, v.y, z);
  }
  g.computeVertexNormals();
  return g;
}

/** A flat ribbon following a curve, for swirls and onionskin streaks. */
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
  constructor(private r: number, private turns: number, private phase: number, private tilt: number) {
    super();
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

export interface MarbleMesh {
  /** Rotates with the physics body. */
  group: THREE.Group;
  /** Stays flat on the ground; follows position only. */
  caustic: THREE.Mesh | null;
  radius: number;
  dispose(): void;
}

export function createMarble(look: MarbleLook, radius: number, quality: Quality, seedKey = ''): MarbleMesh {
  const group = new THREE.Group();
  const r = radius;
  const rand = rng(hash(JSON.stringify(look) + seedKey));
  const owned: (THREE.Material | THREE.BufferGeometry)[] = [];
  const own = <T extends THREE.Material | THREE.BufferGeometry>(x: T): T => {
    owned.push(x);
    return x;
  };

  if (look.pattern === 'steelie') {
    const m = own(new THREE.MeshPhysicalMaterial({ color: look.base, metalness: 1, roughness: 0.12, clearcoat: 0.6, clearcoatRoughness: 0.05, envMapIntensity: 1.6 }));
    const s = new THREE.Mesh(cached(`sphere-${r}`, () => new THREE.SphereGeometry(r, 48, 32)), m);
    s.castShadow = true;
    group.add(s);
    return { group, caustic: null, radius: r, dispose: () => owned.forEach((o) => o.dispose()) };
  }

  const interiorMat = (color: string, glow = 0) =>
    own(
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.35,
        metalness: 0.0,
        side: THREE.DoubleSide,
        emissive: new THREE.Color(color),
        emissiveIntensity: glow,
      }),
    );

  if (look.pattern === 'catseye') {
    const n = 3 + Math.floor(rand() * 2);
    const g = cached(`vane-${r}`, () => vaneGeometry(r, 1.1));
    for (let i = 0; i < n; i++) {
      const v = new THREE.Mesh(g, interiorMat(look.swirl[i % look.swirl.length], 0.12));
      v.rotation.y = (i / n) * Math.PI + rand() * 0.15;
      v.castShadow = true;
      group.add(v);
    }
  } else if (look.pattern === 'swirl' || look.pattern === 'onionskin') {
    const n = look.pattern === 'onionskin' ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const curve = new SpiralCurve(r * (look.pattern === 'onionskin' ? 1.05 : 0.95), 0.6 + rand() * 0.8, (i / n) * Math.PI * 2, (rand() - 0.5) * 0.6);
      const g = own(ribbonGeometry(curve, r * (look.pattern === 'onionskin' ? 0.22 : 0.14 + rand() * 0.08)));
      group.add(new THREE.Mesh(g, interiorMat(look.swirl[i % look.swirl.length], 0.1)));
    }
    if (look.pattern === 'onionskin') {
      // Opaque-ish milky core the streaks wrap around.
      group.add(new THREE.Mesh(cached(`core-${r}`, () => new THREE.SphereGeometry(r * 0.55, 24, 16)), interiorMat('#f6f1e6', 0.05)));
    }
  } else if (look.pattern === 'galaxy') {
    // Deep core with aventurine flecks that catch the light (and the bloom).
    group.add(new THREE.Mesh(cached(`core-${r}`, () => new THREE.SphereGeometry(r * 0.55, 24, 16)), interiorMat(look.swirl[2] ?? '#0b0f2a', 0.05)));
    const flake = cached(`flake-${r}`, () => new THREE.OctahedronGeometry(r * 0.045, 0));
    const count = 70;
    const inst = new THREE.InstancedMesh(
      flake,
      own(new THREE.MeshStandardMaterial({ color: look.swirl[0], emissive: new THREE.Color(look.swirl[0]), emissiveIntensity: 2.2, metalness: 0.6, roughness: 0.2 })),
      count,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      do p.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
      while (p.lengthSq() > 1);
      p.multiplyScalar(r * 0.82);
      q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6));
      m.compose(p, q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.5 + rand()));
      inst.setMatrixAt(i, m);
    }
    group.add(inst);
    const ribbon = own(ribbonGeometry(new SpiralCurve(r * 0.9, 1.2, rand() * 6, 0.4), r * 0.18));
    group.add(new THREE.Mesh(ribbon, interiorMat(look.swirl[1] ?? look.swirl[0], 0.35)));
  }

  // Bubbles: every glass marble has a few, clearies a few more.
  const bubbles = look.pattern === 'clearie' ? 9 : 3;
  const bubbleMat = own(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.05, metalness: 0.2 }));
  for (let i = 0; i < bubbles; i++) {
    const b = new THREE.Mesh(cached(`bubble`, () => new THREE.SphereGeometry(1, 10, 8)), bubbleMat);
    const p = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(r * (0.3 + rand() * 0.55));
    b.position.copy(p);
    b.scale.setScalar(r * (0.02 + rand() * 0.035));
    group.add(b);
  }

  const tint = new THREE.Color(look.base);
  const glass =
    quality === 'high'
      ? own(
          new THREE.MeshPhysicalMaterial({
            color: '#ffffff',
            metalness: 0,
            roughness: 0.03,
            transmission: 1,
            thickness: r * 1.6,
            ior: 1.52,
            attenuationColor: tint,
            attenuationDistance: look.pattern === 'clearie' ? r * 2.2 : r * 5,
            dispersion: 0.25,
            clearcoat: 1,
            clearcoatRoughness: 0.03,
            specularIntensity: 1,
            envMapIntensity: 1.8,
            iridescence: look.pattern === 'galaxy' ? 0.4 : 0,
          }),
        )
      : own(
          new THREE.MeshPhysicalMaterial({
            color: tint,
            roughness: 0.03,
            clearcoat: 1,
            clearcoatRoughness: 0.03,
            transparent: true,
            opacity: look.pattern === 'clearie' ? 0.5 : 0.3,
            envMapIntensity: 2,
            depthWrite: false,
          }),
        );
  const shell = new THREE.Mesh(cached(`sphere-${r}`, () => new THREE.SphereGeometry(r, 48, 32)), glass);
  shell.castShadow = true;
  shell.renderOrder = 2;
  group.add(shell);

  // Coloured caustic: the light focused through the glass lands on the ground.
  const causticColor = new THREE.Color(look.pattern === 'clearie' ? look.base : look.swirl[0]).lerp(new THREE.Color('#ffffff'), 0.35);
  const caustic = new THREE.Mesh(
    cached(`caustic-${r}`, () => new THREE.PlaneGeometry(r * 3.2, r * 3.2)),
    own(
      new THREE.MeshBasicMaterial({
        map: causticTexture(),
        color: causticColor,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );
  caustic.rotation.x = -Math.PI / 2;
  caustic.renderOrder = 1;

  return { group, caustic, radius: r, dispose: () => owned.forEach((o) => o.dispose()) };
}

/** Taws a player can use; story wins unlock more (the fighters' own marbles). */
export const TAWS: MarbleLook[] = [
  { name: 'Midnight Galaxy', base: '#9fb4ff', swirl: ['#ffffff', '#5ad1ff', '#0b1030'], pattern: 'galaxy' },
  { name: 'Classic Cat\'s Eye', base: '#e8f6ff', swirl: ['#ff3b5c', '#1f7bff', '#ffd23f'], pattern: 'catseye' },
  { name: 'Jade Swirl', base: '#bff5d8', swirl: ['#0f8a52', '#5cff9d', '#ffffff'], pattern: 'swirl' },
  { name: 'Sunburst Onionskin', base: '#fff1cf', swirl: ['#ff6a00', '#ffd23f', '#ff3b5c', '#ffffff'], pattern: 'onionskin' },
];

/** Target marbles in the cross: a mixed bag, as in any real bag of marbles. */
export const TARGET_LOOKS: MarbleLook[] = [
  { base: '#eaf6ff', swirl: ['#1f7bff', '#ffffff', '#5ad1ff'], pattern: 'catseye' },
  { base: '#fff4e6', swirl: ['#ff5a36', '#ffd23f', '#ffffff'], pattern: 'catseye' },
  { base: '#e9ffe9', swirl: ['#17b35a', '#c2ff7a', '#ffffff'], pattern: 'catseye' },
  { base: '#f2e9ff', swirl: ['#8a4dff', '#ff7ad9', '#ffffff'], pattern: 'swirl' },
  { base: '#9fe8ff', swirl: ['#ffffff'], pattern: 'clearie' },
  { base: '#e6fbff', swirl: ['#00b3c7', '#004e7c', '#ffffff'], pattern: 'swirl' },
  { base: '#ffd9a8', swirl: ['#ffffff'], pattern: 'clearie' },
  { base: '#fff6ea', swirl: ['#c2185b', '#ffd23f', '#1f7bff', '#ffffff'], pattern: 'onionskin' },
];
