# CLAUDE.md

MeCoil is a self-hosted laser tag server for Goliath Recoil BLE guns: a Node.js WebSocket game server (`server/`), a Svelte web client (`client/src`) and a React Native Android app (`mobile/src`), both talking to the same server.

## Commands

Root (Node ≥ 20): `make install`, `make gen-certs` (mkcert HTTPS certs, needed for BLE/GPS/compass on phones), `npm run dev` (server :3000 + Vite :5173), `npm run dev:server`, `npm run build`, `npm start`, `npm run lint` (Biome, what CI runs), `npm run fmt`, `npm test` (`node --test`; single file: `node --test path/to/file.test.js`).

HTTPS turns on automatically when `certs/cert.pem` and `certs/key.pem` exist; `NO_HTTPS=1` forces HTTP. `PORT` defaults to 3000. Vite proxies `/ws` to the server.

Mobile (`cd mobile`, own package.json, ESLint/Jest, ignored by Biome): `npm install`, `npm run android`, `npm run start`, `npm run lint`, `npm test`. APK/Android targets are in `Makefile-android.mk`, Docker targets in `Makefile-docker.mk` (assets in `infra/docker/`). NDK is pinned to 27.1.12297006. Build troubleshooting is in the README.

CI runs lint, builds the client, and checks `node server/index.js` stays up for 5 s.

## Architecture

- **Protocol**: JSON messages with a `type` field. `shared/messages.js` is the single source of truth (`C2S`, `S2C`, `GAME_MODES`, `GAME_STATES`, `GUN_MODE_DAMAGE`), shared by server, web (`$shared` alias) and mobile. Add new message types there.
- **Server is authoritative.** Clients send GPS `position`, `fire` and `hit` (with `shooterWeaponId` from the gun's IR); the server decides outcomes.
- `server/index.js`: Express + `ws`. A socket becomes a `Player` only after `REGISTER` or `REJOIN`. `PING`→`PONG` in any state; a 30 s sweep reaps ghost sockets.
- `RoomManager`: rooms and reconnects. Dropped players go into `_pendingReconnect` (90 s grace in lobby, whole round during play). `rejoin()` takes over by room membership; `close` is ignored unless `player.ws === ws`.
- `GameManager` (per room): lobby, ready-up, teams, countdown, host controls. `_startGame()` assigns gun slots, picks the mode class and runs the power-up timer.
- `modes/BaseMode.js`: shared match logic (tick, hits, damage via `_damageFor()`, kills, respawn, power-ups, airstrike/Apache, position filtering). Modes override hooks like `_areTeammates`, `_buildScores`, `_determineWinner`, `_checkWinCondition`.
- **New game mode** touches: a class in `server/modes/`, `GAME_MODES`, the map in `GameManager._startGame()`, `client/src/screens/Lobby.svelte` and `mobile/src/screens/LobbyScreen.tsx`.
- **Hardware**: read `docs/` (BLE GATT, IR packets, firmware config) before touching `recoilweapon`/`ble`. `DEFAULT_PROFILE` and `GUN_MODES` live in each client's `lib/ble`. Web Bluetooth works only in Chrome/Edge on Android. The web simulator (`client/src/lib/simulator.js`: T fire, R reload, H hit) works without a gun.

## Keep the two clients in sync

The web and mobile clients implement the same flow (Setup → RoomSelect → Lobby → InGame → End) with mirrored modules: `lib/network`, `lib/ble`, `lib/recoilweapon`, `lib/audio`, `stores/game`, `stores/map`.

Every client change (feature, UI/UX, bug fix, behaviour tweak) goes into both clients in the same change, matching behaviour, wording and layout. If one client can't take it in this task, tell the user and name the missing client in the commit message and `releasenotes.md`. Platform-only changes (native Android plumbing, browser-only CSS/Web Bluetooth) are exempt; call them out in the final summary.

## Conventions

- Biome style: 2-space indent, single quotes, ES modules.
- User-facing changes get a `releasenotes.md` entry (Keep-a-Changelog: Added/Changed/Fixed under a version heading). Update the README when features or the protocol change.

## Git workflow

Applies to every task that changes files; no need to ask before committing.

1. On `main`/`master`, first create `feature/<short-kebab-description>`. Otherwise keep using the current feature branch. Never commit to `main`.
2. Run `make fmt`, then `make lint` until it passes. Never bypass checks (`--no-verify`). If lint can't be fixed within the task, stop and tell the user.
3. Commit at the end of every task, staging only the files you changed (`git add <paths>`, not `-A`), including files `make fmt` reformatted.
4. Commit subjects start with an emoji plus a short imperative summary (e.g. `🐛 Fix respawn timer`).
5. Don't push, merge or open a PR unless asked.
