import * as THREE from 'three';
import type { ArenaId } from '../game/arenas';

/**
 * Hand-made ground art for the toy-diorama look: each field's ground is painted in code as
 * a seamless tile (a colour map and a soft normal map) instead of a photo scan. The rule
 * for every one: a calm mid-tone with low local contrast, so the glossy marbles are always
 * the brightest, busiest thing on screen. Detail lives in gentle patterns (mower stripes,
 * ripples, slab joints) and in the normal map, never in noisy colour.
 *
 * Generated on the device at load (a few tens of ms per field), cached per field.
 */

export interface GroundArt {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** World units one tile covers. */
  tile: number;
  roughness: number;
  normalScale: number;
}

const SIZE = 1024;

// ---- Tileable noise ------------------------------------------------------------------------
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Value noise on a lattice that wraps every `period` cells (so the tile is seamless). */
function vnoise(u: number, v: number, period: number, seed: number): number {
  return vnoise2(u, v, period, period, seed);
}

/**
 * Stretched value noise: `px` cells across, `py` cells down, each a whole number so the
 * lattice still wraps at the tile's edges. (Scaling u or v before plain noise does not wrap,
 * and left a seam at every tile edge.)
 */
function vnoise2(u: number, v: number, px: number, py: number, seed: number): number {
  const x = u * px;
  const y = v * py;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const x0 = mod(ix, px);
  const y0 = mod(iy, py);
  const x1 = mod(ix + 1, px);
  const y1 = mod(iy + 1, py);
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Seamless fractal noise in 0..1, `period` cells at the base octave. */
function fbm(u: number, v: number, period: number, octaves: number, seed: number): number {
  let s = 0;
  let w = 0.5;
  let norm = 0;
  let p = period;
  for (let o = 0; o < octaves; o++) {
    s += vnoise(u, v, p, seed + o * 31) * w;
    norm += w;
    w *= 0.5;
    p *= 2;
  }
  return s / norm;
}

/** Seamless Worley noise: distance to the nearest and second nearest feature, and its id. */
function worley(u: number, v: number, cells: number, seed: number): { d1: number; d2: number; id: number } {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let d1 = 9;
  let d2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cy = iy + j;
      const wx = mod(cx, cells);
      const wy = mod(cy, cells);
      const px = cx + 0.15 + hash(wx, wy, seed) * 0.7;
      const py = cy + 0.15 + hash(wx, wy, seed + 7) * 0.7;
      const d = Math.hypot(px - x, py - y);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash(wx, wy, seed + 13);
      } else if (d < d2) d2 = d;
    }
  }
  return { d1, d2, id };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, t: number) => {
  const k = clamp01((t - a) / (b - a));
  return k * k * (3 - 2 * k);
};

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** One field's painter: colour and height (0..1) at a point of the tile. */
type Painter = (u: number, v: number) => { c: RGB; h: number };

interface Recipe {
  tile: number;
  roughness: number;
  normalScale: number;
  paint: Painter;
}

