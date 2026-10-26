import * as THREE from 'three';
import { WORLD } from '../core/constants';
import { Rng } from '../core/rng';
import type { Arena, ArenaId } from '../game/arenas';
import { applyPBR, hdri, model, pbr } from './assets';
import type { Quality } from './marbleMesh';
import { radialGlowTexture, ringTexture } from './textures';

/**
 * Builds a field as a stage: a disc of the field's scanned ground (CC0), a low bank along
 * the edge of play that matches what the physics edge does (a stone kerb bounces, a
 * snowbank or a sand berm swallows), and fog beyond it. The field's HDRI never shows: it
 * only lights the scene and fills the glass marbles with a real place to reflect.
 *
 * Map pieces (obstacles, hazards) are built separately (mapPieces.ts), per match.
 * Everything that needs a download is applied when it arrives; until then the field shows
 * flat colours and stays fully playable.
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

/** The scanned ground of each field: texture set, metres per tile, normal strength. */
const GROUND: Record<ArenaId, { id: string; tile: number; normal: number; roughness?: number; tint?: string }> = {
  desk: { id: 'wood_table_001', tile: 1.5, normal: 1 },
  culdesac: { id: 'brushed_concrete', tile: 2.5, normal: 0.8 },
  grass: { id: 'Grass006', tile: 2, normal: 1.1 },
  sand: { id: 'aerial_beach_01', tile: 3, normal: 1.6 },
  ice: { id: 'Ice003', tile: 2, normal: 0.6, roughness: 0.35 },
  gravel: { id: 'gravel_floor_02', tile: 1.2, normal: 1.4, tint: '#b9b1a6' },
  // Artificial turf: the lawn scan, fine-tiled, flattened and dyed.
  minigolf: { id: 'Grass006', tile: 0.35, normal: 0.25, tint: '#55d65f' },
};

/** The bank along the edge of play, as a lathe profile (radius offset from B, height). */
const BANK: Record<ArenaId, { profile: [number, number][]; color: string; texture?: string; tile?: number }> = {
  // A wooden lip, like a tray rim on the desk.
  desk: { profile: [[-0.1, 0], [-0.1, 0.45], [0.05, 0.55], [0.6, 0.55], [0.7, 0]], color: '#6b4127', texture: 'wood_table_001', tile: 1.5 },
  // A stone kerb: square, hard.
  culdesac: { profile: [[0, 0], [0, 0.62], [0.12, 0.7], [1.4, 0.7], [1.5, 0]], color: '#a29f97', texture: 'concrete_pavement', tile: 1.8 },
  // Long grass handled by tufts; a gentle green berm under them.
  grass: { profile: [[-0.2, 0], [0.6, 0.35], [1.6, 0.55], [3, 0.2], [3.8, 0]], color: '#4e6d2a', texture: 'Grass006', tile: 2 },
  sand: { profile: [[-0.3, 0], [0.8, 0.55], [2, 0.75], [3.4, 0.3], [4.2, 0]], color: '#d1bf9b', texture: 'aerial_beach_01', tile: 3 },
  ice: { profile: [[-0.3, 0], [0.4, 0.6], [1.6, 1.05], [3, 0.6], [4, 0]], color: '#eef3f8', texture: 'snow_02', tile: 2 },
  gravel: { profile: [[-0.2, 0], [0.6, 0.5], [1.8, 0.7], [3.2, 0.25], [4, 0]], color: '#8a8379', texture: 'gravel_floor_02', tile: 1.2 },
  // A painted wooden rail, like every course's border.
  minigolf: { profile: [[0, 0], [0, 0.55], [0.06, 0.62], [0.42, 0.62], [0.48, 0.55], [0.48, 0]], color: '#f4efe4' },
};

/** Where the texture for a bank lives when it is not the field's own folder. */
const TEXTURE_FOLDER: Record<string, string> = { concrete_pavement: 'culdesac', snow_02: 'ice', Grass006: 'grass', wood_table_001: 'desk' };

