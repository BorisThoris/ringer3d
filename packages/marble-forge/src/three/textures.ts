import * as THREE from 'three';
import { Rng } from '../rng';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
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

function shade(hex: string, pct: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + pct / 100)));
  return `#${c.getHexString()}`;
}

/** Inner-pattern textures for marbles. */
export function marbleTexture(kind: 'swirl' | 'clay' | 'galaxy' | 'cracks' | 'bands', a: string, b: string, seed: number): THREE.Texture {
  return cached(`m:${kind}:${a}:${b}:${seed}`, () => {
    const size = 512;
    const [c, g] = canvas(size);
    const rng = new Rng(seed);
    if (kind === 'swirl') {
      g.fillStyle = b;
      g.fillRect(0, 0, size, size);
      for (let k = 0; k < 7; k++) {
        g.strokeStyle = k % 2 ? a : shade(a, 25);
        g.lineWidth = rng.range(18, 40);
        g.lineCap = 'round';
        g.beginPath();
        const y0 = rng.next() * size;
        for (let x = -20; x <= size + 20; x += 8) {
          g.lineTo(x, y0 + Math.sin(x / 50 + k) * 60 + Math.sin(x / 17) * 10);
        }
        g.stroke();
      }
    } else if (kind === 'clay') {
      g.fillStyle = a;
      g.fillRect(0, 0, size, size);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = rng.next() < 0.5 ? b : 'rgba(0,0,0,0.12)';
        g.fillRect(rng.next() * size, rng.next() * size, rng.range(1, 4), rng.range(1, 4));
      }
    } else if (kind === 'galaxy') {
      const grd = g.createLinearGradient(0, 0, size, size);
      grd.addColorStop(0, '#05010f');
      grd.addColorStop(0.5, a);
      grd.addColorStop(1, '#05010f');
      g.fillStyle = grd;
      g.fillRect(0, 0, size, size);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = rng.next() < 0.15 ? b : 'rgba(255,255,255,0.9)';
        const s = rng.next() < 0.97 ? 1.2 : 3;
        g.fillRect(rng.next() * size, rng.next() * size, s, s);
      }
    } else if (kind === 'cracks') {
      g.fillStyle = '#000';
      g.fillRect(0, 0, size, size);
      g.strokeStyle = a;
      g.shadowColor = b;
      g.shadowBlur = 12;
      for (let k = 0; k < 18; k++) {
        g.lineWidth = rng.range(1.5, 4);
        g.beginPath();
        let x = rng.next() * size;
        let y = rng.next() * size;
        g.moveTo(x, y);
        for (let j = 0; j < 8; j++) {
          x += rng.range(-50, 50);
          y += rng.range(-50, 50);
          g.lineTo(x, y);
        }
        g.stroke();
      }
    } else {
      g.fillStyle = '#000';
      g.fillRect(0, 0, size, size);
      for (let k = 0; k < 4; k++) {
        g.fillStyle = k % 2 ? a : b;
        g.fillRect(0, (k * size) / 4 + 20, size, 18);
      }
    }
    return toTexture(c, 1);
  });
}
