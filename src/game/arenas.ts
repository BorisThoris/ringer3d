import { DEFAULT_SURFACE, type SurfaceParams } from '../core/types';

export type ArenaId = 'schoolyard' | 'zen' | 'rooftop' | 'glacier' | 'caldera';

export interface Arena {
  id: ArenaId;
  name: string;
  tagline: string;
  /** Gameplay feel of the ground. Same for every player in the match. */
  surface: SurfaceParams;
  surfaceLabel: string;
  sky: { top: string; bottom: string };
  fog: { color: string; near: number; far: number };
  sun: { color: string; intensity: number; dir: [number, number, number] };
  ambient: { sky: string; ground: string; intensity: number };
  ground: { base: string; detail: string; pattern: 'asphalt' | 'sand' | 'tiles' | 'ice' | 'basalt' };
  ring: { color: string; glow: number; style: 'chalk' | 'rope' | 'neon' | 'etched' | 'lava' };
  props: 'playground' | 'garden' | 'city' | 'ice' | 'volcano';
  exposure: number;
}

export const ARENAS: Record<ArenaId, Arena> = {
  schoolyard: {
    id: 'schoolyard',
    name: 'Schoolyard',
    tagline: 'Where every legend learned to knuckle down.',
    surface: { ...DEFAULT_SURFACE },
    surfaceLabel: 'Asphalt · balanced',
    sky: { top: '#5aa9ff', bottom: '#dff1ff' },
    fog: { color: '#cfe7ff', near: 30, far: 90 },
    sun: { color: '#fff4e0', intensity: 3.2, dir: [6, 12, 4] },
    ambient: { sky: '#bfe0ff', ground: '#6b6256', intensity: 1.1 },
    ground: { base: '#4a4d52', detail: '#5d6066', pattern: 'asphalt' },
    ring: { color: '#f5f5f0', glow: 0, style: 'chalk' },
    props: 'playground',
    exposure: 1.0,
  },
  zen: {
    id: 'zen',
    name: 'Zen Garden',
    tagline: 'Raked sand. Patient hands. Slow rolls.',
    surface: { ...DEFAULT_SURFACE, rollDecel: 14, friction: 0.75 },
    surfaceLabel: 'Packed sand · grippy, slow',
    sky: { top: '#ff9a6b', bottom: '#ffe1c2' },
    fog: { color: '#ffd8b8', near: 25, far: 80 },
    sun: { color: '#ffc58a', intensity: 2.6, dir: [-8, 6, 3] },
    ambient: { sky: '#ffd0a8', ground: '#7a6a55', intensity: 1.0 },
    ground: { base: '#d9c7a3', detail: '#c6b08a', pattern: 'sand' },
    ring: { color: '#5b3d22', glow: 0, style: 'rope' },
    props: 'garden',
    exposure: 1.0,
  },
  rooftop: {
    id: 'rooftop',
    name: 'Neon Rooftop',
    tagline: 'Midnight money matches above the city.',
    surface: { ...DEFAULT_SURFACE, rollDecel: 9, friction: 0.5 },
    surfaceLabel: 'Polished tile · quick',
    sky: { top: '#06030f', bottom: '#2a0f46' },
    fog: { color: '#1a0b2e', near: 20, far: 70 },
    sun: { color: '#b48cff', intensity: 1.2, dir: [3, 10, -6] },
    ambient: { sky: '#5a3c9a', ground: '#120a20', intensity: 0.7 },
    ground: { base: '#1c1a24', detail: '#2a2735', pattern: 'tiles' },
    ring: { color: '#00f0ff', glow: 2.5, style: 'neon' },
    props: 'city',
    exposure: 1.15,
  },
  glacier: {
    id: 'glacier',
    name: 'Glacier Hall',
    tagline: 'Nothing stops on ice. Not even regret.',
    surface: { ...DEFAULT_SURFACE, rollDecel: 6.5, friction: 0.3, linearDamping: 0.05 },
    surfaceLabel: 'Ice · very slick',
    sky: { top: '#3f7fc8', bottom: '#cfe6f7' },
    fog: { color: '#b9d8ee', near: 30, far: 95 },
    sun: { color: '#eaf6ff', intensity: 2.0, dir: [4, 14, 8] },
    ambient: { sky: '#bfe0ff', ground: '#3d6b91', intensity: 0.85 },
    ground: { base: '#6fa6cc', detail: '#a8d2ec', pattern: 'ice' },
    ring: { color: '#e9f8ff', glow: 0.9, style: 'etched' },
    props: 'ice',
    exposure: 0.85,
  },
  caldera: {
    id: 'caldera',
    name: 'Caldera',
    tagline: 'The Black Taw waits where the earth bleeds.',
    surface: { ...DEFAULT_SURFACE, rollDecel: 11.5, marbleRestitution: 0.95 },
    surfaceLabel: 'Basalt · lively bounces',
    sky: { top: '#120404', bottom: '#5a1406' },
    fog: { color: '#2b0905', near: 18, far: 60 },
    sun: { color: '#ff6a2b', intensity: 1.8, dir: [-4, 9, -5] },
    ambient: { sky: '#7a2410', ground: '#1a0603', intensity: 0.8 },
    ground: { base: '#22201f', detail: '#3a3230', pattern: 'basalt' },
    ring: { color: '#ff5a1a', glow: 3, style: 'lava' },
    props: 'volcano',
    exposure: 1.1,
  },
};

export const ARENA_LIST: Arena[] = Object.values(ARENAS);
