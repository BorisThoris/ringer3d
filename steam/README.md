# Ringer 3D on Steam

The web build of the game in an Electron window, with Steamworks in the main process
([steamworks.js](https://github.com/ceifa/steamworks.js), which ships the Steam API redistributables).
The game talks to Steam only through `window.steam` (`src/steam.ts`); off Steam it is absent and
everything falls back to the normal paths.

```bash
npm run build                 # the game (repo root)
cd steam && npm install       # once
npm start                     # play it in the Steam shell (Steam running = Steam features on)
npm run probe                 # check the live Steamworks binding: writes probe.json
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
| Achievements | `src/steamFeatures.ts` `ACHIEVEMENTS` | First win, clean sweep, online win, Tower cleared, first bag, Legendary pull, Mythic pull, 25 marbles, 7-day streak. |
| Stats | `STATS` | games_played, games_won, marbles_captured, bags_opened, marbles_owned (integers). |
| Steam Cloud | `syncCloud` | settings.json, progress.json, wallet.json: newer copy wins on launch, then write-through. |
| Rich presence | `steamPresence` (`ui/App.tsx`) | "In the menu", "Opening Marble Bags", "Playing online"...; lobby members grouped. |
| Overlay | `electronEnableSteamOverlay` | Shift+Tab overlay draws into the window. |
| Steam Deck | `initSteam` | Lighter graphics by default on first launch. |
| Microtransactions | `src/platformStore.ts` `steamStore` | Coin packs: our server calls InitTxn/FinalizeTxn; the game waits for MicroTxnAuthorizationResponse. |
| Inventory (ISteamInventory) | `inventory.cjs` (koffi → steam_api64.dll), `src/steamItems.ts` | Marbles as Steam items: tradable and marketable. Each item id is the marble's uid, so its look, wear float, pattern and Shiny roll travel with it. Playtime drops, Marble Bags from the item store (opened by an exchange), trade-ups (five of a tier into one of the next), capture tallies as a dynamic property. |
| Launch through Steam | `main.cjs` | Released builds relaunch through Steam (restartAppIfNecessary); Steam's `SteamAppId` is used. |

## Setting up the Steamworks app (partner site)

Development uses App ID **480** (Valve's Spacewar test app, in `steam_appid.txt`): lobbies, P2P,
cloud and presence work there; Spacewar's own achievement names differ from ours. For the real app:

1. **App ID**: put it in `steam_appid.txt` for development. Released builds get it from Steam.
2. **Achievements**: create the API names in `ACHIEVEMENTS` (`src/steamFeatures.ts`) with icons.
3. **Stats**: create the integer stats in `STATS`.
4. **Steam Cloud**: enable it; byte quota 1 MB and 10 files is plenty.
5. **Rich presence**: upload `rich_presence.vdf` (Localization > Rich Presence).
6. **Microtransactions** (only for a free-to-play release): run the lobby server
   (`server/index.mjs`, which includes `server/steamStore.mjs`) with `STEAM_PUBLISHER_KEY`,
   `STEAM_APP_ID` and, while testing, `STEAM_SANDBOX=1` (no money moves). Prices are in
   `STEAM_PRICES` and must match `PRODUCTS` (`src/core/economy.ts`; a test checks). Build the game
   with `VITE_STEAM_STORE_URL` pointing at that server.
7. **Inventory service** (marbles as Steam items): enable it, then upload `itemdefs.json` (Inventory
   Service > Item Definitions). It is generated from `itemDefs()` in `src/steamItems.ts`; after
   changing that, run `UPDATE_ITEMDEFS=1 npx vitest run tests/steamItems.test.ts` (the test fails
   while the two differ). Set `appid` in the file, put tier and bag icons at the `icon_url`s, set the
   Marble Bag's price, and turn on Market listing for the app. Itemdefs: 1001–1005 marbles by tier
   (each above Common is made from five of the tier below), 800 Marble Bag, 801 its generator (the
   bag odds in tenths of a percent), 900 playtime drops.
8. **Depots**: `npm run pack`, then upload `dist/win-unpacked` with steamcmd and `depot/app_build.vdf`
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
