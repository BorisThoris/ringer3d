# Ringer 3D

Ringer, the classic playground marble game, rebuilt as a modern 3D game for
the web, phones and PC. Knuckle down on the ring line, flick your taw, and
knock the thirteen marbles of the cross out of the ring.

- **Story:** an eight-rung tower, Mortal Kombat style, from Pip Tumble in the
  schoolyard to the Taw King in the moonlit courtyard. Versus screens, taunts,
  and every fighter you beat gives you their marble.
- **Quick Match:** fair bots (Rookie to Master) or 2–4 player pass-and-play.
- **Online:** server browser, private rooms with codes, peer-to-peer play
  (WebRTC) with a relay fallback, fair bots to fill seats or replace a player
  who drops.
- **Four fields** with their own physics: Schoolyard dirt, Rooftop pavement at
  dusk, Grandma's carpet, Moonlit Courtyard flagstones.
- **Glass marbles:** real refraction, dispersion and tint around 3D interiors
  (cat's-eye vanes, swirls, onionskins, aventurine, clearies, steelies),
  coloured caustics, per-field reflections, bloom. Twelve taws to collect.
- Runs in any modern browser, as an installable PWA, as an Android/iOS app
  (Capacitor) and as a desktop app (Electron).

## Play

```bash
npm install
npm run dev                  # http://localhost:5181 (single player)
npm run dev:server           # in a second terminal: the lobby for online play
```

Production, one process serving the game and the lobby:

```bash
npm run build
npm run serve                # http://localhost:8787, PORT to change
```

### Controls

- **Flick:** drag anywhere and pull back like a slingshot. Longer pull, harder
  flick; release to shoot, drag back to the start to cancel.
- **Knuckle down:** at the start of a turn, drag your shooter (or use ⟲ ⟳) to
  pick your spot on the ring line.
- **Spin:** tap the white ball. Low = backspin (stop after contact), high = follow.
- **Camera:** two fingers orbit and pinch-zoom; right-drag and wheel on
  desktop. ◎ cycles aim / overhead / follow.
- **Keyboard:** ←/→ fine aim (Shift = finer), ↑/↓ power, Space shoots,
  Alt+←/→ slides along the line.

### Rules (traditional Ringer)

1. Thirteen marbles sit in a cross in the middle of the ring.
2. **Lag** for order: everyone rolls toward a line; closest goes first.
3. Each turn starts on the ring line, anywhere around it.
4. Every marble you knock out of the ring is yours.
5. Knock at least one out **and** keep your shooter inside the ring: shoot
   again from where it stopped.
6. A miss, or your shooter leaving the ring, ends your turn (you keep what you won).
7. When the ring is empty, most marbles wins. Tournament option: first to 7.

## Fair bots

Bots see what you see and shoot the way you shoot (`src/bots/bot.ts`):

- They read marble positions, the ring and the surface. They never run the
  physics ahead to test a shot.
- They answer with the same `ShotInput` (aim, power, spin) a flick produces,
  under the same limits.
- Their plan is geometry (ghost-ball aiming, blockers) plus a feel for how far
  a marble rolls on this surface, measured once per surface the way a player
  learns it by practising (`src/sim/calibration.ts`).
- Every shot gets hand noise on aim and power. Difficulty is that noise plus
  judgement, never a hidden advantage. Story fighters are tuned the same way.

## Online

```
 guest ──WebRTC data channel──► host ◄──WebRTC── guest
   │                              │                │
   └────── lobby (WebSocket): server browser, codes, signalling, relay ──┘
```

- The **host** runs the match: seating, bots, and the authoritative result of
  every shot. Shots travel as inputs (aim, power, spin); every device replays
  them for the visuals, then snaps to the host's settled positions. Physics
  drift between devices can never split the game (`src/game/online.test.ts`
  plays a whole match with a deliberately wrong client and checks both agree).
- Links are peer-to-peer over WebRTC (public STUN). If a network blocks that,
  messages fall back to the lobby's relay automatically.
- The host checks every move comes from the device that owns that seat. A
  player who leaves is replaced by a fair bot; if the host leaves, the room closes.
- **LAN party:** one player runs `npm run serve`; everyone opens Online →
  Server and enters that PC's address (e.g. `192.168.1.20:8787`).
- **Builds for stores/desktop** point at a server with
  `VITE_LOBBY_URL=wss://your-host/lobby npm run build`.

## Apps

**Android** (Capacitor 6, JDK 17, Android SDK 34+):

```bash
npm run build
npx cap sync android
cd android && gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
```

Set `RINGER_BUILD_DIR` to put Gradle's build output on another drive.

**iOS:** `npx cap add ios` on a Mac, then open `ios/App` in Xcode.

**Desktop** (Electron):

```bash
npm run build
npm run desktop              # run it
npm run desktop:pack         # unpacked app in release/
npm run desktop:dist         # installers (NSIS + portable on Windows, dmg, AppImage)
```

## Architecture

| Layer | What it is |
|---|---|
| `src/core` | Ringer rules as a pure state machine. No three.js, no physics. |
| `src/sim` | Rapier physics in metres at 240 Hz with CCD, plus the rolling resistance Rapier lacks; per-surface roll calibration. |
| `src/bots` | Fair bots. Headless bot-vs-bot matches run in the tests. |
| `src/game` | A match: rules + physics + bots + online roles (solo / host / client). |
| `src/net` | Wire protocol, lobby client, WebRTC peer links with relay fallback, room sessions. |
| `server/` | Node lobby + static server (`node server/index.ts`, no build step). |
| `src/render` | three.js: glass marbles, per-arena reflection environments, procedural fields, camera rig, marble previews. |
| `src/input` | Touch-first slingshot controls, placement, orbit/zoom, keyboard. |
| `src/ui` | Menus, story tower, versus, taw picker, online rooms, HUD, results. |
| `src/audio` | Synthesised sound effects; music tracks in `public/music`. |
| `src/platform` | Haptics (native in the apps, vibration on the web). |

## Tests

```bash
npm test                     # rules, physics, bots, lobby protocol, online sync
npm run typecheck
npm run build
```

Headless browser checks (Playwright with software WebGL). On the dev PC run
them in the isolated window station, never on the desktop:

```powershell
powershell -File scripts/run-isolated.ps1 smoke      D:\agent-work\ringer3d\<date>-smoke
powershell -File scripts/run-isolated.ps1 visual     D:\agent-work\ringer3d\<date>-visual
powershell -File scripts/run-isolated.ps1 online-e2e D:\agent-work\ringer3d\<date>-online
```

- `smoke` plays real flicks through the UI on a phone and a desktop viewport.
- `visual` shoots every taw close up, the versus screen and each field.
- `online-e2e` starts the server; one browser hosts, the other finds the ring
  in the server browser, they connect and play first-to-7, and both must agree.

## Credits

Music was generated locally with ACE-Step 1.5 (MIT; trained on licensed and
royalty-free data). Everything else (textures, marbles, sound effects) is
procedural code in this repository.