const RECIPES: Record<ArenaId, Recipe> = {
  // Honey-coloured varnished wood: long soft grain bands with gently wandering figure.
  desk: {
    tile: 30,
    roughness: 0.65,
    normalScale: 0.18,
    paint: (u, v) => {
      const warp = fbm(u, v, 2, 3, 1) * 0.08;
      const grain = Math.sin((v + warp) * Math.PI * 2 * 46 + fbm(u, v, 3, 3, 5) * 9);
      // Long streaks along the grain: few cells across, many down.
      const streak = vnoise2(u, v, 45, 180, 9);
      const t = 0.5 + grain * 0.5;
      const c = mix(hex('#6f4c33'), hex('#86603f'), t * 0.6 + streak * 0.4);
      return { c, h: t * 0.5 + streak * 0.5 };
    },
  },
  // Pale warm concrete slabs: soft blotches, fine aggregate, crisp joints between slabs.
  culdesac: {
    tile: 12,
    roughness: 0.95,
    normalScale: 0.6,
    paint: (u, v) => {
      const blot = fbm(u, v, 4, 4, 2);
      const grit = vnoise(u, v, 220, 3);
      const fleck = grit > 0.86 ? 0.88 : grit < 0.1 ? 1.06 : 1;
      // Two slabs across the tile, joints a quarter in from each edge (so no joint runs
      // along the line where one copy of the tile meets the next).
      const ju = Math.min(mod(u - 0.25, 0.5), 0.5 - mod(u - 0.25, 0.5));
      const jv = Math.min(mod(v - 0.25, 0.5), 0.5 - mod(v - 0.25, 0.5));
      const joint = 1 - smooth(0.002, 0.007, Math.min(ju, jv));
      let c = mix(hex('#8f8a82'), hex('#a09a91'), blot);
      c = shade(c, fleck * (1 - joint * 0.35));
      return { c, h: 0.6 + blot * 0.2 + (grit - 0.5) * 0.15 - joint * 0.6 };
    },
  },
  // A mown lawn: broad light and dark stripes, short-blade texture, a few clover patches.
  grass: {
    tile: 10,
    roughness: 0.95,
    normalScale: 0.8,
    paint: (u, v) => {
      const stripe = smooth(0.42, 0.58, Math.abs(Math.sin(v * Math.PI * 2)));
      const blades = vnoise2(u, v, 260, 65, 4) * 0.6 + vnoise(u, v, 140, 5) * 0.4;
      const clover = smooth(0.62, 0.72, fbm(u, v, 5, 3, 6));
      let c = mix(hex('#4f9a37'), hex('#67b545'), stripe);
      c = mix(c, hex('#3f8a35'), clover * 0.5);
      c = shade(c, 0.9 + blades * 0.18);
      return { c, h: blades * 0.8 + clover * 0.2 };
    },
  },
  // Wind-rippled sand, a little deeper than real so pale glass still shows on it.
  sand: {
    tile: 12,
    roughness: 0.98,
    normalScale: 0.9,
    paint: (u, v) => {
      const warp = fbm(u, v, 3, 3, 7) * 0.12;
      const ripple = 0.5 + 0.5 * Math.sin((v + warp + fbm(u, v, 6, 2, 8) * 0.03) * Math.PI * 2 * 12);
      const grains = vnoise(u, v, 300, 9);
      const blot = fbm(u, v, 3, 3, 10);
      let c = mix(hex('#cfae78'), hex('#dcbd87'), blot);
      c = shade(c, 0.95 + ripple * 0.05 + (grains - 0.5) * 0.04);
      return { c, h: ripple * 0.75 + grains * 0.25 };
    },
  },
  // Deep teal lake ice: slow depth variation, a white crack network, faint frost.
  ice: {
    tile: 16,
    roughness: 0.45,
    normalScale: 0.4,
    paint: (u, v) => {
      const depth = fbm(u, v, 3, 4, 11);
      // Warped, so cracks wander instead of forming a tiled honeycomb.
      const wu = u + (fbm(u, v, 4, 3, 18) - 0.5) * 0.08;
      const wv = v + (fbm(u, v, 4, 3, 19) - 0.5) * 0.08;
      const w = worley(mod(wu, 1), mod(wv, 1), 4, 12);
      const crack = (1 - smooth(0.003, 0.011, w.d2 - w.d1)) * smooth(0.35, 0.6, fbm(u, v, 5, 2, 20));
      const hair = 1 - smooth(0.002, 0.006, Math.abs(fbm(u, v, 9, 3, 13) - 0.5));
      const frost = smooth(0.7, 0.84, fbm(u, v, 6, 4, 14));
      let c = mix(hex('#2b5f7c'), hex('#3a7896'), depth);
      c = mix(c, hex('#cfe7f2'), Math.max(crack * 0.55, hair * 0.18));
      c = mix(c, hex('#a9cfe0'), frost * 0.3);
      return { c, h: 0.5 + depth * 0.1 - crack * 0.4 + frost * 0.2 };
    },
  },
  // Rounded pea gravel: each stone its own soft tone, darker gaps between them.
  gravel: {
    tile: 3,
    roughness: 0.92,
    normalScale: 0.9,
    paint: (u, v) => {
      // Fine pea gravel, much smaller than a marble, in close warm tones.
      const w = worley(u, v, 34, 15);
      const edge = w.d2 - w.d1;
      const dome = smooth(0, 0.45, edge);
      const tones: RGB[] = [hex('#8a8178'), hex('#938676'), hex('#7f786f'), hex('#9a8d7c'), hex('#857a6e')];
      let c = tones[Math.floor(w.id * tones.length)];
      c = shade(c, 0.86 + dome * 0.16);
      return { c, h: dome };
    },
  },
  // Mini-golf felt: bright, even, a fine fibre and the faintest roller lines.
  minigolf: {
    tile: 4,
    roughness: 0.92,
    normalScale: 0.5,
    paint: (u, v) => {
      const fibre = vnoise(u, v, 280, 16) * 0.6 + vnoise(u, v, 120, 17) * 0.4;
      const roller = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 4);
      const c = shade(hex('#37b04f'), 0.92 + fibre * 0.12 + roller * 0.03);
      return { c, h: fibre };
    },
  },
};

/**
 * Paint a field's tile: colour (RGBA) and height. Exported so tests can check that every
 * tile's edges meet seamlessly.
 */
export function paintGround(id: ArenaId, size: number): { color: Uint8ClampedArray; height: Float32Array } {
  const r = RECIPES[id];
  const color = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { c, h } = r.paint(x / size, y / size);
      const i = y * size + x;
      color[i * 4] = c[0];
      color[i * 4 + 1] = c[1];
      color[i * 4 + 2] = c[2];
      color[i * 4 + 3] = 255;
      height[i] = h;
    }
  }
  return { color, height };
}

const cache = new Map<ArenaId, GroundArt>();

/** The field's ground: painted once, then shared. */
export function groundArt(id: ArenaId): GroundArt {
  const hit = cache.get(id);
  if (hit) return hit;
  const r = RECIPES[id];
  const { color, height } = paintGround(id, SIZE);
  // Normals from the height field (wrapping, so the tile stays seamless).
  const normal = new Uint8ClampedArray(SIZE * SIZE * 4);
  const at = (x: number, y: number) => height[mod(y, SIZE) * SIZE + mod(x, SIZE)];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 4;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 4;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * SIZE + x) * 4;
      normal[i] = (-dx / len) * 127 + 128;
      normal[i + 1] = (dy / len) * 127 + 128;
      normal[i + 2] = (1 / len) * 127 + 128;
      normal[i + 3] = 255;
    }
  }
  const tex = (data: Uint8ClampedArray, srgb: boolean) => {
    const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  const art: GroundArt = { map: tex(color, true), normalMap: tex(normal, false), tile: r.tile, roughness: r.roughness, normalScale: r.normalScale };
  cache.set(id, art);
  return art;
}

/** A small CSS-ready swatch of a field's ground, for pickers and cards. */
const swatches = new Map<ArenaId, string>();
export function groundSwatch(id: ArenaId): string {
  const hit = swatches.get(id);
  if (hit) return hit;
  const r = RECIPES[id];
  const W = 160;
  const H = 80;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  // Show about a third of a tile, so patterns read at card size.
  const span = Math.min(1, 6 / r.tile);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const { c: col } = r.paint((x / W) * span, (y / W) * span);
      const i = (y * W + x) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const url = c.toDataURL('image/png');
  swatches.set(id, url);
  return url;
}
