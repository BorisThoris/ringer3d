# Ringer 3D on Steam

The web build of the game in an Electron window. Steam itself needs no window: everything the game
asks of Steam is one object, `api.cjs` ([steamworks.js](https://github.com/ceifa/steamworks.js) plus
Steam's flat C API through koffi for what steamworks.js lacks: inventory, leaderboards, friends, the
timeline). The shell serves it to the game as `window.steam`; `node-bridge.cjs` hands the same object
to plain Node (the headless CLI, agents, tests).

The game never calls Steam directly. It calls the platform services in `src/services` (achievements,
stats, leaderboards, cloud saves, presence, friends, recording moments, items), and Steam is one
adapter (`steamServices.ts`). Google Play Games is another (`playServices.ts`; the Android side is a
`PlayGames` Capacitor plugin still to write); without a platform, the local adapter keeps everything
on the device. Each platform's ids are in `src/services/catalog.ts`.

    game (src/ui, platformFeatures.ts) -> src/services -> steamServices -> SteamBridge
                                                       -> playServices  -> PlayGames plugin (Android)
                                                       -> localServices -> localStorage / memory
    SteamBridge = window.steam (Electron shell) | connectSteam() (node-bridge.cjs, plain Node)
                -> api.cjs -> steamworks.js + pump.cjs (shared callback loop) + inventory.cjs + social.cjs

```bash
npm run build                 # the game (repo root)
cd steam && npm install       # once
npm start                     # play it in the Steam shell (Steam running = Steam features on)
npm run probe                 # check the live Steamworks binding: writes probe.json
node probe-headless.cjs       # the same API from plain Node, no window: identity, friends, leaderboards, items, lobby
node ../dist-headless/ringer-headless.mjs steam status   # the game's services on live Steam (npm run headless:build first)
npm run pack                  # a depot-ready folder: dist/win-unpacked (Ringer 3D.exe + steam_api64.dll)
```

Electron's postinstall can be skipped on this PC's npm: if `node_modules/electron/dist/electron.exe`
is missing, run `node node_modules/electron/install.js` (set `ELECTRON_CACHE` to a roomy drive).

## What uses Steam

| Steam feature | Where | What it does |
| --- | --- | --- |
| Lobbies (ISteamMatchmaking) | `src/net/steamMatchmaker.ts` | Online rooms are Steam lobbies. Public ones show in the server browser and join by code; private ones join through Steam invites. |
| P2P networking (ISteamNetworking) | same, `main.cjs` packet pump | Match messages, reliable, relayed by Valve when needed. P2P sessions are accepted for lobby peers. |
| Invites and Join Game | `listenForSteamInvites` (`ui/online.tsx`), "Invite Steam friends" in a room | Accepting an invite drops you into the room. |
| Achievements | `src/services/catalog.ts` `ACHIEVEMENTS`, unlocked in `src/platformFeatures.ts` | First win, clean sweep, online win, Tower cleared, first bag, Legendary, Mythic, Shiny and Mint pulls, a trade-up, a Marble Book set, 25 marbles, 7-day streak. |
| Stats | `catalog.ts` `STATS` | games_played, games_won, marbles_captured, bags_opened, marbles_owned (integers). |
| Steam Cloud | `platformFeatures.ts` `syncCloud` | settings.json, progress.json, wallet.json: newer copy wins on launch, then write-through. |
| Rich presence | `presence` (`platformFeatures.ts`, called from `ui/App.tsx`) | "In the menu", "Opening Marble Bags", "Playing online"...; lobby members grouped. |
| Overlay | `electronEnableSteamOverlay` | Shift+Tab overlay draws into the window. |
| Steam Deck | `initServices` | Lighter graphics by default on first launch. |
| Microtransactions | `src/platformStore.ts` `steamStore` | Coin packs: our server calls InitTxn/FinalizeTxn; the game waits for MicroTxnAuthorizationResponse. |
| Inventory (ISteamInventory) | `inventory.cjs` (koffi → steam_api64.dll), `src/steamItems.ts` | Marbles as Steam items: tradable and marketable. Each item id is the marble's uid, so its look, wear float, pattern and Shiny roll travel with it. Playtime drops, Marble Bags from the item store (opened by an exchange), trade-ups (five of a tier into one of the next), capture tallies as a dynamic property. |
| Leaderboards (ISteamUserStats) | `social.cjs`, `catalog.ts` `LEADERBOARDS`, `ui/social.tsx` | Most wins, most captures, best collection (its melt value): submitted as they change; Everyone / Friends / Around me in the Leaderboards screen. Created on first submit if the app allows it. |
| Friends (ISteamFriends) | `social.cjs`, `FriendsPanel` in the Online hub | Friends in a Ringer lobby first, with Join; others open their Steam profile. |
| Game recording (ISteamTimeline) | `social.cjs`, `services.moment` / `mode` | Markers for match results; the timeline tells menus, lobbies and play apart. |
| Launch through Steam | `main.cjs` | Released builds relaunch through Steam (restartAppIfNecessary); Steam's `SteamAppId` is used. |

## Setting up the Steamworks app (partner site)

Development uses App ID **480** (Valve's Spacewar test app, in `steam_appid.txt`): lobbies, P2P,
cloud and presence work there; Spacewar's own achievement names differ from ours. For the real app:

1. **App ID**: put it in `steam_appid.txt` for development. Released builds get it from Steam.
2. **Achievements**: create the `steam` names in `ACHIEVEMENTS` (`src/services/catalog.ts`) with icons.
3. **Stats**: create the integer stats in `STATS`.
4. **Steam Cloud**: enable it; byte quota 1 MB and 10 files is plenty.
5. **Leaderboards**: `ringer_wins`, `ringer_captures`, `ringer_collection` (descending, numeric);
   the game creates them on first submit if you don't.
6. **Rich presence**: upload `rich_presence.vdf` (Localization > Rich Presence).
7. **Microtransactions** (only for a free-to-play release): run the lobby server
   (`server/index.mjs`, which includes `server/steamStore.mjs`) with `STEAM_PUBLISHER_KEY`,
   `STEAM_APP_ID` and, while testing, `STEAM_SANDBOX=1` (no money moves). Prices are in
   `STEAM_PRICES` and must match `PRODUCTS` (`src/core/economy.ts`; a test checks). Build the game
   with `VITE_STEAM_STORE_URL` pointing at that server.
8. **Inventory service** (marbles as Steam items): enable it, then upload `itemdefs.json` (Inventory
   Service > Item Definitions). It is generated from `itemDefs()` in `src/steamItems.ts`; after
   changing that, run `UPDATE_ITEMDEFS=1 npx vitest run tests/steamItems.test.ts` (the test fails
   while the two differ). Set `appid` in the file, put tier and bag icons at the `icon_url`s, set the
   Marble Bag's price, and turn on Market listing for the app. Itemdefs: 1001–1005 marbles by tier
   (each above Common is made from five of the tier below), 800 Marble Bag, 801 its generator (the
   bag odds in tenths of a percent), 900 playtime drops.
9. **Depots**: `npm run pack`, then upload `dist/win-unpacked` with steamcmd and `depot/app_build.vdf`
   (fill in the App and depot ids).

## Steam items on App 480

Spacewar has real Steam inventory items and a playtime drop list (itemdef 10), so the inventory
flow can be tried before the app exists: `src/steamItems.ts` reads Spacewar's ship parts as
marbles of each tier. `npm run probe:inventory` (or `electron probe-inventory.cjs`) lists the
inventory and triggers a drop; `node scripts/qa-steam-items.mjs` checks the Collection in the
shell. Trade-ups and bags need our own itemdefs, so they report "opens with the Steam release" on 480.

## What one Steam account can't test

Two players over Steam P2P need two accounts on two machines. `tests/steam.test.ts` runs the whole
lobby and P2P flow (host, browse, join by code, private rooms by invite, messages, a full online
room) against a fake Steam; `npm run probe` checks the real binding on one account.
