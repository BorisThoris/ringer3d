/**
 * Procedural textures, drawn on canvases at startup so the game ships with no
 * image assets and every arena stays a few KB of code.
 */
import * as THREE from 'three';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function finish(c: HTMLCanvasElement, repeat: number, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export type GroundStyle = 'dirt' | 'pavement' | 'carpet' | 'stone';

const groundCache = new Map<string, { map: THREE.Texture; bump: THREE.Texture }>();

/** Colour + bump pair for a ground style (drawn once, then reused). */
export function groundTextures(style: GroundStyle, tint: string): { map: THREE.Texture; bump: THREE.Texture } {
  const key = `${style}:${tint}`;
  const hit = groundCache.get(key);
  if (hit) return hit;
  const made = drawGround(style, tint);
  groundCache.set(key, made);
  return made;
}

function drawGround(style: GroundStyle, tint: string): { map: THREE.Texture; bump: THREE.Texture } {
  const size = 512;
  const [c, g] = canvas(size);
  const [b, bg] = canvas(size);
  const r = rand(style.length * 977 + 13);
  g.fillStyle = tint;
  g.fillRect(0, 0, size, size);
  bg.fillStyle = '#808080';
  bg.fillRect(0, 0, size, size);

  const speck = (n: number, minR: number, maxR: number, colors: string[], bump: string) => {
    for (let i = 0; i < n; i++) {
      const x = r() * size;
      const y = r() * size;
      const rad = minR + r() * (maxR - minR);
      g.fillStyle = colors[Math.floor(r() * colors.length)];
      g.globalAlpha = 0.25 + r() * 0.5;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
      bg.fillStyle = bump;
      bg.globalAlpha = 0.5;
      bg.beginPath();
      bg.arc(x, y, rad, 0, Math.PI * 2);
      bg.fill();
    }
    g.globalAlpha = bg.globalAlpha = 1;
  };

  if (style === 'dirt') {
    speck(2600, 1, 5, ['#6b4a2f', '#8a6440', '#a07a52', '#5a3d26'], '#9a9a9a');
    // Pebbles: fewer and smaller, so marbles still read against the dirt.
    speck(220, 1.5, 4.5, ['#a48c70', '#7d7468', '#b8ab96'], '#c8c8c8');
  } else if (style === 'pavement') {
    speck(9000, 0.6, 2.2, ['#3a3d42', '#55595f', '#6c7076', '#2c2e31', '#8d9096'], '#b0b0b0');
    g.strokeStyle = 'rgba(20,20,22,0.55)';
    bg.strokeStyle = '#303030';
    for (let i = 0; i < 6; i++) {
      let x = r() * size;
      let y = r() * size;
      g.lineWidth = bg.lineWidth = 0.8 + r() * 1.4;
      g.beginPath();
      bg.beginPath();
      g.moveTo(x, y);
      bg.moveTo(x, y);
      for (let k = 0; k < 14; k++) {
        x += (r() - 0.5) * 40;
        y += (r() - 0.5) * 40;
        g.lineTo(x, y);
        bg.lineTo(x, y);
      }
      g.stroke();
      bg.stroke();
    }
  } else if (style === 'carpet') {
    for (let y = 0; y < size; y += 2) {
      for (let x = 0; x < size; x += 2) {
        const v = r();
        g.fillStyle = `rgba(0,0,0,${v * 0.18})`;
        g.fillRect(x, y, 2, 2);
        bg.fillStyle = `rgba(255,255,255,${v * 0.35})`;
        bg.fillRect(x, y, 2, 2);
      }
    }
    g.strokeStyle = 'rgba(255,220,170,0.08)';
    g.lineWidth = 6;
    for (let i = -size; i < size * 2; i += 48) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + size, size);
      g.stroke();
    }
  } else {
    // Flagstones with mortar lines.
    const tile = 128;
    for (let y = 0; y < size; y += tile) {
      for (let x = 0; x < size; x += tile) {
        const shade = 0.85 + r() * 0.3;
        g.fillStyle = `rgba(${Math.floor(120 * shade)},${Math.floor(118 * shade)},${Math.floor(130 * shade)},0.55)`;
        g.fillRect(x + 3, y + 3, tile - 6, tile - 6);
        bg.fillStyle = '#9a9a9a';
        bg.fillRect(x + 3, y + 3, tile - 6, tile - 6);
      }
    }
    g.strokeStyle = 'rgba(10,10,16,0.7)';
    g.lineWidth = 5;
    for (let i = 0; i <= size; i += tile) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, size);
      g.moveTo(0, i);
      g.lineTo(size, i);
      g.stroke();
    }
    speck(3000, 0.5, 2, ['#2a2833', '#6d6a78', '#a4a1ad'], '#a8a8a8');
  }
  // The ground disc is 52 m across; one tile is ~80 cm, so a speck reads as grit, not a blob.
  return { map: finish(c, 65), bump: finish(b, 65, false) };
}

/**
 * Chalk dust: a tileable alpha speckle, mostly solid with gaps, so a line
 * drawn with it looks rubbed onto the ground. Planar-mapped, so it works on
 * the ring annulus and the lag line alike.
 */
export function chalkTexture(repeat: number): THREE.Texture {
  const [c, g] = canvas(256);
  const r = rand(42);
  g.fillStyle = 'rgba(255,255,255,0.78)';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    g.globalCompositeOperation = r() < 0.55 ? 'destination-out' : 'source-over';
    g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.8})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 4, 1 + r() * 3);
  }
  g.globalCompositeOperation = 'source-over';
  return finish(c, repeat);
}
