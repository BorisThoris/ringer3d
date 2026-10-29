# Ringer 3D

The classic playground marble game — **Ringer** — rebuilt as a modern 3D game for web, iOS, Android and desktop.

Knuckle down on the ring line, flick your shooter into the cross of 13 marbles, and keep every marble you knock out. Stay in the ring after a capture and you shoot again. Most marbles wins.

- **Seven fields**, each with its own ground physics (bumps, camber, grip, what the edge does): a desk, a cul-de-sac, a back lawn, a beach, a frozen lake, a gravel pit, and a mini-golf course.
- **Generated maps** (easy / medium / hard, shuffle for a new one): what you would really find on each field — books, pencils, paper and coins on the desk; cracks, puddles, bricks and cones on the street; molehills, mud, twigs and rocks on the lawn; driftwood, shells and wet sand on the beach; cracks, black ice and drifts on the lake; pebble beds in the pit. Bumpers, speed pads and cups live on the mini-golf course. Maps are laid out with rotational symmetry so every seat is equally fair, and the host sends the map whole in online play.
- **Tower (story mode)**: pick a marble, climb eight opponents with their own personalities, beat the Black Taw, unlock fighters and endings.
- **Fair bots**: six skill levels from Rookie to Legend.
- **Online, no server required**: server browser, private rooms with 4-letter codes, 2–4 players. Games are found through public Nostr relays and matches run directly between devices over WebRTC; bots take dropped seats. An optional self-hosted lobby server is also supported.
- **Pass and play** for 2–4 players on one device.
- **Real glass marbles**: twisted cat's-eye blades, swirl ribbons, onionskins, aventurine galaxies, clearies with bubbles, dispersion and coloured caustics, plus a 3D close-up you can spin in the marble picker and versus screen.
- Toy-diorama look, made in code: hand-painted ground tiles (`src/render/groundArt.ts`), chunky scenery and map pieces, soft bright light, and glossy glass marbles in strong colours that stand out on every field. The only third-party files are CC0 HDRIs (lighting and reflections) and sound effects — see `public/assets/CREDITS.md`.

## Quick start

```bash
npm install
npm run dev          # game at http://localhost:5173 (online works out of the box, peer to peer)
npm run server       # optional lobby server at ws://localhost:8787 (Settings → Online connection)
```

Production, single process (serves the game and runs the lobby):

```bash
npm start            # builds, then serves everything on http://localhost:8787
```

Tests (physics determinism, full matches, bot strength, lobby protocol):

```bash
npm test
```

## Controls

| | Touch | Mouse / keyboard |
|---|---|---|
| Aim | Drag anywhere (slow drags are finer) | Drag, or ← / → (Shift = fine) |
| Slide along the ring (first shot of a turn) | Drag your shooter | Drag your shooter, or A / D |
| Power + flick | Pull the slider down, let go | Same, or hold Space and release |
| Spin | Spin pad (top = topspin/follow, bottom = backspin/stick) | Q / E |
| Camera | Camera button, pinch to zoom | T, mouse wheel |

## How it's built

TypeScript + Three.js + Rapier physics + React for UI, bundled with Vite.

```
src/
  core/      Deterministic simulation and rules. No DOM, no Math.random, no wall-clock time.
    physics.ts   Rapier world per shot, rolling resistance, quantized layouts, hashing
    match.ts     Ringer rules: captures, shoot-again, turn order, game end
  ai/        Fair bots (candidate generation, imagined outcomes, human-like hand tremor)
  game/      Arenas, marbles, story/tower data, settings, session orchestration
  render/    Three.js view, procedural arenas/marbles/textures, camera rig, input, synth audio
  net/       Lobby client, WebRTC peer links with relay fallback, online rooms
  ui/        React screens and HUD
server/      Node lobby + signaling + relay server (also serves the built app)
android/ ios/   Capacitor native projects
src-tauri/      Tauri desktop shell
```

### Determinism is the backbone

Between shots every marble is at rest, so the whole table is just a list of positions. Each shot **rebuilds the physics world from the quantized layout** and runs a fixed 120 Hz step with Rapier's cross-platform deterministic build. That makes every shot's outcome a pure function of *(layout, shot, surface)*:

- **Online** peers exchange only the shot (place angle, aim, power, spin). Everyone simulates the identical result locally, so there's no physics streaming and no lag during rolls. After each shot peers send a layout hash to the host; on mismatch the host sends a snapshot and the peer resyncs.
- **Bots** "imagine" candidate shots with exactly the physics the game uses.
- **Replays/reconnects** are trivial: a seed plus a list of shots.

### Fair bots

Bots only see what you see (marble positions) and output the same shot a human does. Difficulty changes how many shots they consider, whether they think about spin and leave position, and how steady their hand is: every intended shot is perturbed by Gaussian aim and power error (Rookie ≈ 6.5°, Legend ≈ 1.25°). Bot randomness comes from the match seed so games are reproducible. They also "line up" visibly before shooting.

### Online architecture

Two connection modes, chosen in Settings → Online connection. Both run the match itself peer to peer.

