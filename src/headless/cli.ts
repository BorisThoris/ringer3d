import { createInterface } from 'node:readline';
import { BOT_PROFILES } from '../ai/profiles';
import type { Shot } from '../core/types';
import { ARENA_LIST, type ArenaId } from '../game/arenas';
import { generateMap, type Difficulty } from '../game/maps';
import { PROP_TRAITS } from '../core/props';
import { generateMarble, HUE_NAMES, MARBLE_WORDS, marbleFixtures, RARITY } from '../core/marbleGen';
import { mintCollectible } from '../core/collectible';
import type { Tier } from '../core/marbleGen';
import { botAgent, playMatch, randomAgent, type Agent } from './agents';
import { HeadlessGame, type GameSpec } from './game';
import { stdioAgent } from './node';

/**
 * ringer-headless: Ringer 3D with no screen.
 *
 *   play  [options] <agent> <agent> [...]   play matches between agents, one JSON line per game
 *   serve                                   an environment on stdin/stdout for an outside driver
 *   map   [options]                         print a generated map as JSON
 *   marble <seed> [...]                     print generated marbles (by look seed) as JSON
 *   collectible <uid> [...] [--tier Rare]   print collectible marbles (float, wear, pattern, Shiny) by instance id
 *   export [--maps N]                       maps, marble rules and fixtures for other ports (Roblox)
 *
 * Agents: bot:<rookie|novice|casual|regular|skilled|expert|master|legend>, random,
 *         stdio:<command> (any program speaking the protocol in node.ts).
 * Options: --arena desk|culdesac|grass|sand|ice|gravel|minigolf  --difficulty easy|medium|hard
 *          --seed N  --games N  --target N  --open (no obstacles)
 */

function parse(argv: string[]) {
  const opts: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--') && key !== 'open') opts[key] = argv[++i];
      else opts[key] = true;
    } else rest.push(a);
  }
  return { opts, rest };
}

function agentFrom(spec: string, seed: number): Agent {
  if (spec === 'random') return randomAgent(seed);
  if (spec.startsWith('bot:')) return botAgent(spec.slice(4), seed);
  if (spec.startsWith('stdio:')) return stdioAgent(spec.slice(6));
  throw new Error(`unknown agent "${spec}"`);
}

function specFrom(opts: Record<string, string | boolean>): Omit<GameSpec, 'players'> {
  const arena = (opts.arena as ArenaId) ?? 'desk';
  if (!ARENA_LIST.some((a) => a.id === arena)) throw new Error(`unknown arena "${arena}"`);
  return {
    arena,
    difficulty: ((opts.difficulty as Difficulty) ?? 'medium'),
    seed: Number(opts.seed ?? 1),
    targetScore: opts.target ? Number(opts.target) : undefined,
    openField: opts.open === true,
  };
}

const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');

async function play(opts: Record<string, string | boolean>, names: string[]) {
  if (names.length < 2) throw new Error('play needs at least two agents');
  const base = specFrom(opts);
  const games = Number(opts.games ?? 1);
  const wins = names.map(() => 0);
  for (let g = 0; g < games; g++) {
    const seed = (base.seed ?? 1) + g;
    // Swap seats every game so neither side always lags first.
    const order = names.map((_, i) => (i + g) % names.length);
    const agents = order.map((i) => agentFrom(names[i], seed * 31 + i));
    const r = await playMatch({ ...base, seed }, agents);
    for (const w of r.winners) wins[order[w]] += 1 / r.winners.length;
    out({ game: g, seed, map: r.map, seats: order.map((i) => names[i]), scores: r.scores, winners: r.winners.map((w) => names[order[w]]), shots: r.shots });
    for (const a of agents) await a.close?.();
  }
  out({ summary: true, games, wins: Object.fromEntries(names.map((n, i) => [n, wins[i]])) });
}

