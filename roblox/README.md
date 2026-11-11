# Ringer 3D on Roblox

The Roblox version of Ringer 3D: the same Ringer rules, the bot ladder and the eight-floor Tower,
played on Roblox's own physics, with Roblox's systems for saving, badges, leaderboards,
collectibles and Robux.

- Experience: universe `10773508905`, start place `114836219465070` (owner: boristhoris).
- Everything is plain Luau in `src/`, laid out the way Rojo expects (`default.project.json`), so
  the project can also be opened with `rojo serve` and Studio. No Studio is needed to build,
  publish or test.

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
