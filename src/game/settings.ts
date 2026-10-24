import type { Quality } from '../render/marbleMesh';
import { createStore } from './store';

export type GuideMode = 'full' | 'short' | 'off';

export interface Settings {
  playerName: string;
  marble: string;
  quality: Quality;
  sfx: number;
  music: number;
  guide: GuideMode;
  haptics: boolean;
  aimSensitivity: number;
  lobbyUrl: string;
  /** 'p2p' needs no server (public relays for matchmaking); 'server' uses our lobby server. */
  netMode: 'p2p' | 'server';
}

export interface Progress {
  unlocked: string[];
  /** Fighters who have finished the tower. */
  cleared: string[];
  /** Furthest stage reached per fighter. */
  best: Record<string, number>;
  /** Saved in-progress tower run. */
  run: { fighter: string; stage: number } | null;
  stats: { played: number; won: number; captured: number };
}

const SETTINGS_KEY = 'ringer3d.settings.v1';
const PROGRESS_KEY = 'ringer3d.progress.v1';

function detectQuality(): Quality {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mobile) return cores >= 8 ? 'medium' : 'low';
  return cores >= 8 ? 'high' : 'medium';
}

function defaultLobby(): string {
  const env = import.meta.env.VITE_LOBBY_URL as string | undefined;
  if (env) return env;
  const { protocol, hostname, host, port } = location;
  const embedded = protocol === 'capacitor:' || protocol === 'tauri:' || hostname === 'tauri.localhost' || (hostname === 'localhost' && !port && protocol === 'https:');
  if (embedded || !(protocol === 'http:' || protocol === 'https:')) return 'ws://localhost:8787';
  const ws = protocol === 'https:' ? 'wss' : 'ws';
  // Vite dev server → lobby on :8787. Otherwise the lobby server is also serving this page.
  if (port === '5173' || port === '4173') return `${ws}://${hostname}:8787`;
  return `${ws}://${host}`;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return fallback;
}

function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export const settings = createStore<Settings>(
  load<Settings>(SETTINGS_KEY, {
    playerName: `Player${Math.floor(Math.random() * 900 + 100)}`,
    marble: 'ember',
    quality: detectQuality(),
    sfx: 0.8,
    music: 0.35,
    guide: 'full',
    haptics: true,
    aimSensitivity: 1,
    lobbyUrl: defaultLobby(),
    netMode: 'p2p',
  }),
);
settings.subscribe(() => save(SETTINGS_KEY, settings.get()));

export const progress = createStore<Progress>(
  load<Progress>(PROGRESS_KEY, {
    unlocked: ['ember', 'tide', 'pip', 'jade'],
    cleared: [],
    best: {},
    run: null,
    stats: { played: 0, won: 0, captured: 0 },
  }),
);
progress.subscribe(() => save(PROGRESS_KEY, progress.get()));

export function guideLength(mode: GuideMode): number {
  return mode === 'full' ? 9 : mode === 'short' ? 2.2 : 0;
}
