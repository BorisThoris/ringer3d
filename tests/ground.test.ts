import { describe, expect, it } from 'vitest';
import { ARENA_LIST } from '../src/game/arenas';
import { paintGround } from '../src/render/groundArt';

/**
 * Every field's ground is one painted tile repeated across the floor. Where one copy meets
 * the next, the step between the last row (or column) and the first must look like any
 * other step between neighbouring rows inside the tile. A seam is a step far larger than
 * the largest one inside.
 */
const SIZE = 256;

/** Mean difference between each pair of neighbouring lines (rows or columns), and across the wrap. */
function lineSteps(px: Uint8ClampedArray | Float32Array, stride: number, scale: number, columns: boolean) {
  const at = (line: number, i: number, k: number) => {
    const x = columns ? line : i;
    const y = columns ? i : line;
    return px[(y * SIZE + x) * stride + k] * scale;
  };
  const step = (a: number, b: number) => {
    let d = 0;
    for (let i = 0; i < SIZE; i++) for (let k = 0; k < stride; k++) d += Math.abs(at(a, i, k) - at(b, i, k));
    return d / SIZE;
  };
  let largest = 0;
  for (let l = 0; l < SIZE - 1; l++) largest = Math.max(largest, step(l, l + 1));
  return { largest, wrap: step(SIZE - 1, 0) };
}

describe('ground tiles', () => {
  for (const a of ARENA_LIST) {
    it(`${a.id}: copies of the tile meet without a seam`, () => {
      const { color, height } = paintGround(a.id, SIZE);
      const rgb = new Uint8ClampedArray(SIZE * SIZE * 3);
      for (let i = 0; i < SIZE * SIZE; i++) rgb.set(color.subarray(i * 4, i * 4 + 3), i * 3);
      for (const [name, px, stride, scale] of [
        ['colour', rgb, 3, 1],
        ['height', height, 1, 255],
      ] as const) {
        for (const columns of [true, false]) {
          const s = lineSteps(px, stride, scale, columns);
          const where = columns ? 'left/right' : 'top/bottom';
          expect(s.wrap, `${a.id} ${name} ${where} seam (largest step inside ${s.largest.toFixed(2)})`).toBeLessThanOrEqual(s.largest * 1.1 + 0.5);
        }
      }
    });
  }
});
