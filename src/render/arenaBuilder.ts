import * as THREE from 'three';
import { GroundedSkybox } from 'three/examples/jsm/objects/GroundedSkybox.js';
import { WORLD } from '../core/constants';
import { Rng } from '../core/rng';
import type { Arena } from '../game/arenas';
import { applyPBR, backdrop, hdri, model, pbr, UNITS_PER_METRE } from './assets';
import type { Quality } from './marbleMesh';
import { radialGlowTexture, ringTexture } from './textures';

/**
 * Builds a field: real-scale geometry around the ring, scanned CC0 materials and props,
 * and the field's HDRI as both the visible backdrop (ground-projected, so the photographed
 * street or room sits at the right perspective) and the reflections in every marble.
 *
 * Everything that needs a download is applied when it arrives: until then (or if offline)
 * the field shows flat colours and a gradient sky, and stays fully playable.
 *
 * Scale: 1 unit ≈ 4 cm (25 units per metre). The physics boundary is a circle of radius
 * WORLD.boundaryRadius; solid-looking props all sit outside it.
 */
export interface BuiltArena {
  root: THREE.Group;
  /** Fallback reflection scene, used until the HDRI arrives. */
  envScene: THREE.Scene;
  sun: THREE.DirectionalLight;
  /** HDRI lighting and backdrop for this field (either may be null if it failed to load). */
  sky: Promise<{ hdr: THREE.DataTexture | null; backdrop: THREE.Texture | null }>;
  update(t: number, dt: number): void;
  dispose(): void;
}

const R = WORLD.ringRadius;
const B = WORLD.boundaryRadius;
const M = UNITS_PER_METRE;
/** Height of the HDRI cameras above their ground, in units (they shot at ~1.6 m). */
const PHOTO_HEIGHT = 1.6 * M;

