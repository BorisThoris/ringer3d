import * as THREE from 'three';
import { WORLD } from '../core/constants';
import { Rng } from '../core/rng';
import type { Arena } from '../game/arenas';
import { groundTexture, radialGlowTexture, ringTexture, windowsTexture } from './textures';
import type { Quality } from './marbleMesh';

export interface BuiltArena {
  root: THREE.Group;
  /** Scene used to bake reflections (sky + big shapes only). */
  envScene: THREE.Scene;
  sun: THREE.DirectionalLight;
  update(t: number, dt: number): void;
  dispose(): void;
}

const R = WORLD.ringRadius;

export function buildArena(arena: Arena, quality: Quality): BuiltArena {
  const root = new THREE.Group();
  const envScene = new THREE.Scene();
  const updaters: ((t: number, dt: number) => void)[] = [];
  const rng = new Rng(arena.id.length * 1013);

  // ---- Sky dome -------------------------------------------------------------------------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(arena.sky.top) },
      bottom: { value: new THREE.Color(arena.sky.bottom) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = clamp(vP.y*1.4+0.15, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0);
      #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 32, 16), skyMat);
  root.add(sky);
  envScene.add(sky.clone());

  // ---- Reflection highlights (baked into the env map only) ---------------------------------
  // Glass is mostly what it reflects: a soft sun/lamp disc, softbox strips and a ring of small
  // horizon lights give marbles crisp highlights from any angle. Ported from the parallel
  // implementation's reflection environments.
  {
    const softDisc = (color: THREE.Color, strength: number) => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.55, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: color.clone().multiplyScalar(strength), transparent: true, side: THREE.DoubleSide, depthWrite: false });
    };
    const key = new THREE.Vector3(...arena.sun.dir).normalize();
    const place = (pos: THREE.Vector3, w: number, h: number, strength: number, color: string) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), softDisc(new THREE.Color(color), strength));
      m.position.copy(pos);
      m.lookAt(0, 0, 0);
      envScene.add(m);
    };
    place(key.clone().multiplyScalar(40), 14, 14, 2 + arena.sun.intensity * 1.3, arena.sun.color);
    const side = new THREE.Vector3(-key.z, 0.35, key.x).normalize();
    place(side.clone().multiplyScalar(38), 4, 22, 2.2, '#ffffff');
    place(side.clone().multiplyScalar(-38).setY(14), 3, 16, 1.2, '#ffffff');
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      place(new THREE.Vector3(Math.cos(a) * 34, 6 + (i % 3) * 7, Math.sin(a) * 34), 2.4, 2.4, 2.6, i % 2 ? '#ffe2b8' : '#d8ecff');
    }
  }

  // ---- Lights ---------------------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(arena.ambient.sky, arena.ambient.ground, arena.ambient.intensity);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(arena.sun.color, arena.sun.intensity);
  sun.position.set(...arena.sun.dir);
  sun.castShadow = quality !== 'low';
  const sm = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -R - 3;
  sc.right = sc.top = R + 3;
  sc.near = 1;
  sc.far = 40;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  root.add(sun, sun.target);

  // ---- Ground ---------------------------------------------------------------------------
  const gTex = groundTexture(arena.ground.pattern, arena.ground.base, arena.ground.detail);
  const groundMat = new THREE.MeshStandardMaterial({
    map: gTex,
    roughness: arena.ground.pattern === 'ice' ? 0.32 : arena.ground.pattern === 'tiles' ? 0.35 : 0.95,
    metalness: arena.ground.pattern === 'tiles' ? 0.25 : 0,
  });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 96), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);
  const envGround = new THREE.Mesh(
    new THREE.CircleGeometry(60, 32),
    new THREE.MeshBasicMaterial({ color: arena.ground.base }),
  );
  envGround.rotation.x = -Math.PI / 2;
  envScene.add(envGround);

  // Raked sand grooves for the zen garden.
  if (arena.ground.pattern === 'sand') {
    const grooveMat = new THREE.MeshStandardMaterial({ color: arena.ground.detail, roughness: 1, transparent: true, opacity: 0.55 });
    for (let r = R + 0.8; r < 16; r += 0.45) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.12, 128), grooveMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.004;
      ring.receiveShadow = true;
      root.add(ring);
    }
  }

  // ---- Ring line ------------------------------------------------------------------------
  const ringW = arena.ring.style === 'rope' ? 0.16 : arena.ring.style === 'chalk' ? 0.11 : 0.09;
  const ringGeo = new THREE.RingGeometry(R - ringW / 2, R + ringW / 2, 256, 1, 0, Math.PI * 2);
  // Remap UVs: u around the ring, v across.
  const uv = ringGeo.attributes.uv as THREE.BufferAttribute;
  const pos = ringGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const a = (Math.atan2(y, x) + Math.PI) / (Math.PI * 2);
    const rr = Math.hypot(x, y);
    uv.setXY(i, a * 8, (rr - (R - ringW / 2)) / ringW);
  }
  const rTex = ringTexture(arena.ring.style);
  rTex.wrapS = THREE.RepeatWrapping;
  const glowing = arena.ring.glow > 0;
  const ringMat = new THREE.MeshStandardMaterial({
    color: arena.ring.color,
    map: rTex,
    alphaMap: rTex,
    transparent: true,
    emissive: glowing ? new THREE.Color(arena.ring.color) : new THREE.Color(0),
    emissiveIntensity: arena.ring.glow,
    emissiveMap: glowing ? rTex : null,
    roughness: 0.9,
    depthWrite: false,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.y = 0.006;
  ringMesh.receiveShadow = true;
  root.add(ringMesh);
  if (glowing) {
    const pl = new THREE.PointLight(arena.ring.color, 6, 14, 1.6);
    pl.position.set(0, 1.2, 0);
    root.add(pl);
    updaters.push((t) => {
      ringMat.emissiveIntensity = arena.ring.glow * (0.85 + 0.15 * Math.sin(t * (arena.ring.style === 'lava' ? 1.3 : 3.1)));
    });
  }
  // Lag line: a short chalk tick where players take their first knuckle-down, purely decorative.

  // ---- Props ----------------------------------------------------------------------------
  const props = new THREE.Group();
  root.add(props);
  const addEnv = (m: THREE.Object3D) => {
    const c = m.clone();
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const src = mesh.material as THREE.MeshStandardMaterial;
        mesh.material = new THREE.MeshBasicMaterial({ color: src.emissive && src.emissiveIntensity > 0.5 ? src.emissive : src.color ?? '#888' });
      }
    });
    envScene.add(c);
  };
  const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
  const place = (m: THREE.Object3D, minR = 14, maxR = 24) => {
    const a = rng.next() * Math.PI * 2;
    const r = rng.range(minR, maxR);
    m.position.set(Math.cos(a) * r, m.position.y, Math.sin(a) * r);
    m.rotation.y = rng.next() * Math.PI * 2;
    return m;
  };
  const shadowy = (m: THREE.Object3D) => {
    m.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = quality === 'high';
        o.receiveShadow = true;
      }
    });
    return m;
  };

  switch (arena.props) {
    case 'playground': {
      // Trees
      for (let i = 0; i < 14; i++) {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 8), std('#6b4a2f'));
        trunk.position.y = 1.5;
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(1.8, 2.6), 0), std(rng.next() < 0.5 ? '#3f9b4b' : '#58b05a', { flatShading: true }));
        crown.position.y = 3.8;
        tree.add(trunk, crown);
        place(tree, 18, 30);
        props.add(shadowy(tree));
        addEnv(tree);
      }
      // Chain-link fence arc
      const fenceMat = std('#9aa3ad', { metalness: 0.7, roughness: 0.4 });
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 1.2 + 2.2;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), fenceMat);
        post.position.set(Math.cos(a) * 15, 1.1, Math.sin(a) * 15);
        props.add(post);
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(2.4, 2),
          new THREE.MeshStandardMaterial({ color: '#b8c0c8', transparent: true, opacity: 0.25, side: THREE.DoubleSide, metalness: 0.6 }),
        );
        panel.position.set(Math.cos(a + 0.04) * 15, 1.1, Math.sin(a + 0.04) * 15);
        panel.lookAt(0, 1.1, 0);
        props.add(panel);
      }
      // Hopscotch chalk squares
      const chalk = new THREE.MeshBasicMaterial({ color: '#f4f1e8', transparent: true, opacity: 0.55 });
      for (let i = 0; i < 6; i++) {
        const sq = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.68, 4, 1), chalk);
        sq.rotation.x = -Math.PI / 2;
        sq.rotation.z = Math.PI / 4;
        sq.position.set(8.5 + i * 0.95, 0.005, -4);
        root.add(sq);
      }
      // Benches
      for (let i = 0; i < 3; i++) {
        const bench = new THREE.Group();
        const seat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.6), std('#d97a3a'));
        seat.position.y = 0.55;
        const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.5), std('#444'));
        l1.position.set(-1.1, 0.27, 0);
        const l2 = l1.clone();
        l2.position.x = 1.1;
        bench.add(seat, l1, l2);
        place(bench, 9.5, 12);
        props.add(shadowy(bench));
      }
      break;
    }
    case 'garden': {
      for (let i = 0; i < 9; i++) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rng.range(0.6, 1.6), 0), std('#6e6a64', { flatShading: true }));
        rock.scale.y = rng.range(0.5, 0.9);
        rock.position.y = 0.3;
        place(rock, 8, 16);
        props.add(shadowy(rock));
        // Moss ring around the stone
        const moss = new THREE.Mesh(new THREE.CircleGeometry(rng.range(1.2, 2), 24), std('#5e7f3a'));
        moss.rotation.x = -Math.PI / 2;
        moss.position.set(rock.position.x, 0.003, rock.position.z);
        root.add(moss);
      }
      for (let i = 0; i < 6; i++) {
        const lantern = new THREE.Group();
        const stone = std('#9b958a');
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.4, 6), stone);
        base.position.y = 0.2;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.1, 6), stone);
        post.position.y = 0.95;
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), std('#fff1c9', { emissive: '#ffb347', emissiveIntensity: 1.4 }));
        box.position.y = 1.75;
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.45, 4), stone);
        roof.position.y = 2.2;
        roof.rotation.y = Math.PI / 4;
        lantern.add(base, post, box, roof);
        const a = (i / 6) * Math.PI * 2 + 0.3;
        lantern.position.set(Math.cos(a) * 8.2, 0, Math.sin(a) * 8.2);
        props.add(shadowy(lantern));
        if (i % 3 === 0) {
          // Only a couple of real lights: every point light costs on mobile GPUs.
          const light = new THREE.PointLight('#ffb347', 3, 9, 2);
          light.position.set(lantern.position.x, 1.8, lantern.position.z);
          root.add(light);
        }
      }
      // Bamboo groves on the horizon
      for (let i = 0; i < 90; i++) {
        const h = rng.range(4, 9);
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, h, 6), std(rng.next() < 0.5 ? '#7aa33a' : '#93b84a'));
        b.position.y = h / 2;
        place(b, 18, 26);
        props.add(b);
        addEnv(b);
      }
      break;
    }
    case 'city': {
      // Parapet
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 1, 64, 1, true), std('#2a2633', { side: THREE.DoubleSide }));
      wall.position.y = 0.5;
      props.add(wall);
      // Skyline
      const winTex = windowsTexture();
      for (let i = 0; i < 46; i++) {
        const h = rng.range(10, 38);
        const w = rng.range(4, 9);
        const tex = winTex.clone();
        tex.needsUpdate = true;
        tex.repeat.set(w / 6, h / 8);
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, w),
          new THREE.MeshStandardMaterial({ color: '#0d0b14', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.6 }),
        );
        b.position.y = h / 2 - 12;
        place(b, 34, 70);
        props.add(b);
        addEnv(b);
      }
      // Neon signs
      const neonColors = ['#00f0ff', '#ff2bd6', '#ffe14d', '#7c5cff'];
      for (let i = 0; i < 5; i++) {
        const c = neonColors[i % neonColors.length];
        const sign = new THREE.Mesh(
          new THREE.TorusGeometry(rng.range(0.8, 1.4), 0.07, 8, 40, Math.PI * rng.range(1, 2)),
          new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 3 }),
        );
        const a = (i / 5) * Math.PI * 2;
        sign.position.set(Math.cos(a) * 14.6, 2.6, Math.sin(a) * 14.6);
        sign.lookAt(0, 2.6, 0);
        props.add(sign);
        if (i < 2) {
          const pl = new THREE.PointLight(c, 3, 9, 2);
          pl.position.copy(sign.position).multiplyScalar(0.9);
          root.add(pl);
        }
        updaters.push((t) => {
          (sign.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.4 + Math.sin(t * 2 + i * 1.7) * 0.6 + (Math.sin(t * 23 + i) > 0.97 ? -2 : 0);
        });
      }
      // AC units
      for (let i = 0; i < 6; i++) {
        const ac = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4), std('#3a3846', { metalness: 0.5 }));
        ac.position.y = 0.5;
        place(ac, 9, 13);
        props.add(shadowy(ac));
      }
      break;
    }
    case 'ice': {
      const iceMat = new THREE.MeshPhysicalMaterial({ color: '#bfe6ff', roughness: 0.1, transmission: quality === 'low' ? 0 : 0.6, thickness: 1, transparent: quality === 'low', opacity: 0.85 });
      for (let i = 0; i < 26; i++) {
        const h = rng.range(3, 11);
        const p = new THREE.Mesh(new THREE.CylinderGeometry(rng.range(0.4, 1.2), rng.range(0.8, 1.6), h, 6), iceMat);
        p.position.y = h / 2;
        place(p, 12, 26);
        props.add(p);
        addEnv(p);
      }
      for (let i = 0; i < 30; i++) {
        const s = new THREE.Mesh(new THREE.OctahedronGeometry(rng.range(0.3, 0.9), 0), iceMat);
        s.position.y = 0.3;
        s.scale.y = rng.range(1.5, 3);
        place(s, 8, 14);
        props.add(s);
      }
      for (let i = 0; i < 12; i++) {
        const mound = new THREE.Mesh(new THREE.SphereGeometry(rng.range(1.5, 3), 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std('#f4fbff', { roughness: 1 }));
        mound.scale.y = 0.4;
        place(mound, 10, 20);
        props.add(shadowy(mound));
      }
      break;
    }
    case 'volcano': {
      const basalt = std('#1d1a19', { flatShading: true, roughness: 0.9 });
      for (let i = 0; i < 70; i++) {
        const h = rng.range(0.6, 6);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, h, 6), basalt);
        col.position.y = h / 2;
        place(col, 10, 22);
        props.add(shadowy(col));
        addEnv(col);
      }
      const lavaMat = new THREE.MeshStandardMaterial({ color: '#ff4a00', emissive: '#ff3a00', emissiveIntensity: 2.2, roughness: 0.6 });
      for (let i = 0; i < 7; i++) {
        const pool = new THREE.Mesh(new THREE.CircleGeometry(rng.range(1.2, 3.2), 24), lavaMat);
        pool.position.y = 0.01;
        place(pool, 9, 18);
        pool.rotation.set(-Math.PI / 2, 0, 0); // flat on the ground (place() adds a yaw)
        root.add(pool);
        if (i < 2) {
          const pl = new THREE.PointLight('#ff5a1a', 4, 10, 2);
          pl.position.set(pool.position.x, 1, pool.position.z);
          root.add(pl);
        }
      }
      updaters.push((t) => {
        lavaMat.emissiveIntensity = 1.9 + Math.sin(t * 0.9) * 0.4;
      });
      // Distant volcano cone
      const cone = new THREE.Mesh(new THREE.ConeGeometry(40, 28, 24, 1, true), std('#140e0d', { flatShading: true }));
      cone.position.set(-30, 8, -70);
      props.add(cone);
      addEnv(cone);
      break;
    }
  }

  // ---- Ambient particles ----------------------------------------------------------------
  const particleKind = arena.props === 'ice' ? 'snow' : arena.props === 'volcano' ? 'embers' : arena.props === 'city' ? 'dust' : arena.props === 'garden' ? 'petals' : 'dust';
  const count = quality === 'low' ? 120 : 360;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pPos[i * 3] = rng.range(-20, 20);
    pPos[i * 3 + 1] = rng.range(0, 12);
    pPos[i * 3 + 2] = rng.range(-20, 20);
    speeds[i] = rng.range(0.3, 1);
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pColor = particleKind === 'embers' ? '#ff7a2a' : particleKind === 'petals' ? '#ffb3c7' : particleKind === 'snow' ? '#ffffff' : arena.props === 'city' ? '#b98cff' : '#fff6d8';
  const pMat = new THREE.PointsMaterial({
    color: pColor,
    size: particleKind === 'snow' ? 0.12 : particleKind === 'petals' ? 0.14 : 0.07,
    map: radialGlowTexture(),
    transparent: true,
    depthWrite: false,
    blending: particleKind === 'embers' || arena.props === 'city' ? THREE.AdditiveBlending : THREE.NormalBlending,
    opacity: particleKind === 'dust' ? 0.5 : 0.9,
  });
  const points = new THREE.Points(pGeo, pMat);
  root.add(points);
  updaters.push((t, dt) => {
    for (let i = 0; i < count; i++) {
      const s = speeds[i];
      let y = pPos[i * 3 + 1];
      if (particleKind === 'embers') y += dt * s * 1.2;
      else if (particleKind === 'dust') y += Math.sin(t * 0.3 + i) * dt * 0.1;
      else y -= dt * s * (particleKind === 'snow' ? 0.8 : 0.5);
      pPos[i * 3] += Math.sin(t * 0.5 + i) * dt * 0.3;
      if (y > 12) y = 0;
      if (y < 0) y = 12;
      pPos[i * 3 + 1] = y;
    }
    pGeo.attributes.position.needsUpdate = true;
  });

  return {
    root,
    envScene,
    sun,
    update: (t, dt) => {
      for (const u of updaters) u(t, dt);
    },
    dispose: () => {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) mat.dispose();
        }
      });
    },
  };
}
