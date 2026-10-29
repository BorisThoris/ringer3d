import { describe, expect, it } from 'vitest';
import { collectibleId } from '../src/core/collectible';
import { ACHIEVEMENTS, LEADERBOARDS } from '../src/services/catalog';
import { createLocalServices, memoryKV } from '../src/services/localServices';
import { createPlayServices, type PlayGamesPlugin } from '../src/services/playServices';
import { createSteamServices } from '../src/services/steamServices';
import type { SteamBridge, SteamItem } from '../src/steam';
import { RINGER_ITEMS } from '../src/steamItems';

/** A Steam that records calls: achievements, stats, boards, friends and an inventory with recipes. */
function fakeSteam(appId = 123456) {
  const calls: string[] = [];
  const unlocked = new Set<string>();
  const stats = new Map<string, number>();
  const boards = new Map<string, Map<string, number>>();
  let nextItem = 1000n;
  let items: SteamItem[] = [];
  const mint = (def: number): SteamItem => ({ itemId: String(nextItem++), def, qty: 1, removed: false, props: {} });
  const bridge = {
    appId,
    me: async () => ({ steamId: '7656', name: 'Bobby', deck: true, language: 'english' }),
    unlock: async (n: string) => (calls.push(`unlock ${n}`), unlocked.add(n), true),
    achievements: async (names: string[]) => names.filter((n) => unlocked.has(n)),
    statSet: async (n: string, v: number) => (calls.push(`stat ${n}=${v}`), stats.set(n, v), true),
    statsStore: async () => (calls.push('store'), true),
    statGet: async (n: string) => stats.get(n) ?? null,
    submitScore: async (b: string, s: number) => {
      const m = boards.get(b) ?? new Map();
      boards.set(b, m);
      const changed = s > (m.get('7656') ?? -1);
      if (changed) m.set('7656', s);
      return { ok: true, score: s, changed, rank: changed ? 1 : 0, previousRank: changed ? 0 : 1 };
    },
    scores: async (b: string) => [...(boards.get(b) ?? new Map())].map(([id, score], i) => ({ steamId: id, name: 'Bobby', rank: i + 1, score })),
    friends: async () => [
      { steamId: '1', name: 'Zed', state: 'offline', appId: 0, lobby: '0', status: '' },
      { steamId: '2', name: 'Amy', state: 'online', appId: 0, lobby: '0', status: '' },
      { steamId: '3', name: 'Kit', state: 'online', appId, lobby: '99', status: 'In a lobby' },
    ],
    cloudRead: async () => null,
    cloudWrite: async () => true,
    presence: async (k: string, v: string | null) => void calls.push(`presence ${k}=${v}`),
    timelineEvent: async (t: string) => (calls.push(`moment ${t}`), true),
    timelineMode: async (m: number) => (calls.push(`mode ${m}`), true),
    showUser: async () => {},
    invAll: async () => items,
    invDrop: async () => {
      const it = mint(RINGER_ITEMS.mint!.Common!);
      items = [...items, it];
      return [it];
    },
    invExchange: async (gen: number[], destroy: string[]) => {
      // Steam's recipe check: the target itemdef's exchange (five of the tier below).
      const below = Object.entries(RINGER_ITEMS.mint!).find(([, d]) => d === gen[0] - 1)?.[1];
      const gone = items.filter((i) => destroy.includes(i.itemId));
      if (gone.length !== 5 || gone.some((i) => i.def !== below)) throw new Error('recipe not met');
      items = items.filter((i) => !destroy.includes(i.itemId));
      const it = mint(gen[0]);
      items = [...items, it];
      return [it];
    },
    invSetProps: async (sets: { itemId: string; name: string; value: number }[]) => {
      items = items.map((i) => {
        const s = sets.find((x) => x.itemId === i.itemId);
        return s ? { ...i, props: { ...i.props, [s.name]: s.value } } : i;
      });
      return [];
    },
    invBuy: async () => '1',
  } as unknown as SteamBridge;
  return { bridge, calls, stats, boards };
}

