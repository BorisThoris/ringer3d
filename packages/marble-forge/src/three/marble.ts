import * as THREE from 'three';
import { hashString, Rng } from '../rng';
import type { MarbleLook } from '../look';
import { marbleTexture } from './textures';
import { buildBodyVolume, buildCoreVolume, buildEffect } from './effects';
import { inkMaterial } from './ink';
import { scratchOverlay, surfaceMaps } from './surface';
import { surfaceFlaws } from '../flaws';
import { marbleBody, type MarbleBody } from '../body';

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
  /** The soft dark patch where the marble meets the ground; follows position only. */
  contact: THREE.Mesh;
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

let contactTex: THREE.Texture | null = null;
/** A soft dark disc: the ambient occlusion where a ball meets the ground. */
function contactTexture(): THREE.Texture {
  if (contactTex) return contactTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.35, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  contactTex = new THREE.CanvasTexture(c);
  return contactTex;
}

function contactShadow(r: number): THREE.Mesh {
  const m = new THREE.Mesh(
    cached(`contact-${r}`, () => new THREE.PlaneGeometry(r * 2.8, r * 2.8)),
    new THREE.MeshBasicMaterial({ map: contactTexture(), color: '#000000', transparent: true, opacity: 0.55, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

/** The marble's ink outline: a back-face hull, its width a share of the radius. */
function inkHull(r: number, seg: number): THREE.Mesh {
  const hull = new THREE.Mesh(sphere(r, seg), inkMaterial(r * 0.14));
  hull.userData.isInk = true;
  return hull;
}

/**
 * Real glass goes dark at grazing angles. A thin shell that darkens toward the silhouette
 * reads as glass and outlines a marble against bright ground (sand, snow, paper).
 */
export function edgeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { color: { value: new THREE.Color('#0b0912') }, strength: { value: 0.9 } },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float strength;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = pow(f, 1.7) * strength;
        gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`,
  });
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

/**
 * The marble's surface on its outer mesh: the normal map (ripple, seam, pits, grooves) and the
 * roughness map (base roughness plus fingerprints and wear). The mesh turns so the seam runs
 * where this marble's seam runs; the pale scratch overlay turns with it.
 */
function applySurface(mesh: THREE.Mesh, look: MarbleLook, quality: Quality, bump = 1): [number, number] {
  const mat = mesh.material as THREE.MeshPhysicalMaterial;
  const maps = surfaceMaps(look, mat.roughness, quality === 'high');
  if (maps.normal) {
    mat.normalMap = maps.normal;
    mat.normalScale.set(bump, bump);
    if (mat.clearcoat > 0) {
      mat.clearcoatNormalMap = maps.normal;
      mat.clearcoatNormalScale.set(bump, bump);
    }
  }
  if (maps.roughness) {
    mat.roughnessMap = maps.roughness;
    mat.roughness = 1;
    if (quality === 'low' && mat.clearcoat > 0) mat.clearcoatRoughnessMap = maps.roughness;
  }
  mesh.rotation.set(maps.turn[0], 0, maps.turn[1]);
  return maps.turn;
}

function addScratches(group: THREE.Group, look: MarbleLook, r: number, seg: number, turn: [number, number]) {
  const scratches = scratchOverlay(look);
  if (!scratches) return;
  const skin = new THREE.Mesh(
    sphere(r * 1.004, seg),
    new THREE.MeshBasicMaterial({ map: scratches, transparent: true, opacity: 0.25 + (look.wear ?? 0) * 0.4, depthWrite: false }),
  );
  skin.renderOrder = 3;
  skin.rotation.set(turn[0], 0, turn[1]);
  group.add(skin);
}

export function buildMarble(look: MarbleLook, radius: number, quality: Quality, seed = 1): BuiltMarble {
  const group = new THREE.Group();
  group.userData.radius = radius;
  const r = radius;
  // A generated marble carries its own shape: seed the details from its id, so it looks the
  // same in every slot and every renderer. Named marbles vary with the slot's seed.
  const rand = rng(look.shape ? (hashString(look.id) % 100000) + 1 : seed + look.id.length * 0.37);
  const shape = look.shape;
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
  // A phenomenon needs to be seen: its marble leaves out the opaque cores some patterns have.
  const hollow = !!look.effect && look.effect !== 'none';
  // Galaxies and onyx get a deep glowing interior (a nebula, magma veins); a phenomenon replaces it.
  const deep = hollow ? null : look.core === 'galaxy' ? 'nebula' : look.core === 'onyx' ? 'magma' : null;

  // ---- Opaque marbles ----------------------------------------------------------------------
  if (look.core === 'steelie') {
    // Chrome is nothing but reflection: push the environment hard. Worn chrome scuffs, and
    // its orange peel reads as hammered metal.
    const chrome = new THREE.MeshPhysicalMaterial({ color: look.base, metalness: 1, roughness: 0.04, clearcoat: 0.6, clearcoatRoughness: 0.05, envMapIntensity: 3 });
    const s = new THREE.Mesh(sphere(r, seg), chrome);
    s.castShadow = true;
    group.add(s, inkHull(r, seg));
    addScratches(group, look, r, seg, applySurface(s, look, quality, 0.7));
    return { group, caustic: null, contact: contactShadow(r) };
  }
  if (look.core === 'solid' || look.clarity < 0.05) {
    const s = new THREE.Mesh(
      sphere(r, seg),
      new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: marbleTexture('clay', look.base, look.accent2, 3), roughness: 0.75, clearcoat: 0.15 }),
    );
    s.castShadow = true;
    group.add(s, inkHull(r, seg));
    addScratches(group, look, r, seg, applySurface(s, look, quality, 1.4));
    return { group, caustic: null, contact: contactShadow(r) };
  }

  // ---- Interiors ---------------------------------------------------------------------------
  const colors = [look.accent, look.accent2, look.base];
  const before = group.children.length;
  switch (look.core) {
    case 'catseye': {
      const n = shape?.blades ?? 3 + Math.floor(rand() * 2);
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
        const curve = new SpiralCurve(r * (onion ? 0.95 : 0.85), (shape?.turns ?? 1) * (0.6 + rand() * 0.8), (i / n) * Math.PI * 2, (rand() - 0.5) * 0.6);
        group.add(new THREE.Mesh(ribbonGeometry(curve, r * (shape?.width ?? 1) * (onion ? 0.15 : 0.07 + rand() * 0.05)), interior(colors[i % 2], glowK)));
      }
      if (onion && !hollow) group.add(new THREE.Mesh(sphere(r * 0.55, 24), interior('#f6f1e6', 0.05)));
      break;
    }
    case 'galaxy': {
      // Deep core with aventurine flecks that catch the light (and the bloom).
      if (!hollow) group.add(new THREE.Mesh(sphere(r * 0.55, 24), interior(look.base, 0.05)));
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
      if (!hollow) group.add(new THREE.Mesh(sphere(r * 0.5, 24), interior(look.base, 0.02)));
      break;
    }
    case 'onyx': {
      const tex = marbleTexture('cracks', look.accent, look.accent2, Math.floor(seed * 10) + 11);
      group.add(
        new THREE.Mesh(
          sphere(r * 0.96, seg),
          hollow
            ? new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color('#ffffff').multiplyScalar(0.6 + look.glow), blending: THREE.AdditiveBlending, depthWrite: false })
            : new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffffff').multiplyScalar(look.glow * 1.6), roughness: 0.5 }),
        ),
      );
      break;
    }
    case 'opal':
      group.add(
        new THREE.Mesh(
          sphere(r * (hollow ? 0.38 : 0.7), seg),
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

  // The interior leans the way this marble's shape says.
  if (shape?.tilt) {
    const lean = new THREE.Group();
    lean.rotation.set(shape.tilt, 0, shape.tilt * 0.6);
    lean.add(...group.children.slice(before));
    group.add(lean);
  }

  // Glitter: generated collectibles carry flecks through the glass (galaxies have their own).
  const sparkle = look.sparkle ?? 0;
  if (sparkle > 0.02 && look.core !== 'galaxy') {
    const count = Math.round((quality === 'low' ? 40 : 120) * sparkle);
    const flake = cached(`flake-${r}`, () => new THREE.OctahedronGeometry(r * 0.018, 0));
    const inst = new THREE.InstancedMesh(
      flake,
      new THREE.MeshStandardMaterial({ color: look.accent2, emissive: new THREE.Color(look.accent2), emissiveIntensity: 1.6, metalness: 0.7, roughness: 0.15 }),
      count,
    );
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      do p.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
      while (p.lengthSq() > 1);
      p.multiplyScalar(r * 0.85);
      m.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6)), new THREE.Vector3(1, 1, 1).multiplyScalar(0.5 + rand()));
      inst.setMatrixAt(i, m);
    }
    group.add(inst);
  }

  // Bubbles: every glass marble has a few, clearies more.
  const bubbles = (shape?.bubbles ?? 3) + (look.core === 'clearie' ? 6 : 0);
  const bubbleMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.05, metalness: 0.2 });
  for (let i = 0; i < bubbles; i++) {
    const b = new THREE.Mesh(cached('bubble', () => new THREE.SphereGeometry(1, 10, 8)), bubbleMat);
    b.position.copy(new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(r * (0.3 + rand() * 0.55)));
    b.scale.setScalar(r * (0.02 + rand() * 0.035));
    group.add(b);
  }
  // Flaws inside the glass: a trail of seed bubbles, and now and then a grain of sand that
  // never melted (a "stone").
  const flaws = look.flaws === false ? null : surfaceFlaws(look.id);
  if (flaws && (flaws.seeds || flaws.stone)) {
    const fr = new Rng(hashString(`seeds:${look.id}`));
    const at = () => new THREE.Vector3(fr.range(-1, 1), fr.range(-1, 1), fr.range(-1, 1)).normalize();
    if (flaws.seeds) {
      const p = at().multiplyScalar(r * fr.range(0.3, 0.7));
      const dir = at();
      const bend = at().multiplyScalar(0.25);
      for (let i = 0; i < flaws.seeds; i++) {
        const b = new THREE.Mesh(cached('bubble', () => new THREE.SphereGeometry(1, 10, 8)), bubbleMat);
        b.position.copy(p);
        b.scale.setScalar(r * fr.range(0.006, 0.014));
        group.add(b);
        p.addScaledVector(dir.add(bend).normalize(), r * fr.range(0.025, 0.05));
        if (p.length() > r * 0.88) break;
      }
    }
    if (flaws.stone) {
      const grain = new THREE.Mesh(
        cached('stone', () => new THREE.IcosahedronGeometry(1, 0)),
        new THREE.MeshStandardMaterial({ color: fr.next() < 0.5 ? '#efe6d2' : '#8a7458', roughness: 0.95, flatShading: true }),
      );
      grain.position.copy(at().multiplyScalar(r * fr.range(0.35, 0.75)));
      grain.scale.set(r * fr.range(0.02, 0.035), r * fr.range(0.015, 0.03), r * fr.range(0.02, 0.035));
      grain.rotation.set(fr.next() * 6, fr.next() * 6, 0);
      group.add(grain);
    }
  }
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.renderOrder = 1;
  });

  // A phenomenon: a living effect inside the glass (three/effects.ts).
  const effect = buildEffect(look, r, quality);
  if (effect) group.add(effect);
  if (deep) group.add(buildCoreVolume(deep, look, r, quality));

  // The glass body: milk and little clouds in the glass, and the glass's own optics (body.ts).
  // A phenomenon needs to be seen, so its glass stays nearly clear and lightly clouded; ribbons
  // and cores need it too, so only a clearie (nothing inside but the glass) takes the full body.
  const hasFxBody = !!look.effect && look.effect !== 'none';
  const body: MarbleBody | null = look.body === false ? null : marbleBody(look.id);
  if (body) {
    // Opal is milky already: more milk would only wash it white. Over ribbons the clouds go thin.
    const [veil, thin] = hasFxBody
      ? [{ ...body, milk: 0, clouds: body.clouds * 0.5 }, 0.2]
      : look.core === 'clearie'
        ? [body, 1]
        : look.core === 'opal'
          ? [{ ...body, milk: 0 }, 0.4]
          : [{ ...body, milk: body.milk * 0.25 }, 0.25];
    const vol = buildBodyVolume(look, veil, r, quality, hashString(`cloud:${look.id}`), thin);
    if (vol) group.add(vol);
  }

  // ---- Glass shell --------------------------------------------------------------------------
  const tint = new THREE.Color(look.base);
  // Near-black glass (galaxies, neon, onyx) would swallow its own interior: let more light
  // through and absorb toward the accent instead of black. A phenomenon wants clear glass.
  const dark = tint.r * 0.2126 + tint.g * 0.7152 + tint.b * 0.0722 < 0.05;
  const hasFx = !!look.effect && look.effect !== 'none';
  const clarity = hasFx ? Math.max(look.clarity, 0.72) : dark ? Math.max(look.clarity, 0.5) : look.clarity;
  const absorb = dark ? tint.clone().lerp(new THREE.Color(look.accent), 0.45) : tint;
  const glass =
    quality === 'low'
      ? new THREE.MeshPhysicalMaterial({
          color: tint,
          roughness: 0.03,
          clearcoat: 1,
          clearcoatRoughness: 0.03,
          transparent: true,
          opacity: look.core === 'clearie' ? 0.5 : 1 - clarity * 0.7,
          envMapIntensity: 2,
          depthWrite: false,
        })
      : new THREE.MeshPhysicalMaterial({
          // The part that is not transmitted shows the shell colour: white made every
          // low-clarity marble (a dark galaxy, a neon core) read as milky haze. Tint it
          // toward the marble's own base, more so the less clear the glass is.
          // Tinted glass (the targets) takes its colour straight; clear glass only a touch.
          // Dark glass keeps its own deep colour (lifted a little); lerping it toward white by
          // clarity turned galaxies and onyx milky grey.
          color: dark ? absorb.clone().lerp(new THREE.Color('#ffffff'), 0.22) : clarity < 0.5 ? tint.clone() : new THREE.Color('#ffffff').lerp(tint, 1 - clarity),
          // Finishes of generated collectibles: frosted glass is matte, pearl and holo shimmer,
          // prism splits the light into colours.
          roughness: look.finish === 'frosted' ? 0.38 : 0,
          transmission: clarity,
          // three's transmission is screen-space: thickness sets how far the refracted image
          // shifts. A full diameter smears the interior to the rim; ~0.6r gives a real
          // marble's gentle magnification.
          thickness: r * (body?.thickness ?? 0.6),
          ior: body?.ior ?? 1.5,
          attenuationColor: absorb,
          // Tinted glass deepens its colour quickly; clear glass barely at all.
          attenuationDistance: (look.core === 'clearie' ? r * 2.6 : dark ? r * 4.5 : clarity < 0.5 ? r * 2.2 : r * 7) * (body?.depth ?? 1),
          dispersion: quality === 'high' ? (look.finish === 'prism' ? 1.2 : body?.dispersion ?? 0.35) : 0,
          specularIntensity: 1,
          envMapIntensity: 1.15,
          iridescence: look.finish === 'holo' || look.finish === 'prism' || look.core === 'opal' ? 1 : look.finish === 'pearl' ? 0.6 : look.core === 'galaxy' ? 0.4 : 0,
          sheen: look.finish === 'pearl' ? 1 : 0,
          sheenColor: new THREE.Color(look.accent2),
          metalness: look.finish === 'metallic' ? 0.35 : 0,
          iridescenceIOR: 1.6,
        });
  // Flaws and wear: the maps carry the base roughness plus the marks.
  const shell = new THREE.Mesh(sphere(r, seg), glass);
  shell.castShadow = true;
  shell.renderOrder = 2;
  group.add(shell);
  addScratches(group, look, r, seg, applySurface(shell, look, quality));
  // The ink line round the glass, like every solid thing in the cel-shaded world.
  group.add(inkHull(r, seg));

  // Coloured caustic: the light focused through the glass lands on the ground.
  const cc = new THREE.Color(look.core === 'clearie' ? look.base : look.accent).lerp(new THREE.Color('#ffffff'), 0.35);
  const caustic = new THREE.Mesh(
    cached(`caustic-${r}`, () => new THREE.PlaneGeometry(r * 3.2, r * 3.2)),
    new THREE.MeshBasicMaterial({ map: causticTexture(), color: cc, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  caustic.rotation.x = -Math.PI / 2;
  caustic.renderOrder = 1;
  return { group, caustic, contact: contactShadow(r) };
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      // Ink materials are shared by every outline; they stay.
      if (m.userData.isInk) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.dispose();
      // Shared cached geometry stays; per-marble ribbons are freed.
      if (m.geometry && !cachedSet.has(m.geometry)) m.geometry.dispose();
    }
  });
}
