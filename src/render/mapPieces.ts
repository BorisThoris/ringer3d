import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import type { Piece } from '../core/types';
import type { ArenaId } from '../game/arenas';
import { ink, toon } from './toon';
import type { Quality } from './marbleMesh';

/**
 * Meshes for a map's pieces. Each piece's `skin` says what it is (a book, a rock, a puddle)
 * and that decides how it is drawn; the physics shape stays the plain one underneath, and
 * the drawing matches it wherever a marble can touch. Everything is built from simple
 * shapes in code, textured with the CC0 scans already shipped for the fields.
 */
export interface BuiltPieces {
  group: THREE.Group;
  update(t: number, dt: number): void;
  /** A hit near (x, z): bumpers there flash and swell. */
  pulse(x: number, z: number, strength: number): void;
  dispose(): void;
}

const BUMPER_H = 0.45;

interface MatOpts {
  rough?: number;
  metal?: number;
  opacity?: number;
  emissive?: string;
  map?: THREE.Texture;
}

export function buildPieces(pieces: readonly Piece[], arena: ArenaId, quality: Quality): BuiltPieces {
  const group = new THREE.Group();
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const rng = new Rng(pieces.length * 7919 + arena.length);
  const shadows = quality !== 'low';
  const bumpers: { x: number; z: number; ring: THREE.Mesh; cap: THREE.MeshStandardMaterial; k: number }[] = [];
  const flags: THREE.Mesh[] = [];

  // ---- Materials (cached by look) -------------------------------------------------------
  const mats = new Map<string, THREE.MeshToonMaterial>();
  // Cel-shaded: flat colours in banded light (roughness and metal do not apply).
  const mat = (color: string, o: MatOpts = {}) => {
    const key = `${color}|${o.opacity}|${o.emissive}|${o.map?.uuid}`;
    let m = mats.get(key);
    if (m) return m;
    m = own(toon(color, { opacity: o.opacity, emissive: o.emissive, map: o.map ?? null }));
    mats.set(key, m);
    return m;
  };
  const geo = <T extends THREE.BufferGeometry>(g: T) => own(g);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, cast = true) => {
    const x = new THREE.Mesh(g, m);
    x.castShadow = cast && shadows;
    x.receiveShadow = true;
    return x;
  };
  /** A flat thing lying on the ground. */
  const decal = (g: THREE.BufferGeometry, m: THREE.Material, x: number, z: number, y: number, rot = 0) => {
    const d = new THREE.Mesh(g, m);
    d.rotation.x = -Math.PI / 2;
    d.rotation.z = rot;
    d.position.set(x, y, z);
    d.receiveShadow = true;
    d.renderOrder = 1;
    d.userData.noInk = true;
    group.add(d);
    return d;
  };
  const pick = <T,>(xs: T[]) => xs[rng.int(xs.length)];

  // Shared textures.
  const blob = own(blobTexture(rng));
  const pad = own(padTexture());
  pad.wrapS = pad.wrapT = THREE.RepeatWrapping;
  const ruled = own(paperTexture());
  const stain = own(stainTexture());
  const ticks = own(rulerTexture());

  /** A lumpy rock: a squashed, roughened icosphere. */
  const rockGeo = (seed: number) => {
    // Welded so the normals come out smooth, not faceted.
    const g = mergeVertices(new THREE.IcosahedronGeometry(1, 3));
    const p = g.attributes.position as THREE.BufferAttribute;
    const r = new Rng(seed);
    const bumps = Array.from({ length: 5 }, () => new THREE.Vector3(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)).normalize());
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      let k = 1;
      for (const b of bumps) k += Math.max(0, v.dot(b)) ** 3 * 0.18;
      k *= 0.92 + r.next() * 0.08;
      p.setXYZ(i, v.x * k, v.y * k, v.z * k);
    }
    g.computeVertexNormals();
    return geo(g);
  };
  const rockTone = arena === 'sand' ? ['#b4a184', '#a89070', '#c2b192'] : arena === 'ice' ? ['#5f6a74', '#6f7a84', '#55606a'] : ['#7c776f', '#6d6862', '#8a8278', '#5f5a54'];
  const pebbles: { x: number; y: number; z: number; r: number; tone: string[] }[] = [];

  for (const p of pieces) {
    const skin = p.skin ?? p.kind;
    switch (p.kind) {
      case 'wall':
        group.add(wallMesh(p, skin));
        break;
      case 'post':
        group.add(postMesh(p, skin));
        break;
      case 'bumper': {
        const g = new THREE.Group();
        const core = mesh(geo(new THREE.CylinderGeometry(p.r * 0.86, p.r * 0.9, BUMPER_H, 28)), mat('#f4f1ea', { rough: 0.4 }));
        core.position.y = BUMPER_H / 2;
        const ring = mesh(geo(new THREE.TorusGeometry(p.r * 0.92, 0.08, 12, 36)), mat('#ff3d55', { rough: 0.55 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = BUMPER_H * 0.45;
        const capMat = own(new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.3, emissive: '#ffb000', emissiveIntensity: 0.15 }));
        const cap = mesh(geo(new THREE.CylinderGeometry(p.r * 0.5, p.r * 0.5, 0.04, 24)), capMat);
        cap.position.y = BUMPER_H + 0.02;
        g.add(core, ring, cap);
        g.position.set(p.x, 0, p.z);
        group.add(g);
        bumpers.push({ x: p.x, z: p.z, ring, cap: capMat, k: 0 });
        break;
      }
      case 'bump':
        bumpMesh(p, skin);
        break;
      case 'ridge':
        ridgeMesh(p, skin);
        break;
      case 'zone':
        zoneMesh(p, skin);
        break;
      case 'hole':
        holeMesh(p, skin);
        break;
    }
  }

  function wallMesh(p: Extract<Piece, { kind: 'wall' }>, skin: string): THREE.Object3D {
    const g = new THREE.Group();
    const L = p.len;
    const H = p.h;
    const T = p.thick;
    switch (skin) {
      case 'book': {
        g.add(mesh(geo(new RoundedBoxGeometry(L, H, T, 2, 0.03)), mat(pick(['#a8322d', '#244c7a', '#2f6b3a', '#c99a2e', '#5b2a6e', '#1d1d1f']), { rough: 0.75 })));
        // The page block, showing on three sides.
        const pages = mesh(geo(new THREE.BoxGeometry(L * 0.96, H * 0.84, T * 1.01)), mat('#efe6cf', { rough: 0.9 }));
        pages.position.x = L * 0.02;
        g.add(pages);
        break;
      }
      case 'eraser': {
        g.add(mesh(geo(new RoundedBoxGeometry(L, H, T, 3, 0.05)), mat('#f2a7b8', { rough: 0.9 })));
        const sleeve = mesh(geo(new THREE.BoxGeometry(L * 0.5, H * 1.04, T * 1.04)), mat('#2a6fd6', { rough: 0.6 }));
        sleeve.position.x = L * 0.2;
        g.add(sleeve);
        break;
      }
      case 'ruler':
        g.add(mesh(geo(new THREE.BoxGeometry(L, H, T)), mat('#ffffff', { rough: 0.5, map: ticks })));
        break;
      case 'brick':
        g.add(mesh(geo(new RoundedBoxGeometry(L, H, T, 2, 0.025)), mat(pick(['#a5462f', '#93402c', '#b5543a']), { rough: 0.95 })));
        break;
      case 'kerbstone':
      case 'slab':
        g.add(mesh(geo(new RoundedBoxGeometry(L, H, T, 3, 0.05)), mat(skin === 'slab' ? '#9a948b' : '#c9c3b8', { rough: 0.92 })));
        break;
      case 'log':
      case 'driftwood': {
        // A round log lying along the wall line, about as tall as the wall.
        const rad = Math.max(H, T) / 2;
        // Bark, or wood bleached silver by the sea.
        const log = mesh(geo(new THREE.CylinderGeometry(rad, rad * 0.9, L, 14)), mat(skin === 'log' ? '#5e4129' : '#bfb3a0', { rough: 0.95 }));
        log.rotation.z = Math.PI / 2;
        log.position.y = rad - H / 2;
        g.add(log);
        break;
      }
      case 'iceblock':
        g.add(mesh(geo(new RoundedBoxGeometry(L, H, T, 2, 0.04)), mat('#cfe8fb', { rough: 0.08, opacity: 0.82 })));
        break;
      case 'rail': {
        g.add(mesh(geo(new RoundedBoxGeometry(L, H, T, 2, 0.03)), mat('#f4efe4', { rough: 0.55 })));
        const stripe = mesh(geo(new THREE.BoxGeometry(L * 1.001, 0.06, T * 1.02)), mat('#e5323f', { rough: 0.5 }));
        stripe.position.y = H / 2 - 0.05;
        g.add(stripe);
        break;
      }
      default:
        g.add(mesh(geo(new RoundedBoxGeometry(L, H, T, 2, 0.03)), mat('#9a948b')));
    }
    g.position.set(p.x, H / 2, p.z);
    g.rotation.y = -p.a;
    return g;
  }

  function postMesh(p: Extract<Piece, { kind: 'post' }>, skin: string): THREE.Object3D {
    const g = new THREE.Group();
    const r = p.r;
    const h = p.h;
    switch (skin) {
      case 'rock': {
        const m = mesh(rockGeo(rng.int(1e6)), mat(pick(rockTone), { rough: 0.9 }));
        m.scale.set(r * 1.08, h * 0.62, r * 1.08);
        m.position.y = h * 0.32;
        m.rotation.y = rng.next() * Math.PI * 2;
        g.add(m);
        break;
      }
      case 'mug': {
        const colour = pick(['#f4f1ea', '#2a6fd6', '#e5323f', '#ffd23f']);
        const body = mesh(geo(new THREE.CylinderGeometry(r, r * 0.95, h, 28)), mat(colour, { rough: 0.3 }));
        body.position.y = h / 2;
        const coffee = mesh(geo(new THREE.CircleGeometry(r * 0.88, 28)), mat('#3b2414', { rough: 0.15 }), false);
        coffee.rotation.x = -Math.PI / 2;
        coffee.position.y = h + 0.002;
        const handle = mesh(geo(new THREE.TorusGeometry(h * 0.24, 0.035, 8, 20, Math.PI)), mat(colour, { rough: 0.3 }));
        handle.rotation.z = -Math.PI / 2;
        handle.position.set(r + 0.02, h * 0.55, 0);
        g.add(body, coffee, handle);
        break;
      }
      case 'pot': {
        const body = mesh(geo(new THREE.CylinderGeometry(r, r, h, 24)), mat('#1f6fd1', { rough: 0.35 }));
        body.position.y = h / 2;
        g.add(body);
        for (let i = 0; i < 4; i++) {
          const pen = mesh(geo(new THREE.CylinderGeometry(0.035, 0.035, h * 0.9, 6)), mat(pick(['#ffcc33', '#ff5a2a', '#1a7cff', '#14c06c']), { rough: 0.5 }));
          const a = (i / 4) * Math.PI * 2;
          pen.position.set(Math.cos(a) * r * 0.45, h * 0.95, Math.sin(a) * r * 0.45);
          pen.rotation.z = Math.cos(a) * 0.18;
          pen.rotation.x = Math.sin(a) * 0.18;
          g.add(pen);
        }
        break;
      }
      case 'cone': {
        const cone = mesh(geo(new THREE.CylinderGeometry(0.035, r, h, 24)), mat('#ff6a1a', { rough: 0.55 }));
        cone.position.y = h / 2 + 0.03;
        const band = mesh(geo(new THREE.CylinderGeometry(r * 0.52, r * 0.66, h * 0.18, 24)), mat('#f6f6f2', { rough: 0.3, emissive: '#2a2a2a' }));
        band.position.y = h * 0.55;
        const base = mesh(geo(new RoundedBoxGeometry(r * 2.4, 0.06, r * 2.4, 2, 0.02)), mat('#ff6a1a', { rough: 0.6 }));
        base.position.y = 0.03;
        g.add(cone, band, base);
        break;
      }
      case 'flowerpot': {
        const pot = mesh(geo(new THREE.CylinderGeometry(r, r * 0.75, h, 20)), mat('#b8592f', { rough: 0.9 }));
        pot.position.y = h / 2;
        const soil = mesh(geo(new THREE.CircleGeometry(r * 0.92, 20)), mat('#3a2718', { rough: 1 }), false);
        soil.rotation.x = -Math.PI / 2;
        soil.position.y = h - 0.04;
        g.add(pot, soil);
        for (let i = 0; i < 5; i++) {
          const leaf = mesh(geo(new THREE.SphereGeometry(r * 0.38, 10, 8)), mat(pick(['#3f8a2e', '#4f9e35', '#2f7426']), { rough: 0.8 }));
          leaf.position.set(rng.range(-r, r) * 0.45, h + r * 0.35 + rng.next() * r * 0.3, rng.range(-r, r) * 0.45);
          g.add(leaf);
        }
        break;
      }
      case 'sandcastle': {
        const sand = mat('#d8c39b', { rough: 1 });
        const tiers: [number, number][] = [
          [r, h * 0.5],
          [r * 0.68, h * 0.32],
          [r * 0.42, h * 0.22],
        ];
        let y = 0;
        for (const [tr, th] of tiers) {
          const t = mesh(geo(new THREE.CylinderGeometry(tr * 0.94, tr, th, 22)), sand);
          t.position.y = y + th / 2;
          y += th;
          g.add(t);
        }
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const m = mesh(geo(new THREE.BoxGeometry(0.07, 0.07, 0.07)), sand);
          m.position.set(Math.cos(a) * r * 0.36, y + 0.035, Math.sin(a) * r * 0.36);
          g.add(m);
        }
        break;
      }
      case 'railpost': {
        const post = mesh(geo(new THREE.CylinderGeometry(r, r, h, 18)), mat('#f4efe4', { rough: 0.5 }));
        post.position.y = h / 2;
        const cap = mesh(geo(new THREE.SphereGeometry(r * 1.1, 16, 10)), mat('#e5323f', { rough: 0.4 }));
        cap.position.y = h;
        g.add(post, cap);
        break;
      }
      default: {
        const m = mesh(geo(new THREE.CylinderGeometry(r, r, h, 20)), mat('#9a948b'));
        m.position.y = h / 2;
        g.add(m);
      }
    }
    g.position.set(p.x, 0, p.z);
    return g;
  }

  function bumpMesh(p: Extract<Piece, { kind: 'bump' }>, skin: string) {
    // The visible cap of a buried sphere.
    const top = 2 * p.r * (1 - p.sink);
    const cy = p.r * (1 - 2 * p.sink);
    const capR = Math.sqrt(Math.max(0, p.r * p.r - (p.r - top) * (p.r - top)));
    switch (skin) {
      case 'coin':
      case 'coin-silver': {
        const gold = skin === 'coin';
        const c = mesh(geo(new THREE.CylinderGeometry(capR, capR, top, 40)), mat(gold ? '#d9ae3f' : '#c9ccd2', { rough: 0.28, metal: 0.9 }));
        c.position.set(p.x, top / 2, p.z);
        const rim = mesh(geo(new THREE.TorusGeometry(capR * 0.86, 0.012, 6, 40)), mat(gold ? '#b8902c' : '#a9acb2', { rough: 0.3, metal: 0.9 }), false);
        rim.rotation.x = Math.PI / 2;
        rim.position.set(p.x, top + 0.002, p.z);
        group.add(c, rim);
        break;
      }
      case 'cap': {
        const c = mesh(geo(new THREE.CylinderGeometry(capR * 0.94, capR, top, 21)), mat(pick(['#d1262f', '#1f5fbf', '#2a8f3a', '#e3b21f']), { rough: 0.35, metal: 0.7 }));
        c.position.set(p.x, top / 2, p.z);
        group.add(c);
        break;
      }
      case 'molehill': {
        const hill = mesh(geo(new THREE.SphereGeometry(p.r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), mat('#5a3e28', { rough: 1 }));
        hill.position.set(p.x, cy, p.z);
        group.add(hill);
        break;
      }
      case 'shell': {
        const s = mesh(geo(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2)), mat(pick(['#f3e3cf', '#f0cdbb', '#e8d8c0']), { rough: 0.5 }));
        s.scale.set(capR * 1.3, top * 1.1 + 0.02, capR);
        s.position.set(p.x, 0, p.z);
        s.rotation.y = rng.next() * Math.PI * 2;
        group.add(s);
        break;
      }
      case 'stone':
        pebbles.push({ x: p.x, y: cy, z: p.z, r: p.r, tone: ['#4f4a44', '#5d5750', '#3f3a35', '#6a635a'] });
        break;
      default:
        pebbles.push({
          x: p.x,
          y: cy,
          z: p.z,
          r: p.r,
          tone: arena === 'ice' ? ['#3d4650', '#4a535d', '#56606a'] : arena === 'sand' ? ['#8d7a62', '#a08d74', '#6f604f'] : ['#5d564d', '#6b6157', '#4a443e', '#7a6f62', '#57504a', '#836f5c'],
        });
    }
  }

  function ridgeMesh(p: Extract<Piece, { kind: 'ridge' }>, skin: string) {
    const dx = p.x2 - p.x1;
    const dz = p.z2 - p.z1;
    const len = Math.hypot(dx, dz);
    const a = Math.atan2(dz, dx);
    const cx = (p.x1 + p.x2) / 2;
    const cz = (p.z1 + p.z2) / 2;
    /** Lay a model built along local +X onto the ridge line. */
    const lay = (obj: THREE.Object3D, y: number) => {
      const holder = new THREE.Group();
      holder.add(obj);
      holder.position.set(cx, y, cz);
      holder.rotation.y = -a;
      group.add(holder);
    };
    switch (skin) {
      case 'pencil': {
        const pencil = new THREE.Group();
        const body = mesh(geo(new THREE.CylinderGeometry(p.r, p.r, len * 0.86, 6)), mat(pick(['#ffcc33', '#ffcc33', '#2a6fd6', '#e5323f']), { rough: 0.5 }));
        const tip = mesh(geo(new THREE.ConeGeometry(p.r, len * 0.1, 6)), mat('#e7c9a0', { rough: 0.7 }));
        tip.position.y = len * 0.48;
        const lead = mesh(geo(new THREE.ConeGeometry(p.r * 0.35, len * 0.035, 6)), mat('#2b2b2b', { rough: 0.4 }));
        lead.position.y = len * 0.53;
        const eraser = mesh(geo(new THREE.CylinderGeometry(p.r, p.r, len * 0.05, 12)), mat('#ff8fa3', { rough: 0.8 }));
        eraser.position.y = -len * 0.455;
        pencil.add(body, tip, lead, eraser);
        pencil.rotation.z = -Math.PI / 2;
        lay(pencil, p.r * 0.65);
        break;
      }
      case 'paperclip': {
        const w = len * 0.28;
        const path = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-len / 2, 0, 0),
          new THREE.Vector3(-len / 2 + w * 0.3, 0, w / 2),
          new THREE.Vector3(len / 2 - w * 0.3, 0, w / 2),
          new THREE.Vector3(len / 2, 0, 0),
          new THREE.Vector3(len / 2 - w * 0.3, 0, -w / 2),
          new THREE.Vector3(-len / 2 + w * 0.6, 0, -w / 2),
          new THREE.Vector3(-len / 2 + w * 0.4, 0, 0),
          new THREE.Vector3(len / 2 - w * 0.6, 0, w * 0.18),
        ]);
        const clip = mesh(geo(new THREE.TubeGeometry(path, 48, p.r * 0.55, 6, false)), mat('#c8ccd2', { rough: 0.25, metal: 0.95 }));
        // Thinner than a pen line.
        clip.userData.noInk = true;
        lay(clip, p.r * 0.55);
        break;
      }
      case 'twig': {
        const twig = new THREE.Group();
        const bark = mat('#5a3f28', { rough: 0.95 });
        const stick = mesh(geo(new THREE.CylinderGeometry(p.r * 0.8, p.r, len, 6)), bark);
        stick.rotation.z = -Math.PI / 2;
        const fork = mesh(geo(new THREE.CylinderGeometry(p.r * 0.4, p.r * 0.6, len * 0.35, 5)), bark);
        fork.rotation.z = -Math.PI / 2 + 0.6;
        fork.position.set(len * 0.15, 0, len * 0.06);
        twig.add(stick, fork);
        lay(twig, p.r * 0.7);
        break;
      }
      default: {
        // A crack: a dark line in the slab, or a white one in the ice.
        const ice = skin === 'icecrack';
        const w = Math.max(0.045, p.r * 1.3);
        decal(
          geo(new THREE.PlaneGeometry(len + w, w)),
          own(new THREE.MeshStandardMaterial({ color: ice ? '#f2fbff' : '#2a2826', roughness: 0.6, transparent: true, opacity: 0.9, alphaMap: blob, depthWrite: false, emissive: ice ? '#3a5a70' : '#000000' })),
          cx,
          cz,
          0.006,
          -a,
        );
      }
    }
  }

  function zoneMesh(p: Extract<Piece, { kind: 'zone' }>, skin: string) {
    if (p.effect === 'boost') {
      const m = decal(
        geo(new THREE.CircleGeometry(p.r, 40)),
        own(new THREE.MeshStandardMaterial({ map: pad, transparent: true, roughness: 0.5, emissive: '#ffb000', emissiveMap: pad, emissiveIntensity: 0.35, depthWrite: false })),
        p.x,
        p.z,
        0.007,
        // The chevrons (texture up) point along the push.
        -p.a - Math.PI / 2,
      );
      m.receiveShadow = false;
      return;
    }
    if (skin === 'paper') {
      // A sheet of ruled paper (fitting the patch's circle), lying askew.
      const s = p.r * 1.5;
      decal(geo(new THREE.PlaneGeometry(s * 0.78, s)), own(new THREE.MeshStandardMaterial({ map: ruled, roughness: 0.85 })), p.x, p.z, 0.004, rng.next() * Math.PI);
      return;
    }
    if (skin === 'coffee') {
      decal(geo(new THREE.CircleGeometry(p.r * 1.05, 40)), own(new THREE.MeshStandardMaterial({ map: stain, transparent: true, roughness: 0.2, depthWrite: false })), p.x, p.z, 0.004, rng.next() * Math.PI);
      return;
    }
    const LOOK: Record<string, [color: string, rough: number, opacity: number]> = {
      puddle: ['#28323c', 0.03, 0.8],
      mud: ['#3b2a1a', 0.28, 0.92],
      wetsand: ['#8a7553', 0.85, 0.8],
      blackice: ['#14222f', 0.02, 0.82],
      snow: ['#f6f9fc', 1, 0.95],
    };
    const [color, rough, opacity] = LOOK[skin] ?? (p.effect === 'sticky' ? LOOK.mud : LOOK.puddle);
    decal(
      geo(new THREE.CircleGeometry(p.r * 1.12, 48)),
      own(new THREE.MeshStandardMaterial({ color, roughness: rough, transparent: true, opacity, alphaMap: blob, depthWrite: false })),
      p.x,
      p.z,
      0.004,
      rng.next() * Math.PI * 2,
    );
  }

  function holeMesh(p: Extract<Piece, { kind: 'hole' }>, skin: string) {
    decal(geo(new THREE.CircleGeometry(p.r, 40)), own(new THREE.MeshBasicMaterial({ color: '#07060a' })), p.x, p.z, 0.006);
    const lip = mesh(geo(new THREE.TorusGeometry(p.r, 0.022, 8, 40)), mat('#f2f2f2', { rough: 0.35, metal: 0.3 }), false);
    lip.rotation.x = Math.PI / 2;
    lip.position.set(p.x, 0.012, p.z);
    group.add(lip);
    if (skin !== 'cup') return;
    // The flag stands at the back of the cup, out of the way of a marble dropping in.
    const back = Math.atan2(p.z, p.x);
    const fx = p.x + Math.cos(back) * p.r * 0.75;
    const fz = p.z + Math.sin(back) * p.r * 0.75;
    const pole = mesh(geo(new THREE.CylinderGeometry(0.018, 0.018, 1.1, 8)), mat('#f4f1ea', { rough: 0.3 }));
    pole.position.set(fx, 0.55, fz);
    const flag = mesh(geo(new THREE.PlaneGeometry(0.42, 0.26, 6, 1)), own(new THREE.MeshStandardMaterial({ color: pick(['#e5323f', '#ffd23f', '#1a7cff']), roughness: 0.6, side: THREE.DoubleSide })));
    flag.position.set(fx + 0.21, 0.95, fz);
    flag.userData.base = (flag.geometry.attributes.position.array as Float32Array).slice();
    group.add(pole, flag);
    flags.push(flag);
  }

  // Ink everything solid so far; pebbles get a finer line of their own below.
  for (const g of ink(group, 0.03)) own(g);

  // Pebbles and stones: one instanced draw, each squashed and turned its own way.
  if (pebbles.length) {
    const inst = new THREE.InstancedMesh(rockGeo(17), own(toon('#ffffff')), pebbles.length);
    const qn = new THREE.Quaternion();
    const e = new THREE.Euler();
    pebbles.forEach((s, i) => {
      e.set(rng.next() * Math.PI, rng.next() * Math.PI, rng.next() * Math.PI);
      qn.setFromEuler(e);
      inst.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), qn, new THREE.Vector3(s.r * 1.25, s.r * 1.1, s.r * 1.2)));
      inst.setColorAt(i, new THREE.Color(s.tone[rng.int(s.tone.length)]));
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = shadows;
    inst.receiveShadow = true;
    for (const g of ink(inst, 0.012)) own(g);
    group.add(inst);
  }

  return {
    group,
    update: (t, dt) => {
      pad.offset.y = -(t * 0.8) % 1;
      for (const b of bumpers) {
        b.k = Math.max(0, b.k - dt * 4);
        const s = 1 + b.k * 0.22;
        b.ring.scale.set(s, s, 1 + b.k * 0.4);
        b.cap.emissiveIntensity = 0.15 + b.k * 2.2;
      }
      // Flags ripple in the breeze.
      for (const f of flags) {
        const pos = f.geometry.attributes.position as THREE.BufferAttribute;
        const base = f.userData.base as Float32Array;
        for (let i = 0; i < pos.count; i++) {
          const x = base[i * 3];
          pos.setZ(i, Math.sin(t * 5 + x * 9) * 0.06 * (x + 0.21));
        }
        pos.needsUpdate = true;
      }
    },
    pulse: (x, z, strength) => {
      for (const b of bumpers) if ((b.x - x) ** 2 + (b.z - z) ** 2 < 0.8 * 0.8) b.k = Math.min(1, b.k + strength / 800);
    },
    dispose: () => {
      for (const o of owned) o.dispose();
    },
  };
}