export function buildArena(arena: Arena, quality: Quality): BuiltArena {
  const root = new THREE.Group();
  const envScene = new THREE.Scene();
  const updaters: ((t: number, dt: number) => void)[] = [];
  const owned: { dispose(): void }[] = [];
  const rng = new Rng(arena.id.length * 1013 + 7);
  let disposed = false;
  const own = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const folder = arena.assets;
  const fog = new THREE.Color(arena.fog.color);

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

  // ---- Lights ---------------------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(arena.ambient.sky, arena.ambient.ground, arena.ambient.intensity);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(arena.sun.color, arena.sun.intensity);
  sun.position.set(...arena.sun.dir);
  sun.castShadow = quality !== 'low';
  const sm = quality === 'high' ? 4096 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  // The stage is small now: a tight shadow frustum keeps shadows crisp.
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -(B + 5);
  sc.right = sc.top = B + 5;
  sc.near = 1;
  sc.far = 90;
  sun.position.multiplyScalar(4);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  root.add(sun, sun.target);

  // ---- Helpers --------------------------------------------------------------------------
  const texFolder = (id: string) => TEXTURE_FOLDER[id] ?? folder;
  /** Planar UVs in world units so neighbouring ground pieces tile seamlessly. */
  const planarUV = (geo: THREE.BufferGeometry, size: number) => {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / size + 0.5, pos.getY(i) / size + 0.5);
    return geo;
  };

  // ---- Ground: opaque where the game is played, fading into the fog beyond ---------------
  const g = GROUND[arena.id];
  const size = GROUND_OUTER * 2;
  const inner = own(new THREE.MeshStandardMaterial({ color: arena.groundColor, roughness: 0.9 }));
  const rim = own(new THREE.MeshStandardMaterial({ color: arena.groundColor, roughness: 0.9, transparent: true, depthWrite: false }));
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
  if (arena.id === 'desk') inner.envMapIntensity = rim.envMapIntensity = 0.55;
  void pbr(texFolder(g.id), g.id).then((set) => {
    if (!set || disposed) return;
    applyPBR(inner, set, [size, size], g.tile, g.normal);
    applyPBR(rim, set, [size, size], g.tile, g.normal);
    rim.alphaMap = fade;
    if (g.roughness !== undefined) inner.roughness = rim.roughness = g.roughness;
    if (g.tint) {
      inner.color.set(g.tint);
      rim.color.set(g.tint);
    }
  });

  // ---- The edge of play: a bank that looks like what the physics edge does --------------
  const bank = BANK[arena.id];
  const pts = bank.profile.map(([dr, h]) => new THREE.Vector2(B + dr, h));
  const bankGeo = own(new THREE.LatheGeometry(pts, 160));
  // The lathe winds its faces inward: draw both sides so the bank is lit from outside.
  const bankMat = own(new THREE.MeshStandardMaterial({ color: bank.color, roughness: 0.95, side: THREE.DoubleSide }));
  const bankMesh = new THREE.Mesh(bankGeo, bankMat);
  bankMesh.receiveShadow = true;
  bankMesh.castShadow = quality === 'high';
  root.add(bankMesh);
  if (bank.texture) {
    const id = bank.texture;
    void pbr(texFolder(id), id).then((set) => {
      if (set && !disposed) applyPBR(bankMat, set, [2 * Math.PI * B, 4], bank.tile ?? 2, 1);
    });
  }
  // The lawn's long grass: tufts along the berm, never inside the ring.
  if (arena.id === 'grass') {
    void model(folder, 'grass_medium_01').then((m) => {
      if (!m || disposed) return;
      m.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m);
      const base = 1.2 / Math.max(1e-6, box.max.y - box.min.y);
      const n = quality === 'low' ? 70 : 180;
      const xf: THREE.Matrix4[] = [];
      const q = new THREE.Quaternion();
      for (let i = 0; i < n; i++) {
        const a = rng.next() * Math.PI * 2;
        const r = B + rng.range(-0.2, 3.4);
        const s = base * rng.range(0.7, 1.3);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.next() * Math.PI * 2);
        xf.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, 0.25, Math.sin(a) * r), q, new THREE.Vector3(s, s, s)));
      }
      m.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, n);
        inst.userData.shared = true;
        xf.forEach((t, i) => inst.setMatrixAt(i, t.clone().multiply(mesh.matrixWorld)));
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.receiveShadow = true;
        root.add(inst);
      });
    });
  }

  // ---- Fog banks drifting just past the edge --------------------------------------------
  const mistMat = own(
    new THREE.SpriteMaterial({ map: radialGlowTexture(), color: fog, transparent: true, opacity: 0.35, depthWrite: false, fog: false }),
  );
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

  // ---- Air: dust motes in the lamplight, snow over the lake, grit over the pit -----------
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
    sky: hdri(folder).then((hdr) => ({ hdr })),
    update: (t, dt) => {
      for (const u of updaters) u(t, dt);
    },
    dispose: () => {
      disposed = true;
      for (const o of owned) o.dispose();
      // Instanced grass shares geometry and materials with the asset cache.
    },
  };
}

