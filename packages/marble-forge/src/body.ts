import { hashString, Rng } from './rng';

/**
 * The glass body: how the light gets through a marble. Like the surface flaws, it follows from
 * the marble's id alone in its own random stream, so the generator's draws (and every marble
 * already minted) stay as they were, and two marbles of the same pattern and colours still differ.
 *
 * - milk: how much the glass scatters light, from water-clear through hazy to milky glass that
 *   glows when the light is behind it. Some milky glass is opalescent: it scatters blue and lets
 *   warm light through, like real opal glass.
 * - clouds: little clouds suspended in the glass, from a few soft puffs to long wisps, in
 *   white or one of the marble's colours, drifting very slowly.
 * - the glass itself: its refractive index, how deep its colour runs, how strongly it magnifies,
 *   how much it splits light into colours.
 */

export type CloudColour = 'white' | 'base' | 'accent' | 'accent2';

export interface MarbleBody {
  /** Light scattering in the glass, 0 (water-clear) .. 1 (milk glass). */
  milk: number;
  /** Opal glass: scatters blue, lets warm light through. */
  opalescent: boolean;
  /** Cloud cover 0 (none) .. 1. */
  clouds: number;
  /** Cloud size: low = a few big puffs, high = many small ones. 1.6..3.6. */
  cloudScale: number;
  /** Edge softness 0.1 (crisp) .. 0.32 (hazy). */
  cloudSoft: number;
  /** Wisps: the clouds are stretched along one axis by this much (1 = round puffs). */
  cloudStretch: number;
  /** The axis the wisps run along, a unit vector. */
  cloudAxis: [number, number, number];
  cloudColour: CloudColour;
  /** How far the cloud colour leans from white toward its colour, 0..1. */
  cloudTint: number;
  /** Drift speed of the clouds. */
  drift: number;
  /** Refractive index 1.44..1.62. */
  ior: number;
  /** Magnification: the transmission thickness as a share of the radius, 0.4..0.85. */
  thickness: number;
  /** How quickly the glass colour deepens: multiplies the absorption distance, 0.55..1.6. */
  depth: number;
  /** Rainbow edges, 0.15..0.7. */
  dispersion: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function marbleBody(id: string): MarbleBody {
  const rng = new Rng(hashString(`body:${id}`));
  // Most glass is clear or a little hazy; one in five is milky.
  const m = rng.next();
  const milk = m < 0.45 ? rng.range(0, 0.06) : m < 0.8 ? rng.range(0.08, 0.3) : rng.range(0.35, 0.8);
  const opalescent = milk > 0.3 && rng.next() < 0.45;
  const c = rng.next();
  const clouds = c < 0.3 ? 0 : c < 0.75 ? rng.range(0.2, 0.5) : rng.range(0.5, 0.85);
  const cloudScale = rng.range(1.6, 3.6);
  const cloudSoft = rng.range(0.1, 0.32);
  const wispy = rng.next() < 0.4;
  const cloudStretch = wispy ? rng.range(1.8, 3.6) : rng.range(1, 1.3);
  const z = rng.range(-1, 1);
  const t = rng.next() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  const cloudAxis: [number, number, number] = [r3(s * Math.cos(t)), r3(z), r3(s * Math.sin(t))];
  const colours: CloudColour[] = ['white', 'white', 'base', 'accent', 'accent2'];
  const cloudColour = colours[rng.int(colours.length)];
  const cloudTint = rng.range(0.25, 0.85);
  const drift = rng.range(0.01, 0.07);
  const ior = rng.range(1.44, 1.62);
  const thickness = rng.range(0.4, 0.85);
  const depth = rng.range(0.55, 1.6);
  const dispersion = rng.range(0.15, 0.7);
  return {
    milk: r3(milk),
    opalescent,
    clouds: r3(clouds),
    cloudScale: r3(cloudScale),
    cloudSoft: r3(cloudSoft),
    cloudStretch: r3(cloudStretch),
    cloudAxis,
    cloudColour,
    cloudTint: r3(cloudTint),
    drift: r3(drift),
    ior: r3(ior),
    thickness: r3(thickness),
    depth: r3(depth),
    dispersion: r3(dispersion),
  };
}

/** The body in words, for an inspector: "milky opal glass, wispy accent clouds". */
export function describeBody(b: MarbleBody): string {
  const glass = b.milk < 0.07 ? 'clear glass' : b.milk < 0.32 ? 'hazy glass' : b.opalescent ? 'opal glass' : 'milk glass';
  if (!b.clouds) return glass;
  const size = b.cloudStretch > 1.6 ? 'wisps' : b.cloudScale < 2.2 ? 'big clouds' : 'little clouds';
  const cover = b.clouds > 0.5 ? 'thick ' : '';
  const colour = b.cloudColour === 'white' ? '' : `${b.cloudColour === 'base' ? 'tinted' : 'coloured'} `;
  return `${glass}, ${cover}${colour}${size}`;
}
