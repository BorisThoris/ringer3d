import type { SteamBridge } from '../steam';
import { createSteamItems } from '../steamItems';
import { ACHIEVEMENTS, LEADERBOARDS, STATS, type AchievementId, type BoardId, type StatId } from './catalog';
import type { PlatformServices } from './types';

/**
 * Steam as PlatformServices, over any SteamBridge: the shell's window.steam, or a headless one
 * from steam/node-bridge.cjs. Achievements and stats (ISteamUserStats), leaderboards, Steam
 * Cloud, rich presence, friends, the game-recording timeline, and the inventory as items.
 */
export function createSteamServices(bridge: SteamBridge): PlatformServices {
  const sent = new Set<AchievementId>();
  const pendingStats = new Map<StatId, number>();
  const TIMELINE_MODE = { playing: 1, lobby: 2, menus: 3, loading: 4 } as const;
  const quiet = <T>(p: Promise<T>) => void p.catch(() => {});

  return {
    platform: 'steam',
    async identity() {
      const me = await bridge.me();
      return { id: me.steamId, name: me.name, handheld: me.deck, language: me.language };
    },
    async unlock(id) {
      if (sent.has(id)) return;
      sent.add(id);
      await bridge.unlock(ACHIEVEMENTS[id].steam);
    },
    async unlocked() {
      const ids = Object.keys(ACHIEVEMENTS) as AchievementId[];
      const have = new Set(await bridge.achievements(ids.map((i) => ACHIEVEMENTS[i].steam)));
      return ids.filter((i) => have.has(ACHIEVEMENTS[i].steam));
    },
    setStat(id, value) {
      pendingStats.set(id, Math.floor(value));
    },
    async flush() {
      const batch = [...pendingStats];
      pendingStats.clear();
      for (const [id, v] of batch) await bridge.statSet(STATS[id].steam, v);
      if (batch.length) await bridge.statsStore();
    },
    async submitScore(board: BoardId, score: number) {
      const r = await bridge.submitScore(LEADERBOARDS[board].steam, Math.floor(score), true);
      return { rank: r.rank > 0 ? r.rank : r.previousRank > 0 ? r.previousRank : null };
    },
    async scores(board, scope, count = 10) {
      const name = LEADERBOARDS[board].steam;
      const rows = scope === 'around' ? await bridge.scores(name, 'around', -Math.floor(count / 2), Math.ceil(count / 2)) : await bridge.scores(name, scope, 1, count);
      return rows.map((r) => ({ playerId: r.steamId, name: r.name, rank: r.rank, score: r.score }));
    },
    cloud: {
      read: (file) => bridge.cloudRead(file),
      write: (file, text) => bridge.cloudWrite(file, text),
    },
    presence(status, group) {
      quiet(bridge.presence('status', status));
      // steam_display needs a localisation token on the partner site; #Status uses %status%.
      quiet(bridge.presence('steam_display', '#Status'));
      quiet(bridge.presence('steam_player_group', group ?? null));
    },
    async friends() {
      const list = await bridge.friends();
      return list
        .map((f) => ({
          id: f.steamId,
          name: f.name,
          online: f.state !== 'offline',
          inGame: f.appId === bridge.appId,
          lobby: f.appId === bridge.appId && f.lobby !== '0' ? f.lobby : null,
          status: f.status,
        }))
        .sort((a, b) => Number(b.inGame) - Number(a.inGame) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    },
    showProfile(id) {
      quiet(bridge.showUser(id, 'steamid'));
    },
    moment(title, desc) {
      quiet(bridge.timelineEvent(title, desc ?? ''));
    },
    mode(m) {
      quiet(bridge.timelineMode(TIMELINE_MODE[m]));
    },
    items: createSteamItems(bridge),
  };
}
