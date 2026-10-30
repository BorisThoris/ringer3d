import * as THREE from 'three';
import { hashString, Rng } from '../rng';
import { surfaceFlaws, type SurfaceFlaws } from '../flaws';
import type { MarbleLook } from '../look';

/**
 * The glass surface of one marble as texture maps over the sphere's UVs: a normal map (ripple,
 * the seam ridge, burst-bubble pits, scratch grooves, chips) and a roughness map (green channel:
 * fingerprints, scuffed haze, scratches). The flaws come from `surfaceFlaws` (how it was made),
 * the marks from the collectible's wear float (how it was played). The normal map bends the
 * light through the glass too, so a scratch or a pit distorts what is behind it.
 *
 * Marks are planned once in 512x256 "reference pixels" and drawn into every map at its size, so
 * the maps and the pale scratch overlay line up. Everything wraps round the u seam.
 */

interface Mark { x: number; y: number; a: number; len: number; w: number; bend: [number, number]; k: number }
interface Spot { x: number; y: number; rad: number; k: number }
interface Plan {
  flaws: SurfaceFlaws | null;
  wear: number;
  scuffs: Spot[];
  scratches: Mark[];
  chips: Spot[];
  pits: Spot[];
  prints: Spot[];
  seam: { phase: number; waves: number };
  ripple: { d: [number, number, number]; f: number; p: number }[];
}

const REF_W = 512;
const REF_H = 256;

const plans = new Map<string, Plan>();
function plan(look: MarbleLook): Plan {
  const key = `${look.id}:${look.wear ?? 0}:${look.flaws !== false}`;
  const hit = plans.get(key);
  if (hit) return hit;
  const flaws = look.flaws === false ? null : surfaceFlaws(look.id);
  const wear = look.wear ?? 0;
  const p: Plan = { flaws, wear, scuffs: [], scratches: [], chips: [], pits: [], prints: [], seam: { phase: 0, waves: 1 }, ripple: [] };

  // Wear: scuffed haze from Scuffed on, scratches growing with the float, chips on Chipped glass.
  const rng = new Rng(hashString(`wear:${look.id}`));
  if (wear > 0.3)
    for (let i = 0, n = Math.round((wear - 0.3) * 30); i < n; i++)
      p.scuffs.push({ x: rng.next() * REF_W, y: REF_H * (0.2 + rng.next() * 0.6), rad: 18 + rng.next() * 50, k: 0.25 + wear * 0.3 });
  if (wear >= 0.02)
    for (let i = 0, n = Math.round(wear * 220); i < n; i++)
      p.scratches.push({
        x: rng.next() * REF_W,
        y: REF_H * (0.1 + rng.next() * 0.8),
        a: rng.next() * Math.PI,
        len: 6 + rng.next() * (20 + wear * 50),
        w: 0.6 + rng.next() * 1.4,
        bend: [rng.range(-3, 3), rng.range(-3, 3)],
        k: 0.3 + rng.next() * 0.4,
      });
  if (wear > 0.45)
    for (let i = 0, n = Math.round((wear - 0.45) * 40); i < n; i++)
      p.chips.push({ x: rng.next() * REF_W, y: REF_H * (0.15 + rng.next() * 0.7), rad: 1.5 + rng.next() * 3.5, k: rng.next() });

  // Flaws from the furnace.
  if (flaws && !flaws.flawless) {
    const fr = new Rng(hashString(`flawmap:${look.id}`));
    for (let i = 0; i < flaws.pits; i++) p.pits.push({ x: fr.next() * REF_W, y: REF_H * (0.15 + fr.next() * 0.7), rad: 1.6 + fr.next() * 3.2, k: fr.next() });
    if (flaws.smudge > 0)
      for (let i = 0, n = 1 + fr.int(3); i < n; i++) p.prints.push({ x: fr.next() * REF_W, y: REF_H * (0.28 + fr.next() * 0.44), rad: 9 + fr.next() * 12, k: fr.next() * Math.PI });
    p.seam = { phase: fr.next() * Math.PI * 2, waves: 1 + fr.int(3) };
    for (let i = 0; i < 7; i++) {
      const z = fr.range(-1, 1);
      const t = fr.next() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      p.ripple.push({ d: [s * Math.cos(t), z, s * Math.sin(t)], f: fr.range(7, 17), p: fr.next() * Math.PI * 2 });
    }
  }
  plans.set(key, p);
  return p;
}

