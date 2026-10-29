import { collectibleFromId, type Collectible } from './core/collectible';
import { meltValue } from './core/economy';
import { progress, settings } from './game/settings';
import { wallet } from './game/wallet';
import { services, type AchievementId } from './services';

/**
 * Platform features fed by the game's own stores, through the platform-neutral services
 * (src/services): achievements, stats and leaderboards, cloud saves, presence, game-recording
 * moments, handheld defaults. The same on Steam, Google Play and the plain web build; no game
 * code has to know which one it's on.
 */

const unlock = (id: AchievementId) => void services.unlock(id).catch(() => {});

/** Called when a match ends for the local player. */
export function matchEnded(r: { won: boolean; myScore: number; otherScores: number[]; online: boolean }) {
  if (r.won) unlock('FIRST_WIN');
  if (r.won && r.otherScores.every((s) => s === 0)) unlock('CLEAN_SWEEP');
  if (r.won && r.online) unlock('ONLINE_WIN');
  services.moment(r.won ? 'Won the match' : 'Match over', `${r.myScore} to ${r.otherScores.join(', ')}`);
}

/** A trade-up happened (local or on the platform). */
export function tradedUp() {
  unlock('TRADE_UP');
}

/** What friends see next to your name, and what kind of screen this is for game recording. */
export function presence(status: string, opts: { group?: string; mode?: 'playing' | 'lobby' | 'menus' | 'loading' } = {}) {
  services.presence(status, opts.group);
  services.mode(opts.mode ?? 'menus');
}

/** Collection score for its leaderboard: what everything you hold would melt for. */
export function collectionScore(extra: Collectible[] = []): number {
  const mine = wallet
    .get()
    .owned.map((o) => collectibleFromId(o.id))
    .filter((c): c is Collectible => !!c);
  return [...mine, ...extra].reduce((a, c) => a + meltValue(c), 0);
}

// ---- Cloud saves -------------------------------------------------------------------------------
// One file per store, wrapped with the time it was saved. On launch the newer of this device's
// copy and the cloud copy wins; after that every change is written through (debounced).
const CLOUD = [
  { file: 'settings.json', store: settings },
  { file: 'progress.json', store: progress },
  { file: 'wallet.json', store: wallet },
] as const;
const AT_KEY = 'ringer3d.savedAt.v1';

function savedAt(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(AT_KEY) ?? '{}');
  } catch {
    return {};
  }
}

async function syncCloud() {
  const cloud = services.cloud;
  if (!cloud) return;
  const at = savedAt();
  for (const c of CLOUD) {
    const text = await cloud.read(c.file);
    let remoteAt = -1;
    try {
      if (text) remoteAt = (JSON.parse(text) as { at: number }).at;
      if (text && remoteAt > (at[c.file] ?? 0)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c.store as any).set((JSON.parse(text) as { data: object }).data);
        at[c.file] = remoteAt;
        continue;
      }
    } catch {
      /* a damaged cloud file loses to the local copy */
    }
    // The local copy wins (or the cloud has none yet): upload it now, not on the next change.
    if (remoteAt < (at[c.file] ?? 0) || !text || remoteAt < 0) {
      at[c.file] = at[c.file] ?? Date.now();
      void cloud.write(c.file, JSON.stringify({ at: at[c.file], data: c.store.get() }));
    }
  }
  localStorage.setItem(AT_KEY, JSON.stringify(at));
  for (const c of CLOUD) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    c.store.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const now = Date.now();
        const a = savedAt();
        a[c.file] = now;
        localStorage.setItem(AT_KEY, JSON.stringify(a));
        void cloud.write(c.file, JSON.stringify({ at: now, data: c.store.get() }));
      }, 2500);
    });
  }
}

// ---- Achievements, stats and leaderboards from the stores ---------------------------------------
function watchStores() {
  const flush = () => void services.flush().catch(() => {});
  const board = (id: 'wins' | 'captures' | 'collection', score: number) => {
    if (score > 0) void services.submitScore(id, score).catch(() => {});
  };
  let last = { won: -1, captured: -1 };
  const onProgress = () => {
    const p = progress.get();
    services.setStat('games_played', p.stats.played);
    services.setStat('games_won', p.stats.won);
    services.setStat('marbles_captured', p.stats.captured);
    if (p.cleared.length > 0) unlock('TOWER_CLEARED');
    flush();
    // Leaderboards only when the number moved (each submit is a network call).
    if (p.stats.won !== last.won) board('wins', p.stats.won);
    if (p.stats.captured !== last.captured) board('captures', p.stats.captured);
    last = { won: p.stats.won, captured: p.stats.captured };
  };
  let lastCollection = -1;
  const onWallet = () => {
    const w = wallet.get();
    const held = services.items?.held().marbles ?? [];
    const all = [...w.owned.map((o) => collectibleFromId(o.id)).filter((c): c is Collectible => !!c), ...held];
    services.setStat('bags_opened', w.bagsOpened);
    services.setStat('marbles_owned', all.length);
    if (w.bagsOpened > 0) unlock('FIRST_BAG');
    if (all.some((c) => c.tier === 'Legendary')) unlock('LEGENDARY_PULL');
    if (all.some((c) => c.tier === 'Mythic')) unlock('MYTHIC_PULL');
    if (all.some((c) => c.shiny)) unlock('SHINY_PULL');
    if (all.some((c) => c.wear === 'Mint')) unlock('MINT_PULL');
    if (all.length >= 25) unlock('COLLECTOR_25');
    if (w.streak >= 7) unlock('DAILY_7');
    if ((w.sets ?? []).length > 0) unlock('BOOK_SET');
    flush();
    const score = collectionScore(held);
    if (score !== lastCollection) board('collection', score);
    lastCollection = score;
  };
  progress.subscribe(onProgress);
  wallet.subscribe(onWallet);
  services.items?.subscribe(onWallet);
  onProgress();
  onWallet();
}

/** Start the platform integration once, at boot. */
export async function initServices() {
  try {
    const me = await services.identity();
    const st = settings.get();
    // First launch on a platform: its name, and lighter graphics on a handheld.
    if (me && services.platform !== 'local' && /^Player\d+$/.test(st.playerName)) settings.set({ playerName: me.name.slice(0, 20) });
    if (me?.handheld && !localStorage.getItem('ringer3d.deckDefaults')) {
      settings.set({ quality: 'medium' });
      localStorage.setItem('ringer3d.deckDefaults', '1');
    }
    await syncCloud();
    // Platform-held marbles, then any playtime drop that's due.
    if (services.items) await services.items.sync().then(() => services.items!.drop());
    watchStores();
    presence('In the menu');
  } catch (e) {
    console.warn('Platform services failed', e);
  }
}
