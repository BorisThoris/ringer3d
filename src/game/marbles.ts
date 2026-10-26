/** Visual identity of a marble. Purely cosmetic: every marble plays identically (fairness). */
export type MarbleCore = 'catseye' | 'swirl' | 'solid' | 'galaxy' | 'steelie' | 'onyx' | 'opal' | 'neon' | 'onionskin' | 'clearie';

export interface MarbleLook {
  id: string;
  name: string;
  core: MarbleCore;
  /** Glass/body colour. */
  base: string;
  /** Inner feature colours. */
  accent: string;
  accent2: string;
  /** 0 = opaque, 1 = clear glass. */
  clarity: number;
  /** Emissive glow for inner features (0..1). */
  glow: number;
  /** A vivid colour that stands for this marble in the interface and the in-match cues. */
  ui?: string;
}

/** The interface colour for a marble: its own, or the brighter of its feature colours. */
export function uiColor(look: MarbleLook | undefined): string {
  return look?.ui ?? look?.accent ?? '#2f6bff';
}

export const MARBLES: Record<string, MarbleLook> = {
  ember: { id: 'ember', name: 'Ember', core: 'catseye', base: '#ffe3cf', accent: '#ff4d1f', accent2: '#ffb000', clarity: 0.9, glow: 0.25, ui: '#ff5a2a' },
  tide: { id: 'tide', name: 'Tide', core: 'swirl', base: '#cfefff', accent: '#1a7cff', accent2: '#e9fbff', clarity: 0.85, glow: 0.1, ui: '#1a7cff' },
  pip: { id: 'pip', name: 'Pip', core: 'solid', base: '#c98a4b', accent: '#7a4a22', accent2: '#e8b27a', clarity: 0, glow: 0, ui: '#f08a2c' },
  jade: { id: 'jade', name: 'Jade', core: 'swirl', base: '#b8f5d2', accent: '#0f9d58', accent2: '#e0ffe9', clarity: 0.7, glow: 0.05, ui: '#14c06c' },
  volt: { id: 'volt', name: 'Volt', core: 'neon', base: '#1b1530', accent: '#00f0ff', accent2: '#ff2bd6', clarity: 0.55, glow: 1, ui: '#00d8ff' },
  rime: { id: 'rime', name: 'Rime', core: 'opal', base: '#f2f8ff', accent: '#9fd8ff', accent2: '#f7c6ff', clarity: 0.6, glow: 0.15, ui: '#7cc4ff' },
  ironside: { id: 'ironside', name: 'Ironside', core: 'steelie', base: '#c9ced6', accent: '#8a929e', accent2: '#ffffff', clarity: 0, glow: 0, ui: '#8c9bb4' },
  nova: { id: 'nova', name: 'Nova', core: 'galaxy', base: '#120a2e', accent: '#8b5cff', accent2: '#ffd36b', clarity: 0.4, glow: 0.8, ui: '#8b5cff' },
  obsidian: { id: 'obsidian', name: 'Obsidian', core: 'onyx', base: '#0b0b0f', accent: '#ff3d00', accent2: '#ffae00', clarity: 0.15, glow: 1, ui: '#ff3d00' },
  /** The 13 targets ("mibs"): classic clear glass with a coloured vein. */
  mib: { id: 'mib', name: 'Mib', core: 'catseye', base: '#f4f7fb', accent: '#4dd2ff', accent2: '#ffffff', clarity: 0.92, glow: 0, ui: '#4dd2ff' },
};

/**
 * The 13 targets: a bag of strongly coloured glass, spread round the colour wheel so no two
 * neighbours match and none reads as a clear bubble against the ground. Tinted glass (clarity
 * ~0.6) shows its own colour instead of whatever lies behind it.
 */
export const MIB_LOOKS: MarbleLook[] = [
  { id: 'mib-a', name: 'Mib', core: 'catseye', base: '#1f6fe0', accent: '#ffe14d', accent2: '#ffffff', clarity: 0.34, glow: 0.25 },
  { id: 'mib-b', name: 'Mib', core: 'catseye', base: '#e8401a', accent: '#ffffff', accent2: '#ffd23f', clarity: 0.32, glow: 0.25 },
  { id: 'mib-c', name: 'Mib', core: 'catseye', base: '#0fa356', accent: '#ffffff', accent2: '#c2ff7a', clarity: 0.34, glow: 0.25 },
  { id: 'mib-d', name: 'Mib', core: 'swirl', base: '#7b3ff0', accent: '#ffd23f', accent2: '#ff7ad9', clarity: 0.34, glow: 0.25 },
  { id: 'mib-e', name: 'Mib', core: 'swirl', base: '#f0b400', accent: '#c41f2f', accent2: '#ffffff', clarity: 0.3, glow: 0.25 },
  { id: 'mib-f', name: 'Mib', core: 'catseye', base: '#009fb3', accent: '#ff3d7f', accent2: '#ffffff', clarity: 0.34, glow: 0.25 },
  { id: 'mib-g', name: 'Mib', core: 'swirl', base: '#e0215f', accent: '#ffffff', accent2: '#ffe14d', clarity: 0.34, glow: 0.25 },
  { id: 'mib-h', name: 'Mib', core: 'onionskin', base: '#f06a00', accent: '#1f5fbf', accent2: '#ffffff', clarity: 0.3, glow: 0.2 },
];
