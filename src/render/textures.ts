import * as THREE from 'three';
import { Rng } from '../core/rng';

/** All textures are drawn procedurally so the game ships with zero image assets. */

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

export type GroundPattern = 'asphalt' | 'sand' | 'tiles' | 'ice' | 'basalt';

export function groundTexture(pattern: GroundPattern, base: string, detail: string): THREE.Texture {
  return cached(`g:${pattern}:${base}:${detail}`, () => {
    const size = 1024;
    const [c, g] = canvas(size);
    const rng = new Rng(pattern.length * 977);
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    switch (pattern) {
      case 'asphalt': {
        // Soft tonal patches, then fine aggregate.
        for (let i = 0; i < 160; i++) {
          const x0 = rng.next() * size;
          const y0 = rng.next() * size;
          const r = rng.range(40, 160);
          const col = rng.next() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.05)';
          wrapped(size, (ox, oy) => {
            const x = x0 + ox;
            const y = y0 + oy;
            const grd = g.createRadialGradient(x, y, 0, x, y, r);
            grd.addColorStop(0, col);
            grd.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = grd;
            g.fillRect(x - r, y - r, r * 2, r * 2);
          });
        }
        for (let i = 0; i < 60000; i++) {
          const v = rng.next();
          g.fillStyle = v < 0.45 ? detail : v < 0.8 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.08)';
          const s = rng.range(0.6, 1.6);
          g.fillRect(rng.next() * size, rng.next() * size, s, s);
        }
        // A couple of hairline cracks.
        g.strokeStyle = 'rgba(0,0,0,0.35)';
        g.lineWidth = 1.5;
        for (let k = 0; k < 6; k++) {
          const pts: [number, number][] = [[rng.next() * size, rng.next() * size]];
          for (let j = 0; j < 14; j++) {
            const [px, py] = pts[pts.length - 1];
            pts.push([px + rng.range(-30, 30), py + rng.range(-30, 30)]);
          }
          wrapped(size, (ox, oy) => {
            g.beginPath();
            pts.forEach(([x, y], j) => (j ? g.lineTo(x + ox, y + oy) : g.moveTo(x + ox, y + oy)));
            g.stroke();
          });
        }
        break;
      }
      case 'sand': {
        // Raked concentric grooves are drawn on a separate mesh; here: fine grain.
        for (let i = 0; i < 40000; i++) {
          g.fillStyle = rng.next() < 0.5 ? detail : 'rgba(255,255,255,0.18)';
          g.fillRect(rng.next() * size, rng.next() * size, 1.5, 1.5);
        }
        break;
      }
      case 'tiles': {
        const n = 8;
        const s = size / n;
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++) {
            const l = rng.range(-6, 6);
            g.fillStyle = shade(base, l);
            g.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
          }
        g.strokeStyle = detail;
        g.lineWidth = 4;
        for (let i = 0; i <= n; i++) {
          g.beginPath();
          g.moveTo(i * s, 0);
          g.lineTo(i * s, size);
          g.moveTo(0, i * s);
          g.lineTo(size, i * s);
          g.stroke();
        }
        break;
      }
      case 'ice': {
        for (let i = 0; i < 60; i++) {
          const x0 = rng.next() * size;
          const y0 = rng.next() * size;
          const r = rng.range(80, 220);
          wrapped(size, (ox, oy) => {
            const grd = g.createRadialGradient(x0 + ox, y0 + oy, 0, x0 + ox, y0 + oy, r);
            grd.addColorStop(0, detail);
            grd.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = grd;
            g.globalAlpha = 0.5;
            g.fillRect(x0 + ox - r, y0 + oy - r, r * 2, r * 2);
            g.globalAlpha = 1;
          });
        }
        g.strokeStyle = 'rgba(255,255,255,0.55)';
        for (let k = 0; k < 40; k++) {
          g.lineWidth = rng.range(0.5, 2);
          const x = rng.next() * size;
          const y = rng.next() * size;
          const ex = x + rng.range(-160, 160);
          const ey = y + rng.range(-160, 160);
          wrapped(size, (ox, oy) => {
            g.beginPath();
            g.moveTo(x + ox, y + oy);
            g.lineTo(ex + ox, ey + oy);
            g.stroke();
          });
        }
        break;
      }
      case 'basalt': {
        // Hexagonal columns seen from above.
        const r = 46;
        const h = Math.sqrt(3) * r;
        for (let y = -1; y < size / h + 1; y++)
          for (let x = -1; x < size / (r * 1.5) + 1; x++) {
            const cx = x * r * 1.5;
            const cy = y * h + (x % 2 ? h / 2 : 0);
            g.fillStyle = shade(base, rng.range(-8, 10));
            g.beginPath();
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2;
              g.lineTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3));
            }
            g.closePath();
            g.fill();
          }
        break;
      }
    }
    return toTexture(c, pattern === 'tiles' ? 4 : pattern === 'asphalt' || pattern === 'sand' ? 12 : 6);
  });
}

/** Chalk / rope / neon ring as a strip texture (u along the ring, v across). */
export function ringTexture(style: string): THREE.Texture {
  return cached(`ring:${style}`, () => {
    const w = 2048;
    const h = 64;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const rng = new Rng(style.length * 31);
    g.clearRect(0, 0, w, h);
    if (style === 'chalk') {
      for (let i = 0; i < 9000; i++) {
        const y = h / 2 + rng.gaussian() * h * 0.16;
        g.fillStyle = `rgba(255,255,255,${rng.range(0.25, 0.9)})`;
        g.fillRect(rng.next() * w, y, rng.range(1, 4), rng.range(1, 3));
      }
    } else if (style === 'rope') {
      for (let x = 0; x < w; x += 10) {
        g.fillStyle = '#8a6036';
        g.beginPath();
        g.ellipse(x, h / 2, 9, 14, 0.7, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(40,20,5,0.6)';
        g.stroke();
      }
    } else {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.5, 'rgba(255,255,255,1)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      if (style === 'lava') {
        for (let i = 0; i < 400; i++) {
          g.fillStyle = `rgba(0,0,0,${rng.range(0.2, 0.6)})`;
          g.fillRect(rng.next() * w, rng.range(h * 0.3, h * 0.7), rng.range(4, 30), rng.range(2, 6));
        }
      }
    }
    const t = toTexture(c, 1);
    t.repeat.set(1, 1);
    return t;
  });
}

/** City skyline window texture (emissive). */
export function windowsTexture(): THREE.Texture {
  return cached('windows', () => {
    const [c, g] = canvas(256);
    const rng = new Rng(5);
    g.fillStyle = '#05040a';
    g.fillRect(0, 0, 256, 256);
    for (let y = 4; y < 256; y += 12)
      for (let x = 4; x < 256; x += 10) {
        if (rng.next() < 0.42) {
          const v = rng.next();
          g.fillStyle = v < 0.6 ? '#ffd27a' : v < 0.8 ? '#8fe9ff' : '#ff8ae2';
          g.globalAlpha = rng.range(0.4, 1);
          g.fillRect(x, y, 6, 7);
        }
      }
    g.globalAlpha = 1;
    return toTexture(c, 1);
  });
}

export function radialGlowTexture(): THREE.Texture {
  return cached('glow', () => {
    const [c, g] = canvas(128);
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return toTexture(c, 1);
  });
}

/** Draw something at every offset that could reach into the tile, so textures repeat seamlessly. */
function wrapped(size: number, draw: (ox: number, oy: number) => void) {
  for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) draw(ox, oy);
}

function shade(hex: string, pct: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + pct / 100)));
  return `#${c.getHexString()}`;
}
