# Ringer 3D

The classic playground marble game — **Ringer** — rebuilt as a modern 3D game for web, iOS, Android and desktop.

Knuckle down on the ring line, flick your shooter into the cross of 13 marbles, and keep every marble you knock out. Stay in the ring after a capture and you shoot again. Most marbles wins.

- **Five arenas** with their own feel: Schoolyard (asphalt), Zen Garden (grippy sand), Neon Rooftop (fast tile), Glacier Hall (ice), and the Caldera.
- **Tower (story mode)**: pick a marble, climb eight opponents with their own personalities, beat the Black Taw, unlock fighters and endings.
- **Fair bots**: six skill levels from Rookie to Legend.
- **Online**: server browser, private rooms with 4-letter codes, 2–4 players, peer-to-peer matches with bots filling empty seats.
- **Pass and play** for 2–4 players on one device.
- Zero downloaded assets: textures, marbles and audio are all generated procedurally, so the app stays small and loads offline as a PWA.

## Quick start

```bash
npm install
npm run dev          # game at http://localhost:5173
npm run server       # lobby server at ws://localhost:8787 (needed for Online only)
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

- **Lobby server** (`server/index.mjs`, WebSocket): room list for the server browser, 4-letter join codes, WebRTC signaling, and a relay fallback.
- **Matches are peer to peer** over WebRTC data channels (star topology: the host orders turns and validates that shots come from the player whose turn it is). If a direct connection fails behind strict NATs, a link automatically falls back to relaying through the lobby server.
- If a guest drops mid-match, a bot takes over their seat on the host. If the host leaves, the match ends for everyone.
- Configure STUN/TURN for clients with the server's `ICE_SERVERS` env var, e.g. `ICE_SERVERS='[{"urls":"turn:turn.example.com","username":"u","credential":"p"}]'`.

## Deploying

**Docker** (game + lobby on one port):

```bash
docker build -t ringer3d .
docker run -p 8787:8787 ringer3d
```

Put it behind HTTPS (any reverse proxy); the client automatically uses `wss://` on the same host. For a separately hosted lobby, build with `VITE_LOBBY_URL=wss://lobby.example.com npm run build`.

## Mobile (Capacitor)

```bash
VITE_LOBBY_URL=wss://your-lobby.example.com npm run mobile:sync
npm run android      # opens Android Studio
npm run ios          # opens Xcode (macOS)
```

Native builds can't infer the lobby address from the page URL, so set `VITE_LOBBY_URL` (a `wss://` URL — Android blocks plain `ws://` from the app's secure origin). Players can also change it in Settings. Haptics and fullscreen status bar handling use Capacitor plugins on device.

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
- **Deploy web to GitHub Pages** (on `main`): enable Pages with source "GitHub Actions" in the repository settings. Set the repository variable `LOBBY_URL` to your lobby's `wss://` address to enable Online play on the hosted page.

## Tuning

- Physics constants: `src/core/constants.ts` (ring size, shot speed, step rate) and each arena's `surface` in `src/game/arenas.ts` (rolling resistance, friction, bounce).
- Bot skill: `src/ai/profiles.ts`.
- Story ladder, fighters, quotes and endings: `src/game/story.ts`.

Changing physics constants changes simulation results, so bump `PROTOCOL_VERSION` in `src/net/protocol.ts` when you do — the lobby refuses to mix versions.
