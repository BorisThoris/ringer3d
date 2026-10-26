import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD } from '../core/constants';
import { Rng } from '../core/rng';
import type { Arena, ArenaId } from '../game/arenas';
import { hdri } from './assets';
import { groundArt } from './groundArt';
import type { Quality } from './marbleMesh';
import { radialGlowTexture, ringTexture } from './textures';

/**
 * Builds a field as a toy diorama: a disc of hand-painted ground (groundArt.ts), a chunky
 * bank along the edge of play that looks like what the physics edge does (a stone kerb
 * bounces, a snowbank or a sand berm swallows), a few rounded props standing out in the
 * fog, and soft, bright light. Everything is made in code; the field's HDRI is never shown,
 * it only fills the glossy marbles with a real place to reflect.
 *
 * Map pieces (obstacles, hazards) are built separately (mapPieces.ts), per match.
 */
export interface BuiltArena {
  root: THREE.Group;
  /** Fallback reflection scene, used until the HDRI arrives. */
  envScene: THREE.Scene;
  sun: THREE.DirectionalLight;
  /** The colour the world fades into beyond the edge. */
  fog: THREE.Color;
  /** HDRI lighting for this field (null if it failed to load). */
  sky: Promise<{ hdr: THREE.DataTexture | null }>;
  update(t: number, dt: number): void;
  dispose(): void;
}

const R = WORLD.ringRadius;
const B = WORLD.boundaryRadius;
/** Ground: solid out past the edge bank, then fading into the fog. */
const GROUND_SOLID = B + 4;
const GROUND_OUTER = B + 16;

/** The bank along the edge of play, as a lathe profile (radius offset from B, height). */
const BANK: Record<ArenaId, { profile: [number, number][]; color: string; rough?: number }> = {
  // A rounded wooden lip, like a tray rim on the desk.
  desk: { profile: [[-0.1, 0], [-0.1, 0.4], [0.05, 0.55], [0.55, 0.55], [0.7, 0.4], [0.7, 0]], color: '#8a5634', rough: 0.6 },
  // A stone kerb: square and hard, edges softened.
  culdesac: { profile: [[0, 0], [0, 0.58], [0.08, 0.68], [1.35, 0.7], [1.5, 0.6], [1.5, 0]], color: '#c9c3b8' },
  // A soft green berm; tufts sit on it.
  grass: { profile: [[-0.2, 0], [0.6, 0.35], [1.6, 0.55], [3, 0.2], [3.8, 0]], color: '#4f9a37' },
  sand: { profile: [[-0.3, 0], [0.8, 0.55], [2, 0.75], [3.4, 0.3], [4.2, 0]], color: '#d6b67f' },
  ice: { profile: [[-0.3, 0], [0.4, 0.6], [1.6, 1.05], [3, 0.6], [4, 0]], color: '#f4f8fc' },
  gravel: { profile: [[-0.2, 0], [0.6, 0.5], [1.8, 0.7], [3.2, 0.25], [4, 0]], color: '#a39a8f' },
  // A painted rail, like every course's border.
  minigolf: { profile: [[0, 0], [0, 0.55], [0.06, 0.62], [0.42, 0.62], [0.48, 0.55], [0.48, 0]], color: '#f6f2e8', rough: 0.5 },
};