/** Calls draw at x and at its copies across the u seam, so marks wrap round the sphere. */
function wrapped(x: number, pad: number, W: number, draw: (x: number) => void) {
  draw(x);
  if (x < pad) draw(x + W);
  if (x > W - pad) draw(x - W);
}

/** Horizontal stretch at a canvas row: the equirect map squeezes the sphere toward the poles. */
const stretch = (y: number, H: number) => 1 / Math.max(0.25, Math.sin((Math.PI * y) / H));

function flake(g: CanvasRenderingContext2D, x: number, y: number, rad: number, sx: number, k: number) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    const rr = rad * (0.6 + (((k * 997 + i * 0.37) % 1) * 0.6));
    g[i ? 'lineTo' : 'moveTo'](x + Math.cos(t) * rr * sx, y + Math.sin(t) * rr);
  }
  g.fill();
}

function scratchPath(g: CanvasRenderingContext2D, m: Mark, s: number, x: number) {
  g.beginPath();
  g.moveTo(x * s, m.y * s);
  g.quadraticCurveTo(
    (x + Math.cos(m.a) * m.len * 0.5 + m.bend[0]) * s,
    (m.y + Math.sin(m.a) * m.len * 0.5 + m.bend[1]) * s,
    (x + Math.cos(m.a) * m.len) * s,
    (m.y + Math.sin(m.a) * m.len) * s,
  );
  g.stroke();
}

function seamPath(g: CanvasRenderingContext2D, p: Plan, W: number, H: number) {
  g.beginPath();
  for (let x = -8; x <= W + 8; x += 3) {
    const y = H / 2 + Math.sin((x / W) * Math.PI * 2 * p.seam.waves + p.seam.phase) * H * 0.03;
    g[x < -7 ? 'moveTo' : 'lineTo'](x, y);
  }
  g.stroke();
}

