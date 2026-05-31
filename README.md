# MeCoil

Open-source self-hosted laser tag game server for **Goliath Recoil** BLE hardware. The original vendor app is discontinued — MeCoil replaces it entirely with a web-based server that runs on any machine on your local network, including a Raspberry Pi.

Players connect from the browser on their phones. No app to install.

---

## Hardware

- **Goliath Recoil** laser tag guns (model SRG-series, sold under the "Recoil" brand)
- A machine to run the server — a laptop, desktop, or Raspberry Pi on the same WiFi

**BLE gun support**: Chrome or Edge on Android only. iOS is blocked at the browser level and is not supported for gun pairing. iOS players can still join and play using the built-in keyboard simulator (or physical keyboard on a desktop).

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| mkcert | any | For HTTPS — required for BLE and GPS on phones |

**Install mkcert:**
- macOS: `brew install mkcert`
- Linux: `apt install libnss3-tools && brew install mkcert` or download from [github.com/FiloSottile/mkcert](https://github.com/FiloSottile/mkcert)
- Windows: `winget install mkcert`

---

## Quick Start

### Linux / macOS (Makefile)

```sh
make install        # install dependencies + create certs/ dir
make gen-certs      # generate local HTTPS certs (one-time)
make dev            # start server + Vite dev client
```

Then open `https://localhost:5173` in Chrome.

### Windows (PowerShell)

```powershell
# One-time: allow local scripts
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

.\tasks.ps1 install      # install dependencies + create certs/ dir
.\tasks.ps1 gen-certs    # generate local HTTPS certs (one-time)
.\tasks.ps1 dev          # start server + Vite dev client
```

Then open `https://localhost:5173` in Chrome.

### npm scripts directly

```sh
npm install && npm install --prefix client
npm run dev           # server + client together (requires concurrently)
npm run dev:server    # server only (port 3000)
npm run dev:client    # Vite client only (port 5173)
npm run build         # build client for production
npm start             # production server (serves built client)
```

---

## Playing From a Phone

BLE, GPS, and the device compass all require HTTPS. The `gen-certs` step above generates a locally-trusted cert via mkcert, but phones also need to trust the mkcert root certificate authority.

**One-time phone setup (do this once per device):**

1. On the machine running the server, run:
   ```sh
   mkcert -CAROOT
   ```
   This prints the folder where `rootCA.pem` lives.

2. Transfer `rootCA.pem` to the phone (AirDrop, USB, email, etc.).

3. Install it:
   - **Android**: Settings → Security → Install certificate → CA certificate
   - **iOS**: Settings → General → VPN & Device Management → install the profile, then enable it under Certificate Trust Settings

4. Start the server. The terminal prints a **Network** address, e.g. `https://192.168.1.42:3000`. Open that address in Chrome on the phone.

> For development with the Vite dev server (port 5173), use `https://192.168.1.42:5173` instead.

---

## Production / Raspberry Pi Deployment

```sh
# On the Pi
git clone <this-repo>
cd MeCoil
npm install && npm install --prefix client
npm run gen-certs   # include the Pi's IP or hostname
npm run build
npm start
```

To run the server on startup, use PM2:

```sh
npm install -g pm2
pm2 start "npm start" --name mecoil
pm2 save
pm2 startup   # follow the printed instructions
```

For mDNS hostname (`mecoil.local`), install `avahi-daemon` on Raspberry Pi OS — it is usually pre-installed. Generate certs including that hostname:

```sh
mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 127.0.0.1 mecoil.local $(hostname -I | awk '{print $1}')
```

---

## How to Play

### Screens

| Screen | Description |
|--------|-------------|
| **Setup** | Enter a callsign, optionally pair a BLE gun |
| **Lobby** | Wait for players, configure the game (host only), ready up |
| **In Game** | Live GPS map, ammo bar, kill feed, timer |
| **End Screen** | Final scores, back to lobby for another round |

### Game Modes

| Mode | Description |
|------|-------------|
| **Free for All (FFA)** | Every player for themselves, highest kills wins |
| **Team Deathmatch (TDM)** | Red vs Blue, auto-balanced teams |

### Controls

The **keyboard simulator** lets you play without a physical gun, useful for testing:

| Key | Action |
|-----|--------|
| `T` | Fire |
| `R` | Reload |
| `H` | Simulate being hit |

### BLE Gun Pairing

1. Power on the Goliath Recoil gun (hold trigger until it buzzes).
2. On the **Setup** screen, tap **Connect gun** and select your gun (`SRG-…`) from the browser's Bluetooth picker.
3. If you forget to pair on Setup, a **Connect gun** button is also available in the in-game HUD.
4. Once a game starts the server assigns your gun a slot ID, and your gun is configured with the weapon profile automatically.

**Requirements**: Chrome or Edge on Android, over HTTPS. iOS is not supported.

### Host Controls

- **Force Start**: skips the ready-up wait and starts immediately (host only, in lobby)
- **End Game**: opens the score overlay (⊞ button) to reveal the **End Game** button — ends the match and returns everyone to the end screen

---

## Project Structure

```
MeCoil/
├── server/
│   ├── index.js              # Express + WebSocket server, HTTPS auto-detection
│   ├── GameManager.js        # State machine: lobby → countdown → playing → end
│   ├── Player.js             # Per-player model (kills, deaths, position, BLE slot)
│   ├── PowerupManager.js     # Spawns and tracks map power-ups
│   └── modes/
│       ├── BaseMode.js       # Shared: timer, kill feed, position broadcast, power-ups
│       ├── FFA.js            # Free for All win condition
│       └── TeamDeathmatch.js # Team scoring and win condition
├── client/
│   ├── src/
│   │   ├── App.svelte        # Screen router
│   │   ├── screens/          # Setup, Lobby, InGame, EndScreen
│   │   ├── components/       # Map, ScoreBoard, KillFeed, AmmoBar
│   │   ├── lib/
│   │   │   ├── ble.js        # Web Bluetooth wrapper (connect, fire, reload, hit)
│   │   │   ├── recoilweapon.js  # Low-level Goliath BLE driver (ported from Scope project)
│   │   │   ├── simulator.js  # Keyboard gun simulator
│   │   │   └── network.js    # WebSocket client and message dispatcher
│   │   └── stores/
│   │       ├── game.js       # Svelte stores: screen, players, scores, ammo, BLE state
│   │       └── map.js        # GPS position, teammate/enemy positions, compass heading
│   └── vite.config.js        # HTTPS auto-detection, WebSocket proxy
├── shared/
│   └── messages.js           # WebSocket message type constants (server + client)
├── config/
│   ├── game.json             # Game defaults (time limit, weapon, etc.)
│   └── weapons/
│       ├── rk-45.json        # Weapon profile: fire rate, IR power, motor, flash
│       └── pistol.json
├── certs/                    # mkcert output (gitignored)
├── Makefile                  # Linux/macOS task runner
└── tasks.ps1                 # Windows PowerShell task runner
```

---

## Configuration

### `config/game.json`

```json
{
  "startOnReady": true,
  "preStartCooldown": 5000,
  "gameTimeMins": 7,
  "defaultWeapon": "rk-45"
}
```

### `config/weapons/*.json`

Weapon profiles configure the physical gun behaviour over BLE. Each field maps to a byte in the 12-byte Config characteristic payload sent to the gun.

```json
{
  "triggerMode": 254,
  "rateOfFire": 0,
  "narrowIrPower": 80,
  "wideIrPower": 0,
  "muzzleLedPower": 255,
  "motorPower": 18,
  "muzzleFlashMode": 0,
  "flashParam2": 3
}
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NO_HTTPS` | — | Set to `1` to force plain HTTP even when certs exist |

---

## WebSocket Protocol

All messages are JSON with a `type` field. Constants live in `shared/messages.js`.

### Client → Server

| Type | Payload | Description |
|------|---------|-------------|
| `join` | `{ username }` | Enter the lobby |
| `ready` | `{ ready: bool }` | Toggle ready state |
| `gameConfig` | `{ mode, timeLimit, scoreLimit }` | Host updates settings |
| `startGame` | — | Host force-starts |
| `stopGame` | — | Host ends a running game |
| `position` | `{ lat, lng }` | GPS update (~1/sec) |
| `fire` | `{ lat, lng }` | Trigger pressed — makes player visible to enemies for 3s |
| `hit` | `{ shooterWeaponId }` | IR event received from gun |
| `collect` | `{ powerupId }` | Collect a power-up |

### Server → Client

| Type | Payload | Description |
|------|---------|-------------|
| `joined` | `{ playerId, isHost, lobbyState }` | Join acknowledged |
| `lobbyUpdate` | `{ players, config, hostId, state }` | Lobby state changed |
| `countdown` | `{ startsAt }` | Game starting, timestamp of start |
| `gameStarted` | `{ mode, timeLimit, scoreLimit, gunAssignments }` | Game begins |
| `gameState` | `{ scores, timeRemaining, killFeed }` | Periodic (1/sec) |
| `positions` | `{ teammates, firingEnemies }` | Map update, filtered per player |
| `powerups` | `{ packages }` | Current power-up locations |
| `gameEnded` | `{ finalScores, winner }` | Match over |

---

## Extending

### Adding a game mode

1. Create `server/modes/MyMode.js` extending `BaseMode`:
   ```js
   import { BaseMode } from './BaseMode.js';
   export class MyMode extends BaseMode {
     _areTeammates(a, b) { /* return bool */ }
     _buildScores()      { /* return array */ }
     _determineWinner()  { /* return winner value */ }
     _checkWinCondition(scorer, limit) { /* return bool */ }
   }
   ```
2. Add a constant to `shared/messages.js` → `GAME_MODES`.
3. Import and instantiate in `GameManager._startGame()`.
4. Add a `<option>` for it in `client/src/screens/Lobby.svelte`.

### Adding a weapon profile

Create a new JSON file in `config/weapons/` matching the structure of `rk-45.json`. Reference it by filename (without `.json`) in `config/game.json` → `defaultWeapon`.

---

## Known Limitations

- **iOS**: Web Bluetooth is not available on any iOS browser. iOS players can join and play using the keyboard simulator but cannot pair a physical gun.
- **GPS accuracy**: Depends on device hardware and open-sky visibility. Indoor use will have poor or no positioning.
- **BLE range**: Guns and phones must be within ~10m of each other for IR hit detection.
- **Tile caching**: The map uses OpenStreetMap tiles over the internet. Offline play requires a local tile server or pre-cached tiles.

---

## Credits

BLE driver adapted from the [DroopCat/Scope](https://github.com/DroopCat/Scope) project (`recoilweapon.js`), which reverse-engineered the Goliath Recoil BLE protocol.
