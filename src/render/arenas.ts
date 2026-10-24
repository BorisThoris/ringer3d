/**
 * Playing fields. Each arena is a surface (which changes the physics), a
 * light rig, and a handful of low-poly props built from primitives.
 */
import * as THREE from 'three';
import type { SurfaceKind } from '../sim/physics';
import type { GroundStyle } from './textures';

export interface ArenaDef {
  id: string;
  name: string;
  tagline: string;
  surface: SurfaceKind;
  ground: GroundStyle;
  groundTint: string;
  ringColor: string;
  sky: [top: string, horizon: string];
  fog: string;
  sun: { color: string; intensity: number; dir: [number, number, number] };
  ambient: { sky: string; ground: string; intensity: number };
  exposure: number;
  /** Extra warm/cool point lights (lamps, neon), cm. */
  lamps: { color: string; intensity: number; pos: [number, number, number] }[];
  props: (root: THREE.Group, rng: () => number) => void;
}

const mat = (color: string, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts });

function box(root: THREE.Group, w: number, h: number, d: number, x: number, z: number, m: THREE.Material, y = h / 2, ry = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.castShadow = mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function ringOf(n: number, radius: number, rng: () => number, f: (x: number, z: number, a: number) => void, jitter = 0.3) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rng() - 0.5) * jitter;
    const rr = radius * (0.9 + rng() * 0.25);
    f(Math.cos(a) * rr, Math.sin(a) * rr, a);
  }
}