/** An irregular blob for mud, puddles and cracks: overlapping soft circles. */
function blobTexture(rng: Rng): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 9; i++) {
    const x = 64 + rng.range(-22, 22);
    const y = 64 + rng.range(-22, 22);
    const r = rng.range(26, 40);
    const grad = g.createRadialGradient(x, y, r * 0.55, x, y, r);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return new THREE.CanvasTexture(c);
}

/** A speed pad: bright chevrons on a dark disc, scrolled along the push. */
function padTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a1f05';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#ffd23f';
  for (let i = 0; i < 2; i++) {
    const y0 = i * 64 + 14;
    g.beginPath();
    g.moveTo(24, y0 + 30);
    g.lineTo(64, y0);
    g.lineTo(104, y0 + 30);
    g.lineTo(104, y0 + 46);
    g.lineTo(64, y0 + 16);
    g.lineTo(24, y0 + 46);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Ruled notebook paper with a margin line. */
function paperTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbfaf5';
  g.fillRect(0, 0, 192, 256);
  g.strokeStyle = 'rgba(80,130,200,0.55)';
  g.lineWidth = 1.5;
  for (let y = 34; y < 256; y += 14) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(192, y);
    g.stroke();
  }
  g.strokeStyle = 'rgba(220,70,70,0.6)';
  g.beginPath();
  g.moveTo(30, 0);
  g.lineTo(30, 256);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A coffee ring: a dried brown circle, darker at its edge. */
function stainTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 20, 64, 64, 60);
  grad.addColorStop(0, 'rgba(110,62,28,0.35)');
  grad.addColorStop(0.82, 'rgba(110,62,28,0.45)');
  grad.addColorStop(0.92, 'rgba(70,36,14,0.85)');
  grad.addColorStop(1, 'rgba(70,36,14,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Ruler markings on varnished wood. */
function rulerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8c88a';
  g.fillRect(0, 0, 512, 32);
  g.fillStyle = '#3a2a14';
  for (let i = 0; i <= 100; i++) {
    const x = 6 + i * 5;
    const h = i % 10 === 0 ? 14 : i % 5 === 0 ? 10 : 6;
    g.fillRect(x, 0, 1, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
