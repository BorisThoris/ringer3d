import { Capacitor, registerPlugin } from '@capacitor/core';
import { settings } from '../game/settings';
import { steam } from '../steam';
import { createLocalServices, type KeyValue } from './localServices';
import { createPlayServices, type PlayGamesPlugin } from './playServices';
import { createSteamServices } from './steamServices';
import type { PlatformServices } from './types';

export * from './catalog';
export type * from './types';

const browserKV: KeyValue = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

/**
 * The platform this build runs on: Steam when the shell provides window.steam, Google Play
 * Games when the Android build has its PlayGames plugin, otherwise this device only.
 */
function pick(): PlatformServices {
  if (steam) return createSteamServices(steam);
  if (Capacitor.isPluginAvailable('PlayGames')) return createPlayServices(registerPlugin<PlayGamesPlugin>('PlayGames'));
  return createLocalServices(browserKV, () => settings.get().playerName);
}

export const services: PlatformServices = pick();