describe('Steam services', () => {
  it('map catalog ids to Steam names, unlock once, batch stats until flush', async () => {
    const s = fakeSteam();
    const svc = createSteamServices(s.bridge);
    await svc.unlock('FIRST_WIN');
    await svc.unlock('FIRST_WIN');
    expect(s.calls.filter((c) => c.startsWith('unlock'))).toEqual([`unlock ${ACHIEVEMENTS.FIRST_WIN.steam}`]);
    expect(await svc.unlocked()).toEqual(['FIRST_WIN']);
    svc.setStat('games_won', 3.7);
    svc.setStat('games_won', 4);
    expect(s.calls.some((c) => c.startsWith('stat'))).toBe(false);
    await svc.flush();
    expect(s.calls.slice(-2)).toEqual(['stat games_won=4', 'store']);
    expect((await svc.identity())!.handheld).toBe(true);
  });

  it('submit scores to the right board and read them back', async () => {
    const s = fakeSteam();
    const svc = createSteamServices(s.bridge);
    expect(await svc.submitScore('wins', 12)).toEqual({ rank: 1 });
    expect(await svc.submitScore('wins', 5)).toEqual({ rank: 1 });
    expect(s.boards.get(LEADERBOARDS.wins.steam)!.get('7656')).toBe(12);
    expect(await svc.scores('wins', 'global')).toEqual([{ playerId: '7656', name: 'Bobby', rank: 1, score: 12 }]);
  });

  it('list friends in this game first, with their lobby', async () => {
    const f = await createSteamServices(fakeSteam().bridge).friends();
    expect(f.map((x) => x.name)).toEqual(['Kit', 'Amy', 'Zed']);
    expect(f[0]).toMatchObject({ inGame: true, lobby: '99', online: true });
    expect(f[1]).toMatchObject({ inGame: false, lobby: null });
  });

  it('presence, recording moments and modes go to Steam', async () => {
    const s = fakeSteam();
    const svc = createSteamServices(s.bridge);
    svc.presence('In the menu');
    svc.moment('Won the match');
    svc.mode('playing');
    await new Promise((r) => setTimeout(r, 0));
    expect(s.calls).toEqual(expect.arrayContaining(['presence status=In the menu', 'moment Won the match', 'mode 1']));
  });

  it('items: drops become collectibles, trade-ups go through Steam\'s recipe, tallies stick', async () => {
    const s = fakeSteam();
    const items = createSteamServices(s.bridge).items!;
    for (let i = 0; i < 5; i++) await items.drop();
    expect(items.held().marbles).toHaveLength(5);
    expect(items.held().marbles[0].id).toBe(collectibleId('Common', `s${1000}`));
    expect((await items.tradeUp(items.held().marbles.slice(0, 4).map((m) => m.itemId))).ok).toBe(false);
    const r = await items.tradeUp(items.held().marbles.map((m) => m.itemId));
    expect(r.ok && r.marble.tier).toBe('Rare');
    expect(items.held().marbles).toHaveLength(1);
    await items.addTally(items.held().marbles[0].id, 7);
    expect(items.held().marbles[0].tally).toBe(7);
  });
});

describe('local services (no platform)', () => {
  it('keep achievements and personal bests on the device', async () => {
    const kv = memoryKV();
    const svc = createLocalServices(kv, () => 'Bobby');
    await svc.unlock('FIRST_BAG');
    await svc.submitScore('captures', 30);
    await svc.submitScore('captures', 10);
    const again = createLocalServices(kv, () => 'Bobby');
    expect(await again.unlocked()).toEqual(['FIRST_BAG']);
    expect(await again.scores('captures', 'global')).toEqual([{ playerId: 'local', name: 'Bobby', rank: 1, score: 30 }]);
    expect(again.items).toBeNull();
    expect(again.cloud).toBeNull();
  });
});

describe('Play services (the Android adapter, against a fake plugin)', () => {
  it('skip ids the Play Console has not given yet, and use the ones it has', async () => {
    const seen: string[] = [];
    const plugin: PlayGamesPlugin = {
      signIn: async () => ({ playerId: 'g1', displayName: 'Bobby' }),
      unlockAchievement: async ({ id }) => void seen.push(`ach ${id}`),
      unlockedAchievements: async () => ({ ids: [] }),
      submitScore: async ({ leaderboardId, score }) => void seen.push(`lb ${leaderboardId} ${score}`),
      loadScores: async () => ({ scores: [{ playerId: 'g1', displayName: 'Bobby', rank: 3, score: 9 }] }),
      loadSnapshot: async () => ({ data: '{"at":1}' }),
      saveSnapshot: async () => ({ ok: true }),
    };
    const svc = createPlayServices(plugin);
    await svc.unlock('FIRST_WIN'); // no Play id yet: skipped
    await svc.submitScore('wins', 4);
    expect(seen).toEqual([]);
    expect(await svc.cloud!.read('wallet.json')).toBe('{"at":1}');
    expect((await svc.identity())!.name).toBe('Bobby');
    expect(await svc.scores('wins', 'global')).toEqual([]); // no Play leaderboard id yet
  });
});