function canvas(W: number, H: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** The height field (grey 128 = level) turned into a tangent-space normal map. */
function normalMap(p: Plan, W: number, H: number): THREE.Texture {
  const s = W / REF_W;
  const [c, g] = canvas(W, H);
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, W, H);
  const f = p.flaws;
  // The seam: a soft raised ridge with a fine cut line along its crest.
  if (f && f.seam > 0) {
    g.filter = `blur(${1.4 * s}px)`;
    g.strokeStyle = `rgba(255,255,255,${0.12 + f.seam * 0.22})`;
    g.lineWidth = (1.2 + f.seam * 1.4) * s;
    seamPath(g, p, W, H);
    g.filter = 'none';
    g.strokeStyle = `rgba(70,70,70,${0.18 + f.seam * 0.22})`;
    g.lineWidth = 0.7 * s;
    seamPath(g, p, W, H);
  }
  // Pits: a burst bubble leaves a crater with a little lip.
  for (const pt of p.pits)
    wrapped(pt.x * s, pt.rad * 4 * s, W, (x) => {
      const y = pt.y * s;
      const sx = stretch(y, H);
      const rad = pt.rad * s;
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, rad * 1.5);
      grad.addColorStop(0, 'rgb(10,10,10)');
      grad.addColorStop(0.55, 'rgb(60,60,60)');
      grad.addColorStop(0.72, 'rgb(175,175,175)');
      grad.addColorStop(1, 'rgba(128,128,128,0)');
      g.save();
      g.translate(x, y);
      g.scale(sx, 1);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, rad * 1.5, 0, Math.PI * 2);
      g.fill();
      g.restore();
    });
  // Scratches are grooves, chips are flakes knocked out of the surface.
  g.lineCap = 'round';
  for (const m of p.scratches)
    wrapped(m.x, m.len + 4, REF_W, (x) => {
      g.strokeStyle = `rgba(60,60,60,${0.1 + m.k * 0.3})`;
      g.lineWidth = Math.max(1, m.w * 0.5 * s);
      scratchPath(g, m, s, x);
    });
  for (const ch of p.chips)
    wrapped(ch.x * s, ch.rad * 4 * s, W, (x) => {
      g.fillStyle = 'rgb(25,25,25)';
      flake(g, x, ch.y * s, ch.rad * s, stretch(ch.y * s, H), ch.k);
    });

  const src = g.getImageData(0, 0, W, H).data;
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = (src[i * 4] - 128) / 128;
  // Orange peel: smooth waves sampled on the sphere itself, so there is no seam and no pinch.
  if (f && f.ripple > 0) {
    const amp = f.ripple * 0.3;
    for (let y = 0; y < H; y++) {
      const th = (Math.PI * (y + 0.5)) / H;
      const st = Math.sin(th);
      const ct = Math.cos(th);
      for (let x = 0; x < W; x++) {
        const ph = (Math.PI * 2 * (x + 0.5)) / W;
        const px = -Math.cos(ph) * st;
        const pz = Math.sin(ph) * st;
        let v = 0;
        for (const w of p.ripple) v += Math.sin((px * w.d[0] + ct * w.d[1] + pz * w.d[2]) * w.f + w.p);
        h[y * W + x] += v * amp;
      }
    }
  }
  const out = g.createImageData(W, H);
  const o = out.data;
  const k = 1.7;
  for (let y = 0; y < H; y++) {
    const sx = 1 / Math.max(0.15, Math.sin((Math.PI * (y + 0.5)) / H));
    const yu = Math.max(0, y - 1);
    const yd = Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const xl = (x - 1 + W) % W;
      const xr = (x + 1) % W;
      // Gradients in reference pixels, so every map size bends the light the same.
      const dx = ((h[y * W + xr] - h[y * W + xl]) / 2) * s * sx;
      const dy = ((h[yd * W + x] - h[yu * W + x]) / 2) * s;
      // Canvas rows run down while v runs up, so the v gradient is -dy.
      let nx = -dx * k;
      let ny = dy * k;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * W + x) * 4;
      o[i] = Math.round((nx * 0.5 + 0.5) * 255);
      o[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      o[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      o[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Roughness (green): the base, then haze, fingerprints, scratches, chips and pits. */
function roughnessMap(p: Plan, base: number, W: number, H: number): THREE.Texture {
  const s = W / REF_W;
  const [c, g] = canvas(W, H);
  const v = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255);
  g.fillStyle = `rgb(0,${v(base)},0)`;
  g.fillRect(0, 0, W, H);
  for (const sc of p.scuffs)
    wrapped(sc.x * s, sc.rad * 2 * s, W, (x) => {
      const y = sc.y * s;
      const rad = sc.rad * s;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(0,${v(base + sc.k)},0,0.8)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    });
  // Fingerprints: a hazy oval with the ridges of a print in it.
  const smudge = p.flaws?.smudge ?? 0;
  for (const pr of p.prints)
    wrapped(pr.x * s, pr.rad * 3 * s, W, (x) => {
      const y = pr.y * s;
      const rad = pr.rad * s;
      g.save();
      g.translate(x, y);
      g.scale(stretch(y, H), 1);
      g.rotate(pr.k);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, rad * 1.2);
      grad.addColorStop(0, `rgba(0,${v(base + 0.1 + smudge * 0.12)},0,0.7)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(-rad * 1.3, -rad * 1.3, rad * 2.6, rad * 2.6);
      g.strokeStyle = `rgba(0,${v(base + 0.16 + smudge * 0.3)},0,0.55)`;
      g.lineWidth = Math.max(1, 0.9 * s);
      for (let j = 1; j <= 7; j++) {
        g.beginPath();
        g.ellipse(0, j * 0.04 * rad, (j / 7) * rad * 0.75, (j / 7) * rad, 0, Math.PI * 0.05, Math.PI * 1.95);
        g.stroke();
      }
      g.restore();
    });
  if (p.flaws && p.flaws.seam > 0) {
    g.strokeStyle = `rgba(0,${v(base + 0.08 + p.flaws.seam * 0.1)},0,0.8)`;
    g.lineWidth = 2 * s;
    seamPath(g, p, W, H);
  }
  g.lineCap = 'round';
  for (const m of p.scratches)
    wrapped(m.x, m.len + 4, REF_W, (x) => {
      g.strokeStyle = `rgba(0,${v(base + m.k)},0,${0.5 + m.k * 0.7})`;
      g.lineWidth = Math.max(1, m.w * s);
      scratchPath(g, m, s, x);
    });
  for (const pt of [...p.chips, ...p.pits])
    wrapped(pt.x * s, pt.rad * 3 * s, W, (x) => {
      g.fillStyle = `rgb(0,${v(0.75)},0)`;
      flake(g, x, pt.y * s, pt.rad * s * 0.8, stretch(pt.y * s, H), pt.k);
    });
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export interface SurfaceMaps {
  normal: THREE.Texture | null;
  roughness: THREE.Texture | null;
  /** The turn that puts the seam where this marble's seam runs (apply to the surface mesh). */
  turn: [number, number];
}

const normals = new Map<string, THREE.Texture>();
const roughs = new Map<string, THREE.Texture>();

/** The surface maps of a marble at a base roughness; null maps when there is nothing to show. */
export function surfaceMaps(look: MarbleLook, baseRough: number, hi: boolean): SurfaceMaps {
  const p = plan(look);
  const W = hi ? 1024 : 512;
  const H = W / 2;
  const marks = p.scratches.length + p.chips.length + p.scuffs.length;
  const flawed = !!p.flaws && !p.flaws.flawless;
  const key = `${look.id}:${p.wear}:${look.flaws !== false}:${W}`;
  let normal: THREE.Texture | null = null;
  if (flawed || p.scratches.length || p.chips.length) {
    normal = normals.get(key) ?? null;
    if (!normal) normals.set(key, (normal = normalMap(p, W, H)));
  }
  let roughness: THREE.Texture | null = null;
  if (marks || p.prints.length || p.pits.length || (p.flaws?.seam ?? 0) > 0) {
    const rk = `${key}:${baseRough}`;
    roughness = roughs.get(rk) ?? null;
    if (!roughness) roughs.set(rk, (roughness = roughnessMap(p, baseRough, W, H)));
  }
  return { normal, roughness, turn: p.flaws?.turn ?? [0, 0] };
}

const overlays = new Map<string, THREE.Texture>();

/** The wear marks as pale lines with alpha, laid just over the glass so wear shows in any light. */
export function scratchOverlay(look: MarbleLook): THREE.Texture | null {
  const p = plan(look);
  if (p.wear < 0.1) return null;
  const key = `${look.id}:${p.wear}`;
  const hit = overlays.get(key);
  if (hit) return hit;
  const [c, g] = canvas(REF_W, REF_H);
  g.lineCap = 'round';
  // Only the deeper scratches catch the light this way.
  for (const m of p.scratches)
    if (m.k > 0.42)
      wrapped(m.x, m.len + 4, REF_W, (x) => {
        g.strokeStyle = `rgba(255,255,255,${0.2 + (m.k - 0.42) * 2})`;
        g.lineWidth = 0.5 + m.w * 0.6;
        scratchPath(g, m, 1, x);
      });
  for (const ch of p.chips)
    wrapped(ch.x, ch.rad * 4, REF_W, (x) => {
      g.fillStyle = 'rgba(255,255,255,0.75)';
      flake(g, x, ch.y, ch.rad, stretch(ch.y, REF_H), ch.k);
    });
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  overlays.set(key, tex);
  return tex;
}
