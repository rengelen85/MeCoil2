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
| **In Game** | Live GPS map, ammo bar, kill feed, timer, synthesized sound effects (reload / killed / respawn / airstrike alert) |
| **End Screen** | Final scores, back to lobby for another round |

### Game Modes

| Mode | Description |
|------|-------------|
| **Free for All (FFA)** | Every player for themselves, highest kills wins |
| **Team Deathmatch (TDM)** | Red vs Blue, auto-balanced teams |
| **Capture the Flag (CTF)** | Two-team mode: capture the enemy flag and return it to your base. Bases are set by the host using GPS, flags are picked up automatically when in proximity, and respawn happens by walking back to your own base |
| **Infection** | Asymmetric survival: one random player starts infected and must tag survivors. Non-infected shots are ignored. Survivors win if they survive the timer; infected win if everyone is tagged. Only immunity power-ups spawn (one immunity absorbs a shot and grants a 20-second grace period) |

#### Capture the Flag Details

- **Setup**: Host sets red and blue base locations on the lobby screen using their GPS position (one base per team)
- **Objective**: Carry the enemy flag and touch your own base to capture it
- **Flag mechanics**: Flags are automatically picked up when you enter a 10m radius of the enemy flag, dropped when killed, and auto-returned to base if a teammate steps on them
- **Respawn**: Location-based — walk back to your own base (marked as a 15m circle on the map) to respawn, no timer
- **Scoring**: Each successful capture increments your team's score; the HUD displays a red vs blue capture score bar
- **Map display**: Colored base circles mark each team's base; flag icons change state (🚩 at base, 🏃 carried, 📍 dropped)

#### Infection Details

- **Setup**: One random player starts as "Patient Zero" (infected), all others are survivors
- **Objective**: Infected players must tag all survivors by hitting them; survivors must avoid infection until time runs out
- **Combat mechanics**: Only infected players can deal damage; survivor shots are completely ignored by the server. All players are always visible on the map
- **Immunity**: The only power-up that spawns is immunity (💉). One immunity token absorbs a single shot and grants a 20-second grace period to evade re-infection. Survivors' guns are locked (🔒 GUN LOCKED badge) until they pick up immunity
- **Winning**: Infected team wins if all players are tagged; survivors win if the time limit expires
- **HUD display**: Shows 🧟 INFECTED or 🧍 SURVIVOR status, with 🛡️ IMMUNE indicator when holding an immunity token

### Power-ups

Power-ups spawn periodically around the play area. Walk onto one (or tap it on the map) to collect it.

| Power-up | Icon | Effect |
|----------|------|--------|
| **Full Reload** | 🔋 | Instantly refills your magazine |
| **Health Pack** | 🩹 | Restores you to full HP |
| **Shield** | 🛡️ | Adds bonus HP on top of your max |
| **Stealth** | 👻 | Hides you from enemy maps for 30s |
| **Radar** | 📡 | Reveals **every** living enemy on your map for 1 minute (even stealthed ones) |
| **Airstrike** | 🚀 | Held until you call it in: arm it, tap a spot on the map, and after a short warning everyone in the blast radius is killed. All players see an **INCOMING AIRSTRIKE** alert with a countdown and must clear the zone |

> Airstrikes respect the friendly-fire setting — with it off, teammates (and the caller) inside the blast are spared.

### Controls

The **keyboard simulator** lets you play without a physical gun, useful for testing:

| Key | Action |
|-----|--------|
| `T` | Fire |
| `R` | Reload |
| `H` | Simulate being hit |

### BLE Gun Controls

Once a gun is paired, you can switch fire modes:

| Control | Action |
|---------|--------|
| Power button (back) | Cycle through SEMI → BURST → AUTO → PLASMA |
| On-screen button | Tap the mode badge in the HUD to cycle (same as power button) |

The current mode is displayed as a colored badge in the bottom-left HUD (`SEMI`, `BURST`, `AUTO`, or `PLASMA`). Each mode has different firing behavior and damage characteristics.

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
│       ├── TeamDeathmatch.js # Team scoring and win condition
│       ├── CaptureTheFlag.js # Flag capture with base proximity, location-based respawn
│       └── Infection.js      # Asymmetric survival, infected vs survivors
├── client/
│   ├── src/
│   │   ├── App.svelte        # Screen router
│   │   ├── screens/          # Setup, Lobby, InGame, EndScreen
│   │   ├── components/       # Map, ScoreBoard, KillFeed, AmmoBar
│   │   ├── lib/
│   │   │   ├── ble.js        # Web Bluetooth wrapper (connect, fire, reload, hit)
│   │   │   ├── recoilweapon.js  # Low-level Goliath BLE driver (ported from Scope project)
│   │   │   ├── simulator.js  # Keyboard gun simulator
│   │   │   ├── audio.js      # Synthesized sound effects (Web Audio, no assets)
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
| `deployAirstrike` | `{ lat, lng }` | Call in a held airstrike at a map point |

### Server → Client

| Type | Payload | Description |
|------|---------|-------------|
| `joined` | `{ playerId, isHost, lobbyState }` | Join acknowledged |
| `lobbyUpdate` | `{ players, config, hostId, state }` | Lobby state changed |
| `countdown` | `{ startsAt }` | Game starting, timestamp of start |
| `gameStarted` | `{ mode, timeLimit, scoreLimit, gunAssignments }` | Game begins |
| `gameState` | `{ scores, timeRemaining, killFeed }` | Periodic (1/sec) |
| `positions` | `{ teammates, firingEnemies }` | Map update, filtered per player (radar reveals all living enemies) |
| `powerups` | `{ packages }` | Current power-up locations |
| `airstrikeIncoming` | `{ id, lat, lng, radius, detonateAt, by }` | An airstrike is inbound — evacuate before `detonateAt` |
| `airstrikeHit` | `{ id, lat, lng, radius }` | An airstrike detonated (drives the blast FX) |
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

## Documentation

Hardware protocol references are in [docs/](docs/):

| File | Description |
|------|-------------|
| [docs/recoil_protocol_BLE.md](docs/recoil_protocol_BLE.md) | Goliath Recoil BLE service/characteristic layout (ID, Telemetry, Control, Config) |
| [docs/recoil_protocol_IR.md](docs/recoil_protocol_IR.md) | IR packet format, encoding, grenade protocol (MAN20A / NEC4) |
| [docs/recoil_gun_firmware_config_guide.md](docs/recoil_gun_firmware_config_guide.md) | RecoilGun firmware configuration guide (weapon config parameters, firmware behavior) |

---

## Credits

BLE driver adapted from the [DroopCat/Scope](https://github.com/DroopCat/Scope) project (`recoilweapon.js`), which reverse-engineered the Goliath Recoil BLE protocol.