export function buildArena(arena: Arena, quality: Quality): BuiltArena {
  const root = new THREE.Group();
  const envScene = new THREE.Scene();
  const updaters: ((t: number, dt: number) => void)[] = [];
  const owned: { dispose(): void }[] = [];
  const rng = new Rng(arena.id.length * 1013 + 7);
  const own = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const fog = new THREE.Color(arena.fog.color);
  const shadows = quality !== 'low';

  // ---- Fallback reflections (until the HDRI arrives) ------------------------------------
  const skyMat = own(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(arena.sky.top) }, bottom: { value: new THREE.Color(arena.sky.bottom) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
        void main(){ float h = clamp(vP.y*1.4+0.15, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0);
        #include <colorspace_fragment>
        }`,
    }),
  );
  envScene.add(new THREE.Mesh(own(new THREE.SphereGeometry(300, 32, 16)), skyMat));
  const envGround = new THREE.Mesh(own(new THREE.CircleGeometry(200, 32)), own(new THREE.MeshBasicMaterial({ color: arena.groundColor })));
  envGround.rotation.x = -Math.PI / 2;
  envScene.add(envGround);

  // ---- Lights: a soft, bright toy-box key and a generous sky fill ------------------------
  const hemi = new THREE.HemisphereLight(arena.ambient.sky, arena.ambient.ground, 0.5);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(arena.sun.color, Math.min(2.4, arena.sun.intensity) * 0.6 + 0.35);
  sun.position.set(...arena.sun.dir);
  sun.castShadow = shadows;
  const sm = quality === 'high' ? 4096 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -(B + 9);
  sc.right = sc.top = B + 9;
  sc.near = 1;
  sc.far = 90;
  sun.position.multiplyScalar(4);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  // Soft-edged shadows, like a studio light over a model.
  sun.shadow.radius = 6;
  root.add(sun, sun.target);

  // ---- Helpers --------------------------------------------------------------------------
  /** Planar UVs in world units so neighbouring ground pieces tile seamlessly. */
  const planarUV = (geo: THREE.BufferGeometry, size: number) => {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / size + 0.5, pos.getY(i) / size + 0.5);
    return geo;
  };
  const matte = (color: string, rough = 0.9) => own(new THREE.MeshStandardMaterial({ color, roughness: rough, envMapIntensity: 0.4 }));
  const place = (m: THREE.Object3D, r: number, a: number, y = 0) => {
    m.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = shadows;
        mesh.receiveShadow = true;
      }
    });
    root.add(m);
    return m;
  };
  /** A smooth, slightly lumpy blob (bushes, boulders, snow mounds). */
  const blobGeo = (seed: number, detail = 3) => {
    const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail));
    const p = g.attributes.position as THREE.BufferAttribute;
    const r = new Rng(seed);
    const dirs = Array.from({ length: 4 }, () => new THREE.Vector3(r.range(-1, 1), r.range(-0.4, 1), r.range(-1, 1)).normalize());
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      let k = 1;
      for (const d of dirs) k += Math.max(0, v.dot(d)) ** 2 * 0.12;
      p.setXYZ(i, v.x * k, v.y * k, v.z * k);
    }
    g.computeVertexNormals();
    return own(g);
  };

  // ---- Ground: opaque where the game is played, fading into the fog beyond ---------------
  const art = groundArt(arena.id);
  const size = GROUND_OUTER * 2;
  const reps = size / art.tile;
  const map = art.map.clone();
  const normalMap = art.normalMap.clone();
  for (const t of [map, normalMap]) {
    t.repeat.set(reps, reps);
    t.needsUpdate = true;
    own(t);
  }
  const groundMat = (transparent: boolean) =>
    own(
      new THREE.MeshStandardMaterial({
        map,
        normalMap,
        normalScale: new THREE.Vector2(art.normalScale, art.normalScale),
        roughness: art.roughness,
        // Matte ground: it should not throw glints that compete with the glass.
        envMapIntensity: arena.id === 'ice' ? 0.45 : 0.3,
        transparent,
        depthWrite: !transparent,
      }),
    );
  const inner = groundMat(false);
  const rim = groundMat(true);
  const fade = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g2 = c.getContext('2d')!;
    const grad = g2.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(GROUND_SOLID / GROUND_OUTER, '#fff');
    grad.addColorStop(1, '#000');
    g2.fillStyle = grad;
    g2.fillRect(0, 0, 256, 256);
    return own(new THREE.CanvasTexture(c));
  })();
  rim.alphaMap = fade;
  const disc = new THREE.Mesh(own(planarUV(new THREE.CircleGeometry(GROUND_SOLID, 128), size)), inner);
  const outer = new THREE.Mesh(own(planarUV(new THREE.RingGeometry(GROUND_SOLID, GROUND_OUTER, 128, 4), size)), rim);
  for (const m of [disc, outer]) {
    m.rotation.x = -Math.PI / 2;
    m.receiveShadow = true;
    root.add(m);
  }
  outer.renderOrder = -1;

  // ---- The edge of play: a chunky bank that looks like what the physics edge does --------
  const bank = BANK[arena.id];
  const pts = bank.profile.map(([dr, h]) => new THREE.Vector2(B + dr, h));
  // The lathe winds its faces inward: draw both sides so the bank is lit from outside.
  const bankMat = own(new THREE.MeshStandardMaterial({ color: bank.color, roughness: bank.rough ?? 0.92, side: THREE.DoubleSide, envMapIntensity: 0.4 }));
  const bankMesh = new THREE.Mesh(own(new THREE.LatheGeometry(pts, 180)), bankMat);
  bankMesh.receiveShadow = true;
  bankMesh.castShadow = quality === 'high';
  root.add(bankMesh);

  // ---- Scenery: a few rounded props out past the edge, fading into the fog --------------
  SCENERY[arena.id]({ rng, matte, place, blobGeo, own, updaters, quality });

  // ---- Fog banks drifting out beyond the scenery ----------------------------------------
  const mistMat = own(new THREE.SpriteMaterial({ map: radialGlowTexture(), color: fog, transparent: true, opacity: 0.35, depthWrite: false, fog: false }));
  const mists: { s: THREE.Sprite; a: number; r: number; speed: number }[] = [];
  const mistCount = quality === 'low' ? 10 : 18;
  for (let i = 0; i < mistCount; i++) {
    const s = new THREE.Sprite(mistMat);
    const scale = rng.range(10, 18);
    s.scale.set(scale, scale * 0.45, 1);
    s.renderOrder = 3;
    const m = { s, a: (i / mistCount) * Math.PI * 2 + rng.range(-0.2, 0.2), r: B + rng.range(9, 15), speed: rng.range(0.01, 0.03) * (rng.next() < 0.5 ? -1 : 1) };
    s.position.y = rng.range(0.6, 2.6);
    mists.push(m);
    root.add(s);
  }
  updaters.push((_t, dt) => {
    for (const m of mists) {
      m.a += m.speed * dt;
      m.s.position.x = Math.cos(m.a) * m.r;
      m.s.position.z = Math.sin(m.a) * m.r;
    }
  });

  // ---- Ring line ------------------------------------------------------------------------
  const ringY = 0.008;
  if (arena.ring.style === 'string') {
    // A loop of cotton string lying on the surface.
    const tube = own(new THREE.TorusGeometry(R, 0.045, 8, 320));
    // Off-white cotton: pure white blooms like a neon tube under the key light.
    const mat = own(new THREE.MeshStandardMaterial({ color: new THREE.Color(arena.ring.color).multiplyScalar(0.42), roughness: 1 }));
    const ring = new THREE.Mesh(tube, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    ring.castShadow = quality === 'high';
    ring.receiveShadow = true;
    root.add(ring);
  } else {
    // A finger-drawn groove in sand is wide and shadowed; chalk and scratches are thin.
    const w = arena.ring.style === 'drawn' ? 0.3 : arena.ring.style === 'chalk' ? 0.11 : 0.08;
    const geo = own(new THREE.RingGeometry(R - w / 2, R + w / 2, 256, 1));
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      uv.setXY(i, ((Math.atan2(y, x) + Math.PI) / (Math.PI * 2)) * 8, (Math.hypot(x, y) - (R - w / 2)) / w);
    }
    const tex = own(ringTexture(arena.ring.style === 'drawn' ? 'chalk' : arena.ring.style));
    tex.wrapS = THREE.RepeatWrapping;
    const mat = own(
      new THREE.MeshStandardMaterial({
        color: arena.ring.color,
        map: tex,
        alphaMap: tex,
        transparent: true,
        opacity: arena.ring.style === 'drawn' ? 0.95 : 1,
        roughness: arena.ring.style === 'etched' ? 0.4 : 0.95,
        depthWrite: false,
      }),
    );
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = ringY;
    ring.receiveShadow = true;
    root.add(ring);
  }

  // ---- Air: dust motes in the lamplight, snow over the lake ------------------------------
  if (arena.id === 'desk' || arena.id === 'ice') {
    const snow = arena.id === 'ice';
    const count = quality === 'low' ? 80 : 240;
    const geo = own(new THREE.BufferGeometry());
    const p = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      p[i * 3] = rng.range(-18, 18);
      p[i * 3 + 1] = rng.range(0, 14);
      p[i * 3 + 2] = rng.range(-18, 18);
      speed[i] = rng.range(0.3, 1);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = own(
      new THREE.PointsMaterial({
        color: snow ? '#ffffff' : '#fff1d6',
        size: snow ? 0.12 : 0.05,
        map: radialGlowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: snow ? 0.9 : 0.55,
      }),
    );
    root.add(new THREE.Points(geo, mat));
    updaters.push((t, dt) => {
      for (let i = 0; i < count; i++) {
        let y = p[i * 3 + 1] + (snow ? -dt * speed[i] * 0.9 : Math.sin(t * 0.3 + i) * dt * 0.08);
        p[i * 3] += Math.sin(t * 0.4 + i) * dt * (snow ? 0.35 : 0.06);
        if (y < 0) y = 14;
        if (y > 14) y = 0;
        p[i * 3 + 1] = y;
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  return {
    root,
    envScene,
    sun,
    fog,
    sky: hdri(arena.assets).then((hdr) => ({ hdr })),
    update: (t, dt) => {
      for (const u of updaters) u(t, dt);
    },
    dispose: () => {
      for (const o of owned) o.dispose();
    },
  };
}

// ---- Scenery ------------------------------------------------------------------------------

interface Kit {
  rng: Rng;
  matte: (color: string, rough?: number) => THREE.MeshStandardMaterial;
  place: (m: THREE.Object3D, r: number, a: number, y?: number) => THREE.Object3D;
  blobGeo: (seed: number, detail?: number) => THREE.BufferGeometry;
  own: <T extends { dispose(): void }>(x: T) => T;
  updaters: ((t: number, dt: number) => void)[];
  quality: Quality;
}

/** Evenly spread angles with a little jitter, so props ring the field without clumping. */
function around(k: Kit, n: number, offset = 0): number[] {
  return Array.from({ length: n }, (_, i) => offset + (i / n) * Math.PI * 2 + k.rng.range(-0.25, 0.25));
}

/** A round bush: three or four soft blobs. */
function bush(k: Kit, size: number, colors: string[]): THREE.Group {
  const g = new THREE.Group();
  const n = 3 + k.rng.int(2);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(k.blobGeo(k.rng.int(1e6), 2), k.matte(colors[i % colors.length], 0.95));
    const s = size * k.rng.range(0.55, 0.85);
    m.scale.set(s, s * 0.85, s);
    m.position.set(k.rng.range(-0.5, 0.5) * size, s * 0.6, k.rng.range(-0.5, 0.5) * size);
    g.add(m);
  }
  return g;
}

/** A toy pine: stacked cones, optionally snow-capped. */
function pine(k: Kit, h: number, snow: boolean): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(k.own(new THREE.CylinderGeometry(h * 0.05, h * 0.07, h * 0.3, 8)), k.matte('#6b4a30'));
  trunk.position.y = h * 0.15;
  g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const r = h * (0.32 - i * 0.07);
    const cone = new THREE.Mesh(k.own(new THREE.ConeGeometry(r, h * 0.42, 10)), k.matte(i % 2 ? '#2f6b45' : '#2a5f3e'));
    cone.position.y = h * (0.36 + i * 0.2);
    g.add(cone);
    if (snow) {
      const cap = new THREE.Mesh(k.own(new THREE.ConeGeometry(r * 0.62, h * 0.17, 10)), k.matte('#f4f8fc'));
      cap.position.y = h * (0.48 + i * 0.2);
      g.add(cap);
    }
  }
  return g;
}

/** A tuft of grass: a fan of thin blades. */
function tufts(k: Kit, n: number, rMin: number, rMax: number, color: string, height: number) {
  const blade = k.own(new THREE.ConeGeometry(0.05, 1, 4));
  blade.translate(0, 0.5, 0);
  const per = 7;
  const inst = new THREE.InstancedMesh(blade, k.matte(color, 0.9), n * per);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  let i = 0;
  for (let t = 0; t < n; t++) {
    const a = k.rng.next() * Math.PI * 2;
    const r = k.rng.range(rMin, rMax);
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    for (let b = 0; b < per; b++) {
      e.set(k.rng.range(-0.45, 0.45), k.rng.next() * Math.PI * 2, k.rng.range(-0.45, 0.45));
      q.setFromEuler(e);
      const h = height * k.rng.range(0.6, 1.1);
      m.compose(new THREE.Vector3(cx + k.rng.range(-0.12, 0.12), 0, cz + k.rng.range(-0.12, 0.12)), q, new THREE.Vector3(1, h, 1));
      inst.setMatrixAt(i++, m);
    }
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = k.quality === 'high';
  inst.receiveShadow = true;
  return inst;
}

const SCENERY: Record<ArenaId, (k: Kit) => void> = {
  // On the desk: a lamp's chunky base and a stack of books, out at the edge of the light.
  desk(k) {
    for (const a of around(k, 3, 0.4)) {
      const stack = new THREE.Group();
      let y = 0;
      for (let i = 0; i < 3; i++) {
        const h = k.rng.range(0.45, 0.7);
        const book = new THREE.Mesh(k.own(new THREE.BoxGeometry(k.rng.range(2.6, 3.4), h, k.rng.range(1.8, 2.2))), k.matte(['#a8322d', '#244c7a', '#2f6b3a', '#c99a2e'][k.rng.int(4)], 0.75));
        book.position.y = y + h / 2;
        book.rotation.y = k.rng.range(-0.3, 0.3);
        y += h;
        stack.add(book);
      }
      k.place(stack, B + k.rng.range(4, 7), a);
    }
  },
  // A street's edge: round hedges along the far side of the kerb.
  culdesac(k) {
    for (const a of around(k, 9)) k.place(bush(k, k.rng.range(1.4, 2.2), ['#3f7f3a', '#4b8f40', '#376f33']), B + k.rng.range(4, 7), a);
  },
  // The lawn: tufts on the berm, round shrubs beyond.
  grass(k) {
    k.place(tufts(k, k.quality === 'low' ? 70 : 160, B - 0.2, B + 3.4, '#3f8a2e', 0.7), 0, 0);
    for (const a of around(k, 8, 0.3)) k.place(bush(k, k.rng.range(1.6, 2.4), ['#3b7d33', '#4a9140', '#2f6d2b']), B + k.rng.range(5, 8), a);
  },
  // The beach: marram grass on the dune, a few smooth rocks.
  sand(k) {
    k.place(tufts(k, k.quality === 'low' ? 40 : 90, B + 0.5, B + 3.6, '#a8a85a', 0.9), 0, 0);
    for (const a of around(k, 5, 1)) {
      const rock = new THREE.Mesh(k.blobGeo(k.rng.int(1e6)), k.matte(['#a89a86', '#97887a'][k.rng.int(2)], 0.9));
      const s = k.rng.range(0.8, 1.6);
      rock.scale.set(s * 1.3, s * 0.8, s);
      k.place(rock, B + k.rng.range(4.5, 7.5), a, s * 0.3);
    }
  },
  // The lake: snowy pines along the shore.
  ice(k) {
    for (const a of around(k, 10)) k.place(pine(k, k.rng.range(4, 6.5), true), B + k.rng.range(5, 8.5), a);
  },
  // The pit: rounded boulders.
  gravel(k) {
    for (const a of around(k, 7, 0.5)) {
      const rock = new THREE.Mesh(k.blobGeo(k.rng.int(1e6)), k.matte(['#8f877d', '#7d766d', '#9c9286'][k.rng.int(3)], 0.92));
      const s = k.rng.range(1, 2);
      rock.scale.set(s * 1.2, s * 0.85, s * 1.1);
      k.place(rock, B + k.rng.range(4.5, 7.5), a, s * 0.35);
    }
  },
  // The course: a little windmill turning out past the rail, and round hedges.
  minigolf(k) {
    const mill = new THREE.Group();
    const tower = new THREE.Mesh(k.own(new THREE.CylinderGeometry(0.9, 1.3, 3.2, 12)), k.matte('#f2e6d0', 0.8));
    tower.position.y = 1.6;
    const roof = new THREE.Mesh(k.own(new THREE.ConeGeometry(1.25, 1.4, 12)), k.matte('#d1453b', 0.7));
    roof.position.y = 3.9;
    const hub = new THREE.Group();
    hub.position.set(0, 3.2, 1.05);
    for (let i = 0; i < 4; i++) {
      const sail = new THREE.Mesh(k.own(new THREE.BoxGeometry(0.42, 2.1, 0.06)), k.matte(i % 2 ? '#f6f2e8' : '#e5323f', 0.7));
      sail.position.y = 1.05;
      const arm = new THREE.Group();
      arm.rotation.z = (i / 4) * Math.PI * 2;
      arm.add(sail);
      hub.add(arm);
    }
    mill.add(tower, roof, hub);
    const a = k.rng.range(0, Math.PI * 2);
    k.place(mill, B + 6, a);
    mill.lookAt(0, 0, 0);
    k.updaters.push((_t, dt) => (hub.rotation.z += dt * 0.9));
    for (const b of around(k, 7, a + 0.45).slice(0, 6)) k.place(bush(k, k.rng.range(1.2, 1.8), ['#2f8f3c', '#3aa047']), B + k.rng.range(4, 6.5), b);
  },
};
