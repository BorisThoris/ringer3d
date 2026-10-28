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
| `tests/smoke.luau` | Cloud test: everything compiles, the server boots, rules, bot, tables, bag odds |

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

Cloud test servers don't simulate physics (`RunService:IsRunning()` is false there), so the cloud
test covers everything but how shots roll; that needs a playtest in Studio or the live game.

## Design notes

- **Physics.** Roblox spheres roll almost forever, so `Table:roll` applies the web game's rolling
  resistance by hand every step. The kerb is carried up by an invisible 60-stud wall, and a
  safety net sets down anything found past the kerb or under the ground: no marble leaves the
  field and no shot can hang.
- **Collectibles.** Roblox does not allow NFTs or blockchain items. Limited marbles are the
  platform's own way to do scarcity: a fixed supply per edition, every copy stamped with a serial
  number from a global DataStore counter.
- **Marble Bags** show their odds before purchase and are refused where PolicyService says paid
  random items are restricted.
- **Purchases.** `ProcessReceipt` records each purchase id in the profile and saves before granting,
  so a retried receipt never pays out twice.
