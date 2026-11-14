# Ringer 3D on Roblox

The Roblox version of Ringer 3D: the same Ringer rules, the bot ladder and the eight-floor Tower,
played on Roblox's own physics, with Roblox's systems for saving, badges, leaderboards,
collectibles and Robux.

- Experience: universe `10773508905`, start place `114836219465070` (owner: boristhoris).
- Everything is plain Luau in `src/`, laid out the way Rojo expects (`default.project.json`), so
  the project can also be opened with `rojo serve` and Studio. No Studio is needed to build,
  publish or test.

**Play it:** https://www.roblox.com/games/114836219465070

## Technical highlights

- **One deterministic physics engine, shared by server and clients.** Shots don't use Roblox
  physics: `Ringer.Sim` is a fixed-step rigid-body sim in pure Luau (spheres, rolling and spin,
  per-field surface friction and camber, breakable and movable props, bumpers, cups, banks), ported
  from the web game. The server plays a shot to the end in one go and its result is final. Each
  client replays the same shot frame by frame, with slow motion and hit-stop. The client then
  fingerprints where everything stopped (FNV-1a over the quantized layout, `Playback.layoutHash`)
  and checks it against the fingerprint the server sent. The in-game stats overlay (F3) shows the
  check for every shot.
- **Server-authoritative, cheat-resistant.** A client only ever sends an aim, a power and a spin.
  The server checks every request:
  - purchases and equips against what the player owns
  - emotes against a rate limit
  - lobby coin pickups: the player must be standing at the coin, each coin has a respawn timer,
    and there's an hourly cap
- **Tested in the cloud, built without Studio.** `scripts/build.mjs` packs `src/` into a place file
  (Rojo layout), and `publish.mjs` uploads it through Open Cloud. `scripts/test-all.mjs` uploads a
  test build as an unpublished version and runs the suites on Roblox's own servers through Open
  Cloud Luau Execution:
  - a server boot and a whole bot game
  - every field and marble
  - effects, skies and UI modules
  - a full client replay of a bot game, fingerprint-checked shot by shot
  - 345 physics shots against the web game's engine
  
  CI: `.github/workflows/roblox.yml`.
- **Data you can trust.** Profiles are session-locked through `UpdateAsync` (a server holding a
  fresh lock is waited for, and a save never overwrites a copy another server now owns). Saves
  retry, and every profile is saved on shutdown. If the DataStore can't be reached, the player
  gets a fresh profile that is never saved, rather than one that could overwrite their real data. `ProcessReceipt` records each purchase id and saves before granting, so a retried
  receipt never pays out twice. Limited marbles get serial numbers from a global DataStore counter.
  Marble Bags show their odds before purchase and are refused where PolicyService restricts paid
  random items.
- **Live-ops basics.** AnalyticsService economy events (every coin source and sink) and an
  onboarding funnel; badges; game passes and developer products; a daily streak reward; a global
  leaderboard.
- **Feel and retention.** First-game coaching and an animated mascot that reacts to the player.
  Shots get camera trauma, FOV punch, hit-stop, comic hit words and coin bursts, and the ring line
  flashes as marbles cross it. Each field has its own sky, set pieces and critters, plus surface
  kick-up and tracks. Sound is an OGG sprite played with PlaybackRegions, with ACE-Step music.
  Everything is drawn client-side where it can be, so the server only replicates what matters.

## Layout

| Path | What it is |
| --- | --- |
| `src/ReplicatedStorage/Ringer/` | Shared: `Config` (sizes, fields, bots, marble catalogue, economy), `Rules`, `Bot`, `MarbleLook` |
| `src/ServerScriptService/Main.server.luau` | Lobby, matchmaking (duel, vs bot, Tower), rewards, client requests |
| `src/ServerScriptService/Server/` | `Table` (one match on server physics), `Arena`, `Data` (profiles), `Economy`, `Collectibles`, `Market`, `Leaderboard` |
| `src/StarterPlayer/StarterPlayerScripts/` | The client: HUD and panels (`Client`), aiming and camera (`Aim`), UI kit (`Kit`) |
| `store/listing.json` | Store page text, passes, products and badges (names, descriptions, prices) |
| `store/ids.json` | The ids those got on the Creator Hub; the build turns them into `Ringer.Ids` |
| `scripts/` | `build.mjs` (src to place file), `publish.mjs`, `run-luau.mjs`, `cloud.mjs` |
| `lighting.json` | The place's Lighting (Future, bloom, colour grading), written in by `build.mjs` |
| `scripts/creator-hub/` | Creator Hub steps run through the signed-in browser: universe, key, monetization, store page, genre, thumbnails |
| `scripts/shots/` | Real in-game screenshots off-screen: Studio in a private window station + `CaptureService` |
| `tests/smoke.luau` | Cloud test: everything compiles, the server boots, rules, bot, Tower, tables, a whole bot game, bag odds |
| `tests/sim.luau` | Cloud test: 345 shots from the web game's physics (`scripts/sim-fixtures.ts`) replayed on `Ringer.Sim` |
| `tests/client.luau`, `botmatch.luau`, `botstats.luau` | Client replay and aim, bot games on every field, the bot ladder against the web runner |
| `PARITY.md` | Every gameplay mechanic of the web game and where the port stands on it |
| `store/art/` | Icon, thumbnails (with alt text), badge/pass/product images; `ingame/` real frames |
| `art-pipeline/` | How the store art was made: local SDXL renders + outlined text with sharp |
| `research/` | Why the store page and the look are what they are: search and genre data, the top earners' style |

## Build, test, publish

The Open Cloud API key lives outside the repo, in `D:/agent-work/ringer3d/roblox-secrets/opencloud.key`
(or `ROBLOX_KEY_FILE`). It is scoped to this experience (publish places, run Luau tasks),
restricted to this PC's IP, and expires on 2027-01-26.

```bash
node roblox/scripts/test-all.mjs                                 # build, upload a draft, run every cloud suite
CHECK=1 node roblox/scripts/build.mjs roblox/build/check.rbxlx   # a test build
node roblox/scripts/publish.mjs roblox/build/check.rbxlx Saved   # upload as a draft version
node roblox/scripts/run-luau.mjs roblox/tests/smoke.luau <version>
node roblox/scripts/build.mjs                                    # the real build
node roblox/scripts/publish.mjs roblox/build/ringer.rbxlx Published
```

Shots roll on `Ringer.Sim`, not Roblox physics, so the cloud tests cover how shots roll too. The
sim fixtures are regenerated from the web game with
`npx esbuild roblox/scripts/sim-fixtures.ts --bundle --platform=node --format=esm --outfile=roblox/build/sim-fixtures.mjs && node roblox/build/sim-fixtures.mjs`.

## Design notes

- **Physics.** Every shot is played on `Ringer.Sim`, the web game's shot simulation
  (`src/core/physics.ts`) in pure Luau, in web units, drawn at x4. The server plays a shot to
  the end at once and its result is final; each client replays the same shot frame by frame and
  the server waits for those replays. The bot imagines its candidate shots on the same sim, as
  the web bot does. Roblox's own physics plays no part. `PARITY.md` lists every mechanic and how
  closely it matches; `tests/sim.luau` checks it against the web game's own physics.
- **Collectibles.** Roblox does not allow NFTs or blockchain items. Limited marbles are the
  platform's own way to do scarcity: a fixed supply per edition, every copy stamped with a serial
  number from a global DataStore counter.
- **Marble Bags** show their odds before purchase and are refused where PolicyService says paid
  random items are restricted.
- **Purchases.** `ProcessReceipt` records each purchase id in the profile and saves before granting,
  so a retried receipt never pays out twice.