- **Peer to peer (default, nothing to deploy).** The server browser reads small room listings (Nostr kind 30078 events with an expiry tag) that hosts post to several public relays every 20 seconds; private rooms are never posted. Players with the same room code meet through [Trystero](https://github.com/dmotz/trystero) over the same relays, which performs the WebRTC handshake. After that, game messages go directly between devices (`src/net/p2pMatchmaker.ts`).
- **Lobby server (optional).** `server/index.mjs` provides the room list, codes, WebRTC signaling and a relay fallback for players behind very strict NATs where a direct connection can't be made (`src/net/serverMatchmaker.ts`). Configure STUN/TURN for clients with the server's `ICE_SERVERS` env var, e.g. `ICE_SERVERS='[{"urls":"turn:turn.example.com","username":"u","credential":"p"}]'`.
- Star topology over the data channels: the host orders turns and validates that shots come from the player whose turn it is. After every shot peers compare layout hashes; on mismatch the host sends a snapshot and the peer resyncs. `match.shotLog` records each shot with before/after hashes for replays and debugging.
- If a guest drops mid-match, a bot takes over their seat on the host. If the host leaves, the match ends for everyone.
- `npm run e2e:online` (with the app served on :8787) plays a match between two browser profiles; CI runs it in both modes.

## Headless core and agents

The rules, physics, maps, bots, marbles and economy run with no screen (`src/core`, `src/game/maps.ts`, `src/headless`). Every front end shares them: the web build, the Steam build (the same bundle in Tauri), the Play Store build (the same bundle in Capacitor), and AI agents.

```bash
npm run headless:build
node dist-headless/ringer-headless.mjs play bot:master bot:casual --arena sand --difficulty hard --games 10
node dist-headless/ringer-headless.mjs play stdio:"python examples/agents/nearest.py" bot:casual
python examples/agents/env.py      # a gym-style reset/step loop over `serve`
node dist-headless/ringer-headless.mjs marble 1 2 3
```

- In process: `HeadlessGame` (observe → JSON, act(shot) → events) and `playMatch(spec, agents)`.
- Any language: an agent reads `{"type":"observe","obs":…}` lines on stdin and answers one JSON shot per line (`src/headless/node.ts`).
- Training: `serve` takes `reset`/`step` lines and answers with the observation, a reward and `done`.

## Collectible marbles and stores

A marble is a seed (`src/core/marbleGen.ts`): its tier is rolled with the odds shown on the bag (Common 55%, Rare 28%, Epic 12%, Legendary 4.5%, Mythic 0.5%), then its pattern, glass finish, colour harmony, glow, glitter and name. The economy (`src/core/economy.ts`) is the same everywhere: coins for every match and a daily reward, Marble Bags bought with coins that mint a brand-new marble, melting marbles back into coins. Every marble plays the same.

Real-money coin packs go through one adapter per store (`src/platformStore.ts`), chosen by `VITE_STORE` or the shell:

| Store | Status |
| --- | --- |
| Steam | Microtransactions through our server (it holds the publisher key), confirmed by Steam's authorization callback; set `VITE_STEAM_STORE_URL`. Needs the Steamworks app and the server. |
| itch.io | No in-app purchases: the game is sold on its page; coins are earned by playing. |
| Google Play | A billing adapter goes here (a Capacitor billing plugin and products in the Play Console). Not built yet. |
| Web | Coins are earned by playing. |

## Deploying

Online play works without deploying anything. To host the web build, push to `main` and the Pages workflow publishes it. To run your own lobby server as well:

**Docker** (game + lobby on one port):

```bash
docker build -t ringer3d .
docker run -p 8787:8787 ringer3d
```

Put it behind HTTPS (any reverse proxy); the client automatically uses `wss://` on the same host. For a separately hosted lobby, build with `VITE_LOBBY_URL=wss://lobby.example.com npm run build`.

## Mobile (Capacitor)

```bash
npm run mobile:sync
npm run android      # opens Android Studio
npm run ios          # opens Xcode (macOS)
```

Online uses peer-to-peer mode by default, so mobile builds need no extra configuration. Only if you use the optional lobby server: set `VITE_LOBBY_URL` to its `wss://` address (Android blocks plain `ws://` from the app's secure origin), or enter it in Settings. Haptics and fullscreen status bar handling use Capacitor plugins on device.

## Steam

The Steam build is the same game in an Electron shell with Steamworks: Steam lobbies and P2P for online play, invites, achievements, stats, Steam Cloud saves, rich presence, the overlay and Steam Deck defaults. See [steam/README.md](steam/README.md).

```bash
npm run steam:start     # play in the Steam shell
npm run steam:pack      # depot-ready folder: steam/dist/win-unpacked
```

## Desktop (Tauri)

Requires [Rust and the Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm run desktop:dev      # native window with hot reload
npm run desktop:build    # installers for the current OS (Windows .msi/.exe, macOS .dmg, Linux .deb/.AppImage)
```

## Continuous integration

Every push builds and checks all targets on GitHub Actions (`.github/workflows/`):

- **Build all platforms**: typecheck, tests and web build; Android debug APK; iOS simulator app; desktop installers for Linux, Windows and macOS. Builds are downloadable as run artifacts.
- **Device smoke tests**: boots an Android emulator and an iPhone simulator, installs and launches the app, fails if it crashes or logs an uncaught JS error, and publishes screenshots and logs to the `ci-screens` branch.
- **Online e2e**: two browser profiles find each other in the server browser, connect and play; runs in peer-to-peer and lobby-server modes.
- **Deploy web to GitHub Pages** (on `main`): enable Pages with source "GitHub Actions" in the repository settings and set the repository variable `PAGES_ENABLED=true` (or run the workflow manually). Online works there in peer-to-peer mode; set the repository variable `LOBBY_URL` only if you run the optional lobby server.

## Tuning

- Physics constants: `src/core/constants.ts` (ring size, shot speed, step rate) and each arena's `surface` in `src/game/arenas.ts` (rolling resistance, friction, bounce).
- Maps: `src/game/maps.ts` (what each field's generator places), `src/core/physics.ts` (how pieces collide, patches and cups), `src/render/mapPieces.ts` (how each piece looks).
- Bot skill: `src/ai/profiles.ts`.
- Story ladder, fighters, quotes and endings: `src/game/story.ts`.

Changing physics constants changes simulation results, so bump `PROTOCOL_VERSION` in `src/net/protocol.ts` when you do — the lobby refuses to mix versions.
