import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACHIEVEMENTS, LEADERBOARDS, type AchievementId, type BoardId } from '../services/catalog';
import { createSteamServices } from '../services/steamServices';
import type { SteamBridge } from '../steam';

/**
 * `ringer-headless steam <command>`: the game's platform services on a live Steam session, from
 * plain Node with no window (steam/node-bridge.cjs). Steam must be running and logged in;
 * steam/ needs its npm install (steamworks.js, koffi). App ID: --app, STEAM_APP_ID or
 * steam/steam_appid.txt (480 for development).
 *
 *   status                                 who you are, and which achievements you have
 *   unlock <ACHIEVEMENT>                   unlock one (catalog id)
 *   leaderboard <board> [global|friends|around] [--count N] [--raw]   --raw: a Steam board name
 *   submit <board> <score> [--raw]
 *   friends                                friends, the ones in this game first
 *   items | drop                           Steam-held marbles; ask for a playtime drop
 *   moment <title> [desc]                  a game-recording marker
 */
export async function steamCommand(rest: string[], opts: Record<string, string | boolean>, out: (v: unknown) => void): Promise<number> {
  const here = dirname(fileURLToPath(import.meta.url));
  const steamDir = (process.env.RINGER_STEAM_DIR as string | undefined) ?? resolve(here, '..', 'steam');
  const req = createRequire(resolve(steamDir, 'package.json'));
  const { connectSteam } = req('./node-bridge.cjs') as { connectSteam: (appId?: number) => (SteamBridge & { close(): void }) | null };
  const bridge = connectSteam(opts.app ? Number(opts.app) : undefined);
  if (!bridge) {
    process.stderr.write('Steam is not running (or not logged in).\n');
    return 3;
  }
  const svc = createSteamServices(bridge);
  const [cmd, a, b] = rest;
  try {
    if (cmd === 'status') out({ appId: bridge.appId, me: await svc.identity(), achievements: await svc.unlocked() });
    else if (cmd === 'unlock') {
      if (!(a in ACHIEVEMENTS)) throw new Error(`unknown achievement; one of ${Object.keys(ACHIEVEMENTS).join(', ')}`);
      await svc.unlock(a as AchievementId);
      out({ unlocked: a });
    } else if (cmd === 'leaderboard') {
      const scope = (b ?? 'global') as 'global' | 'friends' | 'around';
      const count = Number(opts.count ?? 10);
      if (opts.raw) out(await bridge.scores(a, scope, scope === 'around' ? -Math.floor(count / 2) : 1, scope === 'around' ? Math.ceil(count / 2) : count));
      else if (a in LEADERBOARDS) out(await svc.scores(a as BoardId, scope, count));
      else throw new Error(`unknown board; one of ${Object.keys(LEADERBOARDS).join(', ')} (or --raw)`);
    } else if (cmd === 'submit') {
      if (opts.raw) out(await bridge.submitScore(a, Number(b), true));
      else if (a in LEADERBOARDS) out(await svc.submitScore(a as BoardId, Number(b)));
      else throw new Error('unknown board (or --raw)');
    } else if (cmd === 'friends') for (const f of await svc.friends()) out(f);
    else if (cmd === 'items') {
      await svc.items!.sync();
      for (const m of svc.items!.held().marbles) out({ itemId: m.itemId, id: m.id, name: m.marble.name, tier: m.tier, wear: m.wear, float: m.float, pattern: m.pattern, shiny: m.shiny, tally: m.tally });
    } else if (cmd === 'drop') out({ dropped: (await svc.items!.drop()).map((m) => ({ itemId: m.itemId, name: m.marble.name, tier: m.tier, float: m.float })) });
    else if (cmd === 'moment') {
      svc.moment(a ?? 'Marker', b);
      await new Promise((r) => setTimeout(r, 300));
      out({ moment: a ?? 'Marker' });
    } else {
      process.stderr.write('usage: ringer-headless steam status|unlock|leaderboard|submit|friends|items|drop|moment\n');
      return 2;
    }
    return 0;
  } catch (e) {
    process.stderr.write(`steam ${cmd}: ${(e as Error).message}\n`);
    return 1;
  } finally {
    bridge.close();
  }
}