export function buildArena(arena: Arena, quality: Quality): BuiltArena {
  const root = new THREE.Group();
  const envScene = new THREE.Scene();
  const updaters: ((t: number, dt: number) => void)[] = [];
  const owned: { dispose(): void }[] = [];
  const rng = new Rng(arena.id.length * 1013 + 7);
  let disposed = false;
  const own = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const folder = arena.assets;

  // ---- Fallback sky (replaced by the HDRI backdrop when it loads) ----------------------
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
  const skyDome = new THREE.Mesh(own(new THREE.SphereGeometry(300, 32, 16)), skyMat);
  root.add(skyDome);
  envScene.add(skyDome.clone());
  const envGround = new THREE.Mesh(own(new THREE.CircleGeometry(200, 32)), own(new THREE.MeshBasicMaterial({ color: arena.groundColor })));
  envGround.rotation.x = -Math.PI / 2;
  envScene.add(envGround);

  // ---- Lights ---------------------------------------------------------------------------
  // The HDRI supplies ambient light and reflections; the sun adds crisp shadows aligned
  // with the sun (or window) in the photo.
  const hemi = new THREE.HemisphereLight(arena.ambient.sky, arena.ambient.ground, arena.ambient.intensity);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(arena.sun.color, arena.sun.intensity);
  sun.position.set(...arena.sun.dir);
  sun.castShadow = quality !== 'low';
  const sm = quality === 'high' ? 4096 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -26;
  sc.right = sc.top = 26;
  sc.near = 1;
  sc.far = 120;
  sun.position.multiplyScalar(4);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  root.add(sun, sun.target);

  // ---- Helpers --------------------------------------------------------------------------
  /** Planar UVs in world units so neighbouring ground pieces tile seamlessly. */
  const planarUV = (geo: THREE.BufferGeometry, size: number) => {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / size + 0.5, pos.getY(i) / size + 0.5);
    return geo;
  };
  /**
   * Ground: a solid disc where the game is played (opaque, so glass marbles refract it),
   * and an outer rim that fades into the ground-projected photo. Both share one tiling.
   */
  const groundDisc = (rSolid: number, rOuter: number, color: string, id: string, tileMetres: number, normalScale = 1) => {
    const size = rOuter * 2;
    const inner = own(new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    const rim = own(new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: true, depthWrite: false }));
    const fade = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(rSolid / rOuter, '#fff');
      grad.addColorStop(1, '#000');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
      return own(new THREE.CanvasTexture(c));
    })();
    rim.alphaMap = fade;
    const disc = new THREE.Mesh(own(planarUV(new THREE.CircleGeometry(rSolid, 96), size)), inner);
    const ring = new THREE.Mesh(own(planarUV(new THREE.RingGeometry(rSolid, rOuter, 96, 4), size)), rim);
    for (const m of [disc, ring]) {
      m.rotation.x = -Math.PI / 2;
      m.receiveShadow = true;
      root.add(m);
    }
    ring.renderOrder = -1;
    void pbr(folder, id).then((set) => {
      if (!set || disposed) return;
      applyPBR(inner, set, [size, size], tileMetres, normalScale);
      applyPBR(rim, set, [size, size], tileMetres, normalScale);
      // The alpha map must not tile with the ground texture.
      rim.alphaMap = fade;
    });
    return { disc, inner, rim };
  };
  /** Load a scanned prop at real-world scale and place it. */
  const prop = (id: string, x: number, z: number, rotY = 0, scale = 1, y = 0) => {
    void model(folder, id).then((g) => {
      if (!g || disposed) return;
      g.scale.setScalar(M * scale);
      g.position.set(x, y, z);
      g.rotation.y = rotY;
      if (quality !== 'high') g.traverse((o) => (o.castShadow = false));
      root.add(g);
    });
  };
  /** Many copies of a prop as instanced meshes (grass, shells): one draw call per sub-mesh. */
  const scatter = (id: string, n: number, rMin: number, rMax: number, size: [number, number], targetHeight?: number) => {
    void model(folder, id).then((g) => {
      if (!g || disposed) return;
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      const h = Math.max(1e-6, box.max.y - box.min.y);
      const base = targetHeight ? targetHeight / h : M;
      const place = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const transforms: THREE.Matrix4[] = [];
      for (let i = 0; i < n; i++) {
        const a = rng.next() * Math.PI * 2;
        const r = Math.sqrt(rng.range(rMin * rMin, rMax * rMax));
        const s = base * rng.range(size[0], size[1]);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.next() * Math.PI * 2);
        transforms.push(place.clone().compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q, new THREE.Vector3(s, s, s)));
      }
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, n);
        inst.userData.shared = true;
        const local = mesh.matrixWorld;
        transforms.forEach((t, i) => inst.setMatrixAt(i, t.clone().multiply(local)));
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.castShadow = quality === 'high';
        inst.receiveShadow = true;
        root.add(inst);
      });
    });
  };
  const standard = (color: string, roughness = 0.9) => own(new THREE.MeshStandardMaterial({ color, roughness }));
  const material = (mat: THREE.MeshStandardMaterial, id: string, size: [number, number], tile: number, normalScale = 1) => {
    void pbr(folder, id).then((set) => {
      if (set && !disposed) applyPBR(mat, set, size, tile, normalScale);
    });
  };

  // ---- The field ------------------------------------------------------------------------
  let groundY = 0;
  switch (arena.id) {
    case 'desk': {
      // A 2 m x 1.2 m oak desk in a living room. The room floor is 75 cm below the desktop.
      const W = 2 * M;
      const D = 1.2 * M;
      const T = 0.035 * M;
      const top = standard(arena.groundColor, 0.5);
      // Satin varnish: a soft sheen of the window, not a mirror of it.
      top.envMapIntensity = 0.55;
      const desk = new THREE.Mesh(own(new THREE.BoxGeometry(W, T, D)), top);
      desk.position.y = -T / 2;
      desk.receiveShadow = true;
      desk.castShadow = true;
      root.add(desk);
      material(top, 'wood_table_001', [W, D], 1.5);
      // Legs, so the desk stands on the room's floor.
      const legMat = standard('#3a2414', 0.6);
      material(legMat, 'wood_table_001', [0.06 * M, 0.72 * M], 1.5);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = new THREE.Mesh(own(new THREE.BoxGeometry(0.06 * M, 0.72 * M, 0.06 * M)), legMat);
        leg.position.set(lx * (W / 2 - 0.08 * M), -T - 0.36 * M, lz * (D / 2 - 0.08 * M));
        leg.castShadow = true;
        root.add(leg);
      }
      groundY = -0.75 * M;
      prop('desk_lamp_arm_01', -19, -9, 0.6);
      prop('book_encyclopedia_set_01', 18.5, -10, -0.35);
      prop('stationery_supplies', -17, 9.5, 0.4);
      prop('round_spectacles', 15.5, 10, 2.2);
      prop('alarm_clock_01', 21, 3, -1.2);
      prop('magnifying_glass_01', -12, -13, 1.0);
      break;
    }
    case 'culdesac': {
      // Turning circle of brushed concrete; past the boundary, a concrete gutter, a 15 cm
      // kerb and a slab sidewalk, like the edge of any cul-de-sac.
      const gutterStart = -(B + 1);
      const gutterW = 0.28 * M;
      const kerbZ = gutterStart - gutterW;
      const kerbH = 0.15 * M;
      const kerbTop = 0.12 * M;
      // One big slab: its far edges sit out where the ground-projected street takes over.
      // The gutter dips below the road; the projected photo ground must sit under it.
      groundY = -0.6;
      const roadW = 320;
      const roadD = 200;
      const roadMat = standard(arena.groundColor, 0.9);
      const road = new THREE.Mesh(own(new THREE.PlaneGeometry(roadW, roadD)), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, 0, gutterStart + roadD / 2);
      road.receiveShadow = true;
      root.add(road);
      material(roadMat, 'brushed_concrete', [roadW, roadD], 2.5, 0.8);
      // Expansion joints, clear of the ring.
      const joint = standard('#2b2a28', 1);
      for (const x of [-31, 31]) {
        const j = new THREE.Mesh(own(new THREE.PlaneGeometry(0.18, 60)), joint);
        j.rotation.x = -Math.PI / 2;
        j.position.set(x, 0.004, gutterStart + 30);
        j.receiveShadow = true;
        root.add(j);
      }
      // Gutter: a shallow channel falling toward the kerb.
      // Same concrete as the road, darker with run-off grime.
      const gutterMat = standard('#6f6d69', 0.75);
      material(gutterMat, 'brushed_concrete', [roadW, gutterW], 1.5, 0.8);
      const gutter = new THREE.Mesh(own(new THREE.PlaneGeometry(roadW, Math.hypot(gutterW, 0.4))), gutterMat);
      gutter.rotation.x = -Math.PI / 2 + Math.atan2(0.4, gutterW);
      gutter.position.set(0, -0.2, gutterStart - gutterW / 2);
      gutter.receiveShadow = true;
      root.add(gutter);
      // Kerb face and rounded top, then the sidewalk.
      const kerbMat = standard('#9a978f', 0.85);
      material(kerbMat, 'concrete_pavement', [roadW, kerbH], 1.8);
      const face = new THREE.Mesh(own(new THREE.PlaneGeometry(roadW, kerbH + 0.4)), kerbMat);
      face.position.set(0, (kerbH - 0.4) / 2, kerbZ);
      face.receiveShadow = true;
      root.add(face);
      const kerbCap = new THREE.Mesh(own(new THREE.BoxGeometry(roadW, 0.6, kerbTop)), kerbMat);
      kerbCap.position.set(0, kerbH - 0.3, kerbZ - kerbTop / 2);
      kerbCap.castShadow = kerbCap.receiveShadow = true;
      root.add(kerbCap);
      const walkMat = standard('#a19d95', 0.85);
      const walkD = 1.6 * M;
      material(walkMat, 'concrete_pavement', [roadW, walkD], 1.8);
      const walk = new THREE.Mesh(own(new THREE.PlaneGeometry(roadW, walkD)), walkMat);
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(0, kerbH, kerbZ - kerbTop - walkD / 2);
      walk.receiveShadow = true;
      root.add(walk);
      const sideY = kerbH;
      const sideZ = kerbZ - kerbTop;
      prop('fire_hydrant', -9, sideZ - 6, 0.3, 1, sideY);
      prop('metal_trash_can', 8, sideZ - 5, -0.4, 1, sideY);
      prop('utility_box_01', -26, sideZ - 9, 0, 1, sideY);
      prop('street_lamp_01', 24, sideZ - 12, Math.PI, 1, sideY);
      prop('water_manhole_cover', 19, 8, 0.2, 1, 0.01);
      break;
    }
    case 'grass': {
      // ambientCG Grass006: a freshly cut lawn scan, ~2 m per tile.
      groundDisc(50, 110, arena.groundColor, 'Grass006', 2, 1.1);
      // A mown lawn: short tufts around the ring (never inside it, so marbles stay
      // visible), longer grass toward the edges, a few dandelions, the gnome.
      scatter('grass_medium_02', quality === 'low' ? 50 : 120, R + 1.2, B + 3, [0.7, 1.2], 0.45);
      scatter('grass_medium_01', quality === 'low' ? 60 : 200, B + 5, 48, [0.8, 1.4], 2.2);
      scatter('dandelion_01', 9, B + 2, 30, [0.8, 1.1], 1.6);
      prop('garden_gnome', 17, -15, -2.3);
      prop('watering_can_metal_01', -19, 13, 0.7);
      break;
    }
    case 'sand': {
      // The aerial scan covers 30 m; tiled at 3 m its wind ripples come out marble-sized.
      groundDisc(50, 110, arena.groundColor, 'aerial_beach_01', 3, 1.6);
      // Shells washed up around the ring and a child's bucket; the real beach is the backdrop.
      scatter('lambis_shell', 7, R + 2.5, 22, [0.8, 1.2]);
      prop('wooden_bucket_01', -16.5, 12, 0.5);
      break;
    }
    case 'ice': {
      const iceR = 28;
      const iceMat = standard(arena.groundColor, 0.2);
      const ice = new THREE.Mesh(own(planarUV(new THREE.CircleGeometry(iceR, 96), iceR * 2)), iceMat);
      ice.rotation.x = -Math.PI / 2;
      ice.receiveShadow = true;
      root.add(ice);
      void pbr(folder, 'Ice003').then((set) => {
        if (!set || disposed) return;
        applyPBR(iceMat, set, [iceR * 2, iceR * 2], 2, 0.6);
        // Polished black ice: the scan's roughness, biased glossy.
        iceMat.roughness = 0.35;
      });
      const snow = groundDisc(60, 115, '#e8eef4', 'snow_02', 2, 1.4);
      // The snow disc sits just under the ice so the lake shows through in the middle.
      snow.disc.position.y = -0.02;
      // A soft snowbank along the shore.
      const bankMat = standard('#eef3f8', 1);
      material(bankMat, 'snow_02', [40, 6], 2, 1.4);
      const bank = new THREE.Mesh(own(new THREE.TorusGeometry(iceR + 1.5, 2.2, 10, 96)), bankMat);
      bank.rotation.x = -Math.PI / 2;
      bank.scale.set(1, 1, 0.45);
      bank.position.y = -0.2;
      bank.receiveShadow = bank.castShadow = true;
      root.add(bank);
      prop('boulder_01', -33, -12, 0.5, 1.4);
      prop('boulder_01', 30, 20, 2.4, 1.1);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.6;
        const r = 40 + rng.range(-3, 6);
        prop('fir_sapling', Math.cos(a) * r, Math.sin(a) * r, rng.next() * 6, rng.range(0.7, 1.1));
      }
      // Left on the shore, clear of the camera's orbit.
      prop('rubber_boots', 25, -14, 2.6);
      break;
    }
  }

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

  // ---- Air: dust motes in the window light, snow over the lake --------------------------
  if (arena.id === 'desk' || arena.id === 'ice') {
    const snow = arena.id === 'ice';
    const count = quality === 'low' ? 80 : 240;
    const geo = own(new THREE.BufferGeometry());
    const p = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      p[i * 3] = rng.range(-22, 22);
      p[i * 3 + 1] = rng.range(0, 18);
      p[i * 3 + 2] = rng.range(-22, 22);
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
        if (y < 0) y = 18;
        if (y > 18) y = 0;
        p[i * 3 + 1] = y;
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  // ---- Sky: HDRI lighting + ground-projected backdrop -----------------------------------
  const sky = Promise.all([hdri(folder), backdrop(folder)]).then(([hdr, bg]) => {
    if (disposed) return { hdr, backdrop: bg };
    if (bg) {
      const box = new GroundedSkybox(bg, PHOTO_HEIGHT, 280, quality === 'low' ? 48 : 96);
      // Its ground sits at position.y - height: put it just under this field's floor.
      box.position.y = groundY - 0.05 + PHOTO_HEIGHT;
      (box.material as THREE.MeshBasicMaterial).color.setScalar(arena.backgroundIntensity);
      own(box.geometry);
      own(box.material as THREE.Material);
      root.add(box);
      skyDome.visible = false;
    }
    return { hdr, backdrop: bg };
  });

  return {
    root,
    envScene,
    sun,
    sky,
    update: (t, dt) => {
      for (const u of updaters) u(t, dt);
    },
    dispose: () => {
      disposed = true;
      for (const o of owned) o.dispose();
      // Instanced/scanned props share geometry and materials with the asset cache.
    },
  };
}
