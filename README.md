# Ringer 3D

Ringer, the classic playground marble game, rebuilt as a modern 3D game for
the web, phones and PC. Knuckle down on the ring line, flick your taw, and
knock the thirteen marbles of the cross out of the ring.

## Play

```bash
npm install
npm run dev        # http://localhost:5181
```

- **Flick:** drag anywhere and pull back like a slingshot. Longer pull, harder
  flick; release to shoot, drag back to the start to cancel.
- **Knuckle down:** at the start of a turn, drag your shooter (or use the
  ⟲ ⟳ buttons) to pick your spot on the ring line.
- **Spin:** tap the white ball. Low = backspin (stop after contact), high = follow.
- **Camera:** two fingers orbit and pinch-zoom; right-drag and wheel on desktop.
  The ◎ button cycles aim / overhead / follow views.
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
7. When the ring is empty, most marbles wins. Optional tournament rule:
   first to 7.

## Modes

- **Story:** an eight-rung tower, Mortal Kombat style, from Pip Tumble in the
  schoolyard to the Taw King in the moonlit courtyard. Versus splash, taunts,
  win and loss lines; progress is saved on the device.
- **Quick Match:** against a Rookie / Regular / Sharp / Master bot, or 2–4
  player pass-and-play on one device.
- **Fields:** Schoolyard (dirt), Rooftop at Dusk (fast pavement), Grandma's
  Parlour (slow carpet), Moonlit Courtyard (flagstones). The surface changes
  how far marbles roll.

## Fair bots

Bots see what you see and shoot the way you shoot (`src/bots/bot.ts`):

- They read marble positions, the ring and the surface. They never run the
  physics ahead to test a shot.
- They answer with the same `ShotInput` (aim, power, spin) a flick produces,
  under the same limits.
- Their plan is geometry: ghost-ball aiming, blockers, and a feel for how far
  a marble rolls on this surface, measured once per surface the way a player
  learns it by practising (`src/sim/calibration.ts`).
- Every shot then gets hand noise on aim and power. Difficulty is that noise
  plus judgement, never a hidden advantage.

## Architecture

| Layer | What it is |
|---|---|
| `src/core` | Ringer rules as a pure state machine. No three.js, no physics. Unit tested. |
| `src/sim` | Rapier physics in metres at 240 Hz with CCD, plus the rolling resistance Rapier lacks. Settles, reports hits. |
| `src/bots` | Fair bots (see above). Headless bot-vs-bot matches run in the tests. |
| `src/game` | A match: rules + physics + bots, stages (lag, aim, roll, banner), events for the UI. |
| `src/render` | three.js scene: glass marbles, procedural arenas and textures, aim guide, camera rig. |
| `src/input` | Touch-first slingshot controls, placement, orbit/zoom, keyboard. |
| `src/ui` | Menus, story tower, versus screen, HUD, results. Plain DOM over the canvas. |
| `src/audio` | Synthesised sound: glass clacks, rolling rumble, chimes. No audio files. |

Stack: TypeScript, Vite, three.js, Rapier (`@dimforge/rapier3d-compat`), all
in one codebase so web, mobile and desktop ship the same game.

## Tests

```bash
npm test           # rules, physics, bots (incl. full bot-vs-bot matches)
npm run typecheck
npm run build
node scripts/smoke.mjs <outDir>   # headless play-through with screenshots
```

On the dev PC the smoke script runs inside the isolated window station:
`D:\gha-runners\headless-tools\Start-IsolatedProcess.ps1 -FilePath node.exe
-ArgumentString '"scripts/smoke.mjs" "D:\agent-work\ringer3d\<date>-smoke"'
-WorkingDirectory <repo>`.

## Roadmap

Done in this first milestone: rules, physics, fair bots, four fields, story
tower, quick match, pass-and-play, HUD, sound, web build.

Next:

- **Online multiplayer.** Peer-to-peer over WebRTC data channels, with a small
  signalling + lobby service (a Cloudflare Worker with a Durable Object) that
  also powers the **server browser** and room codes. Shots travel as inputs;
  every peer replays them locally for the visuals, and the host's settled
  positions are authoritative (`MarbleSim.applyRest`), because Rapier's
  compat build is not guaranteed bit-identical across devices. The hook is
  already in place: `Controller { kind: 'remote' }` and `MatchEvents.onShot`.
- **Mobile apps.** Capacitor wrappers for iOS and Android (the build already
  uses relative asset paths and safe-area insets).
- **PC app.** Tauri or Electron shell for a Steam/desktop build.
- Music (local ACE-Step renders), fighter portraits, more fields, replays,
  haptics on mobile, settings for aim-guide length and camera.
