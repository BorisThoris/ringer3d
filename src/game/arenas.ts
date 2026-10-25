import { DEFAULT_SURFACE, type SurfaceParams } from '../core/types';

/**
 * The five fields. Each is a real place built from CC0 photographic assets (see
 * public/assets/CREDITS.md): the ground is a scanned PBR material, the backdrop and
 * reflections come from an HDRI shot at a matching location, props are scanned models.
 * The surface changes the physics, the sound and the visual effects of every roll.
 */
export type ArenaId = 'desk' | 'culdesac' | 'grass' | 'sand' | 'ice';

/** How the ground behaves and sounds; drives audio and visual surface effects. */
export type SurfaceKind = 'wood' | 'concrete' | 'grass' | 'sand' | 'ice';

export interface Arena {
  id: ArenaId;
  name: string;
  tagline: string;
  /** Gameplay feel of the ground. Same for every player in the match. */
  surface: SurfaceParams;
  surfaceKind: SurfaceKind;
  surfaceLabel: string;
  /** Asset folder under public/assets/. */
  assets: string;
  /** Fallback sky when the HDRI has not loaded (or failed). */
  sky: { top: string; bottom: string };
  fog: { color: string; near: number; far: number };
  /** Matches the sun (or window) in the HDRI, so shadows agree with the backdrop. */
  sun: { color: string; intensity: number; dir: [number, number, number] };
  ambient: { sky: string; ground: string; intensity: number };
  /** Fallback ground colour, shown until the PBR textures arrive. */
  groundColor: string;
  ring: { color: string; style: 'chalk' | 'string' | 'drawn' | 'etched' };
  exposure: number;
  /** HDRI brightness as reflections / as backdrop. */
  envIntensity: number;
  backgroundIntensity: number;
}

export const ARENAS: Record<ArenaId, Arena> = {
  desk: {
    id: 'desk',
    name: 'The Desk',
    tagline: 'Homework can wait. Varnished oak, lamp on, ring of string.',
    surface: { ...DEFAULT_SURFACE, rollDecel: 8, friction: 0.5, linearDamping: 0.06, marbleRestitution: 0.94 },
    surfaceKind: 'wood',
    surfaceLabel: 'Varnished wood · quick',
    assets: 'desk',
    sky: { top: '#d9c3a3', bottom: '#8a6a4a' },
    fog: { color: '#cdb796', near: 60, far: 160 },
    // Window light, measured from the HDRI (raised to 30° so shadows stay readable).
    sun: { color: '#ffe6c4', intensity: 2.2, dir: [7.0, 6.0, 7.7] },
    ambient: { sky: '#fff0d8', ground: '#5a3c22', intensity: 0.25 },
    groundColor: '#5a3420',
    ring: { color: '#f2ece0', style: 'string' },
    exposure: 1.0,
    envIntensity: 1,
    backgroundIntensity: 1,
  },
  culdesac: {
    id: 'culdesac',
    name: 'The Cul-de-sac',
    tagline: 'Chalk on concrete, the gutter one bad flick away.',
    surface: { ...DEFAULT_SURFACE },
    surfaceKind: 'concrete',
    surfaceLabel: 'Concrete · balanced',
    assets: 'culdesac',
    sky: { top: '#5aa9ff', bottom: '#dff1ff' },
    fog: { color: '#cfe7ff', near: 80, far: 220 },
    sun: { color: '#fff3e2', intensity: 2.0, dir: [8.4, 6.0, 6.2] },
    ambient: { sky: '#bfe0ff', ground: '#6b6256', intensity: 0.25 },
    groundColor: '#8d8a84',
    ring: { color: '#f7f5ef', style: 'chalk' },
    exposure: 1.0,
    envIntensity: 1,
    backgroundIntensity: 1,
  },
  grass: {
    id: 'grass',
    name: 'The Back Lawn',
    tagline: 'Fresh-cut grass grabs every marble. Flick hard.',
    surface: { ...DEFAULT_SURFACE, rollDecel: 21, friction: 0.85, linearDamping: 0.25, angularDamping: 0.6, marbleRestitution: 0.9 },
    surfaceKind: 'grass',
    surfaceLabel: 'Lawn · grippy, slow',
    assets: 'grass',
    sky: { top: '#5aa9ff', bottom: '#e6f4ff' },
    fog: { color: '#d6ebff', near: 80, far: 220 },
    sun: { color: '#fff4e0', intensity: 3.2, dir: [4.2, 10.8, 3.1] },
    ambient: { sky: '#cfe6ff', ground: '#3f5a26', intensity: 0.25 },
    groundColor: '#4d6b2a',
    ring: { color: '#f4f1e8', style: 'string' },
    exposure: 1.0,
    envIntensity: 1,
    backgroundIntensity: 1,
  },
  sand: {
    id: 'sand',
    name: 'The Beach',
    tagline: 'Ring drawn with a finger. Sand eats speed and keeps tracks.',
    surface: { ...DEFAULT_SURFACE, rollDecel: 27, friction: 0.95, linearDamping: 0.32, angularDamping: 0.7, marbleRestitution: 0.88 },
    surfaceKind: 'sand',
    surfaceLabel: 'Sand · heavy, short rolls',
    assets: 'sand',
    sky: { top: '#4f9be8', bottom: '#e9f4ff' },
    fog: { color: '#e3eef7', near: 80, far: 240 },
    sun: { color: '#fff1d6', intensity: 3.4, dir: [6.4, 6.3, 7.9] },
    ambient: { sky: '#cfe6ff', ground: '#a8916a', intensity: 0.25 },
    groundColor: '#cdbb98',
    ring: { color: '#3d2f1f', style: 'drawn' },
    exposure: 1.0,
    envIntensity: 1,
    backgroundIntensity: 1,
  },
  ice: {
    id: 'ice',
    name: 'The Frozen Lake',
    tagline: 'Black ice, a ring scratched with a skate. Nothing stops.',
    surface: { ...DEFAULT_SURFACE, rollDecel: 4.5, friction: 0.22, linearDamping: 0.035, angularDamping: 0.15, marbleRestitution: 0.95 },
    surfaceKind: 'ice',
    surfaceLabel: 'Ice · very slick',
    assets: 'ice',
    sky: { top: '#7f9fc4', bottom: '#dfe8f2' },
    fog: { color: '#dde6ef', near: 80, far: 220 },
    // Overcast: the HDRI does the lighting, the sun only softens in a gentle shadow.
    sun: { color: '#eef4ff', intensity: 0.9, dir: [6.1, 9.2, 4.7] },
    ambient: { sky: '#d6e4f5', ground: '#5d7088', intensity: 0.25 },
    groundColor: '#55697a',
    ring: { color: '#eaf6ff', style: 'etched' },
    exposure: 1.0,
    envIntensity: 1,
    backgroundIntensity: 1,
  },
};

export const ARENA_LIST: Arena[] = Object.values(ARENAS);

/** Field ids from older builds (rooms, saved progress) mapped onto today's fields. */
const LEGACY: Record<string, ArenaId> = { schoolyard: 'culdesac', zen: 'sand', rooftop: 'desk', glacier: 'ice', caldera: 'grass' };

/** Any id, current or legacy, to a field that exists. */
export function arenaId(id: string | undefined | null): ArenaId {
  if (id && id in ARENAS) return id as ArenaId;
  return (id && LEGACY[id]) || 'culdesac';
}