export const ARENAS: ArenaDef[] = [
  {
    id: 'schoolyard',
    name: 'Schoolyard',
    tagline: 'Packed dirt, recess bell, bragging rights.',
    surface: 'dirt',
    ground: 'dirt',
    groundTint: '#8b6a47',
    ringColor: '#fbf6ea',
    sky: ['#5aa5ff', '#cfe7ff'],
    fog: '#cfe2f5',
    sun: { color: '#fff4dc', intensity: 3.2, dir: [0.5, 1, 0.35] },
    ambient: { sky: '#bcd8ff', ground: '#6b4f33', intensity: 0.9 },
    exposure: 1.0,
    lamps: [],
    props(root, rng) {
      const trunk = mat('#5a3b22');
      const leaves = mat('#3f8f4a', { roughness: 0.9 });
      ringOf(9, 520, rng, (x, z) => {
        const s = 0.8 + rng() * 0.6;
        box(root, 14 * s, 120 * s, 14 * s, x, z, trunk);
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(70 * s, 0), leaves);
        crown.position.set(x, 150 * s, z);
        crown.castShadow = true;
        root.add(crown);
      });
      // Chain-link-ish fence: posts and a rail.
      const post = mat('#9aa3ab', { metalness: 0.6, roughness: 0.4 });
      for (let i = -6; i <= 6; i++) box(root, 4, 110, 4, i * 55, -330, post);
      box(root, 680, 3, 3, 0, -330, post, 108);
      // Hopscotch in chalk, and a backpack.
      const chalk = mat('#f6f2e6', { roughness: 1 });
      for (let i = 0; i < 6; i++) box(root, 34, 0.3, 34, -210 + (i % 2) * 36, 120 + i * 38, chalk, 0.15);
      box(root, 30, 34, 16, 150, 170, mat('#e2483d'), 17, 0.4);
    },
  },
  {
    id: 'rooftop',
    name: 'Rooftop at Dusk',
    tagline: 'Fast pavement, city lights, long rolls.',
    surface: 'pavement',
    ground: 'pavement',
    groundTint: '#4a4d53',
    ringColor: '#ffd36b',
    sky: ['#1b1f4a', '#ff8a5c'],
    fog: '#5a3e57',
    sun: { color: '#ffb27a', intensity: 2.2, dir: [-0.8, 0.45, 0.3] },
    ambient: { sky: '#6a6fb0', ground: '#2a2228', intensity: 0.7 },
    exposure: 1.05,
    lamps: [{ color: '#ff4fd8', intensity: 6e4, pos: [220, 90, -200] }],
    props(root, rng) {
      const parapet = mat('#6d6f75');
      box(root, 900, 40, 20, 0, -400, parapet);
      box(root, 900, 40, 20, 0, 400, parapet);
      box(root, 20, 40, 800, -450, 0, parapet);
      box(root, 20, 40, 800, 450, 0, parapet);
      const metal = mat('#a7adb5', { metalness: 0.8, roughness: 0.35 });
      box(root, 90, 70, 70, -280, -260, metal);
      box(root, 60, 50, 60, 300, 250, metal);
      // Skyline: emissive window slabs far away.
      const win = new THREE.MeshStandardMaterial({ color: '#1b1d2a', emissive: '#ffcf7a', emissiveIntensity: 0.0 });
      ringOf(26, 2200, rng, (x, z) => {
        const h = 300 + rng() * 1400;
        const b = box(root, 180 + rng() * 200, h, 180 + rng() * 200, x, z, win.clone(), h / 2 - 200);
        (b.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05 + rng() * 0.35;
        b.castShadow = false;
      }, 0.15);
      // Neon sign.
      const neon = new THREE.MeshStandardMaterial({ color: '#ff4fd8', emissive: '#ff4fd8', emissiveIntensity: 3 });
      box(root, 160, 18, 4, 230, -388, neon, 70);
    },
  },
  {
    id: 'parlour',
    name: 'Grandma\'s Parlour',
    tagline: 'Thick carpet eats speed. Lamp light, tick of a clock.',
    surface: 'carpet',
    ground: 'carpet',
    groundTint: '#7a2f3a',
    ringColor: '#fff0c4',
    sky: ['#1a1210', '#3b2a22'],
    fog: '#2b1d17',
    sun: { color: '#ffd9a8', intensity: 1.1, dir: [0.2, 1, -0.4] },
    ambient: { sky: '#ffcf9e', ground: '#3a1d18', intensity: 0.55 },
    exposure: 1.15,
    lamps: [
      { color: '#ffb866', intensity: 1.6e5, pos: [-180, 170, -120] },
      { color: '#ffd9a0', intensity: 5e4, pos: [200, 120, 180] },
    ],
    props(root) {
      const wood = mat('#5b3420', { roughness: 0.55 });
      const fabric = mat('#2f4d5c', { roughness: 0.95 });
      // Sofa
      box(root, 320, 45, 90, 0, -330, fabric);
      box(root, 320, 70, 25, 0, -380, fabric, 80);
      box(root, 30, 60, 90, -170, -330, fabric);
      box(root, 30, 60, 90, 170, -330, fabric);
      // Side table + lamp
      box(root, 60, 55, 60, -180, -150, wood);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(22, 32, 36, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#ffe2b0', emissive: '#ffb866', emissiveIntensity: 1.2, side: THREE.DoubleSide }));
      shade.position.set(-180, 140, -150);
      root.add(shade);
      box(root, 4, 60, 4, -180, -150, wood, 85);
      // Bookshelf + rug edge fringe
      box(root, 40, 210, 180, 360, 0, wood);
      for (let i = 0; i < 5; i++) box(root, 34, 30, 160, 352, 0, mat(['#7d2b2b', '#2b4f7d', '#c9a14a', '#3f6b3a', '#5a3d6b'][i]), 30 + i * 40);
      box(root, 640, 0.6, 8, 0, 270, mat('#e8d6a8'), 0.3);
    },
  },
  {
    id: 'courtyard',
    name: 'Moonlit Courtyard',
    tagline: 'Old flagstones, lanterns, the Taw King waits.',
    surface: 'pavement',
    ground: 'stone',
    groundTint: '#55536a',
    ringColor: '#9fe8ff',
    sky: ['#04050f', '#1d2a55'],
    fog: '#101531',
    sun: { color: '#a9c6ff', intensity: 1.4, dir: [-0.3, 1, -0.6] },
    ambient: { sky: '#4b5fa8', ground: '#141020', intensity: 0.5 },
    exposure: 1.2,
    lamps: [
      { color: '#ff9d3c', intensity: 9e4, pos: [-260, 110, 220] },
      { color: '#ff9d3c', intensity: 9e4, pos: [260, 110, 220] },
      { color: '#62d6ff', intensity: 6e4, pos: [0, 140, -300] },
    ],
    props(root, rng) {
      const stone = mat('#6e6b7e', { roughness: 0.95 });
      ringOf(12, 430, rng, (x, z, a) => {
        const h = 160 + rng() * 140;
        box(root, 36, h, 36, x, z, stone, h / 2, a);
      }, 0.05);
      const glow = new THREE.MeshStandardMaterial({ color: '#ffcf8a', emissive: '#ff9d3c', emissiveIntensity: 2.5 });
      for (const x of [-260, 260]) {
        box(root, 6, 100, 6, x, 220, mat('#2a2830', { metalness: 0.6 }));
        box(root, 18, 22, 18, x, 220, glow, 110);
      }
      // A throne for the boss, far back.
      const gold = mat('#c9a14a', { metalness: 0.9, roughness: 0.3 });
      box(root, 120, 40, 90, 0, -330, stone);
      box(root, 120, 200, 20, 0, -370, gold, 140);
    },
  },
];

export function arenaById(id: string): ArenaDef {
  return ARENAS.find((a) => a.id === id) ?? ARENAS[0];
}