/**
 * The environment loop, one JSON object per line each way:
 *   {"op":"reset","spec":{arena,difficulty,seed},"seat":0,"opponents":["bot:casual"]}
 *     -> {"obs":...}                            (opponents have already moved if they start)
 *   {"op":"step","shot":{placeAngle,aimAngle,power,spin}}
 *     -> {"obs":...,"reward":r,"done":bool,"scores":[...],"events":[...]}
 *        reward = your captures minus everyone else's since your last step
 *   {"op":"close"}
 */
async function serve() {
  let game: HeadlessGame | null = null;
  let seat = 0;
  let opponents: Agent[] = [];
  const runOpponents = async () => {
    const events: unknown[] = [];
    while (game && !game.done && game.current !== seat) {
      const who = game.current < seat ? game.current : game.current - 1;
      const r = game.act(await opponents[who].act(game.observe()));
      events.push(...r.events);
    }
    return events;
  };
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    let msg: { op: string; spec?: GameSpec; seat?: number; opponents?: string[]; shot?: Shot };
    try {
      msg = JSON.parse(line);
    } catch {
      out({ error: 'not JSON' });
      continue;
    }
    try {
      if (msg.op === 'reset') {
        game?.dispose();
        seat = msg.seat ?? 0;
        const names = msg.opponents ?? ['bot:casual'];
        const specIn = msg.spec ?? { players: [] };
        opponents = names.map((n, i) => agentFrom(n, (specIn.seed ?? 1) * 31 + i));
        const players = [...names.map((n) => ({ name: n }))];
        players.splice(seat, 0, { name: 'you' });
        game = await HeadlessGame.create({ ...specIn, players });
        const events = await runOpponents();
        out({ obs: game.observe(), done: game.done, events });
      } else if (msg.op === 'step') {
        if (!game) throw new Error('reset first');
        const before = [...game.match.scores];
        const r = game.act(msg.shot ?? ({} as Shot));
        const events = [...r.events, ...(await runOpponents())];
        const after = game.match.scores;
        const reward = after[seat] - before[seat] - after.reduce((s, v, i) => (i === seat ? s : s + v - before[i]), 0);
        out({ obs: game.observe(), reward, done: game.done, scores: [...after], winners: game.match.winners, events });
      } else if (msg.op === 'close') {
        break;
      } else throw new Error(`unknown op "${msg.op}"`);
    } catch (e) {
      out({ error: String((e as Error).message ?? e) });
    }
  }
  game?.dispose();
}

/** What another port needs from this core: a pool of generated maps per field and level,
 *  the collectible tiers, and reference marbles to check its own generator against. */
function exportBundle(perLevel: number) {
  const maps = [];
  for (const arena of ['desk', 'culdesac', 'grass', 'sand', 'ice', 'gravel'] as ArenaId[])
    for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[])
      for (let i = 0; i < perLevel; i++) maps.push(generateMap({ arena, difficulty, seed: 1000 + i * 37 }));
  return { maps, props: PROP_TRAITS, rarity: RARITY, hueNames: HUE_NAMES, words: MARBLE_WORDS, fixtures: marbleFixtures() };
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  const { opts, rest } = parse(argv);
  if (cmd === 'play') await play(opts, rest);
  else if (cmd === 'serve') await serve();
  else if (cmd === 'map') out(generateMap(specFrom(opts) as { arena: ArenaId; difficulty: Difficulty; seed: number }));
  else if (cmd === 'marble') for (const s of rest) out(generateMarble(Number(s)));
  else if (cmd === 'collectible') for (const u of rest) out(mintCollectible(u, opts.tier as Tier | undefined));
  else if (cmd === 'export') out(exportBundle(Number(opts.maps ?? 12)));
  else {
    process.stderr.write(`usage: ringer-headless play|serve|map|marble|collectible  (bots: ${Object.keys(BOT_PROFILES).join(', ')})\n`);
    process.exitCode = 2;
  }
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + '\n');
  process.exit(1);
});
