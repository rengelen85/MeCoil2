# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Linux/macOS (Makefile):**
```sh
make install
make gen-certs
make dev
```

**npm scripts directly:**
```sh
npm run dev            # server (port 3000) + Vite client (port 5173) via concurrently
npm run dev:server     # server only, with --watch
npm run dev:client     # Vite only
npm run build          # production build of the Svelte client
npm start              # production server (serves built client/dist)
```

There is no test suite.

## Architecture

### Two separate packages

The root `package.json` owns the **server** (Node.js, ESM). The **client** is a separate Vite/Svelte app in `client/` with its own `package.json`. Both must be installed (`npm install && npm install --prefix client`).

### HTTPS auto-detection

Both the server (`server/index.js`) and Vite config (`client/vite.config.js`) check for `certs/cert.pem` at startup and enable HTTPS automatically when the files exist. HTTPS is required for Web Bluetooth (BLE) and Geolocation on phones. Set `NO_HTTPS=1` to force plain HTTP.

### Server: state machine in GameManager

`GameManager` owns the single game instance and drives the state machine: `WAITING → COUNTDOWN → PLAYING → WAITING`. It creates a `BaseMode` subclass when a game starts and tears it down on end. All WebSocket routing goes through `GameManager.handleMessage()`.

**Game modes** (`server/modes/`) inherit `BaseMode`, which provides the 1-second tick, position broadcast, kill registration, and power-up application. Subclasses implement four methods: `_areTeammates`, `_buildScores`, `_determineWinner`, `_checkWinCondition`.

### Client: Svelte stores as shared state

All application state lives in two store modules:
- `client/src/stores/game.js` — player identity, lobby state, scores, ammo, BLE connection
- `client/src/stores/map.js` — GPS position, teammate/enemy positions, power-up locations

`App.svelte` is a minimal screen router driven by the `screen` store (`'setup' | 'lobby' | 'ingame' | 'end'`).

`client/src/lib/network.js` is the WebSocket client. It exports typed `send*` functions and a `_handle` dispatcher that updates stores from incoming messages.

### Shared protocol

`shared/messages.js` exports all WebSocket message type constants (`C2S`, `S2C`), enums (`GAME_STATES`, `GAME_MODES`, `TEAMS`, `POWERUP_TYPES`). Both server and client import from this file — the Vite alias `$shared` maps to the `shared/` directory.

### Adding a game mode

1. Create `server/modes/MyMode.js` extending `BaseMode`, implementing the four required methods.
2. Add a constant to `GAME_MODES` in `shared/messages.js`.
3. Import and instantiate in `GameManager._startGame()`.
4. Add an `<option>` in `client/src/screens/Lobby.svelte`.
