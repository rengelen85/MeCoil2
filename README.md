# MeCoil

Open-source self-hosted laser tag game server for **Goliath Recoil** BLE hardware. The original vendor app is discontinued. MeCoil replaces it entirely with a web-based server that runs on any machine on your local network, including a Raspberry Pi.

Players connect from the browser on their phones. No app to install. A full native mobile app will follow later.

---

## Hardware

- **Goliath Recoil** laser tag guns (model SRG-series, sold under the "Recoil" brand)
- A smartphone
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
make lint           # lint JS/TS/Svelte sources (Biome)
make fmt            # auto-format JS/TS/Svelte sources (Biome)
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
npm run lint          # lint JS/TS/Svelte sources (Biome)
npm run fmt           # auto-format JS/TS/Svelte sources (Biome)
```

### Android Mobile App (React Native)

A native Android app is available in the `mobile/` directory. It is a pure client: on the Setup screen the player enters the IP address or hostname of a MeCoil server (the same server the web client uses) and connects. The app does not run its own server.

**Prerequisites:**

- Android Studio (latest stable, or matching your Android API 36 SDK version)
- Java Development Kit (JDK) 17+
- Android SDK API 36 (`android/build.gradle` → `compileSdkVersion`)
- Android NDK **27.1.12297006** — **must match the pinned version** in `android/build.gradle` → `ndkVersion`. Other NDK versions may cause build failures.
- `ANDROID_HOME` environment variable pointing to your Android SDK root (e.g., `C:\Users\...\AppData\Local\Android\Sdk`), or create `mobile/android/local.properties` with `sdk.dir=<path>`

**Build & install:**

```sh
cd mobile
npm install
npm run android      # build + deploy to connected device/emulator
npm run start        # Metro bundler only (for development)
```

**Troubleshooting:**

- **`[CXX1214] User has minSdkVersion 22 but library was built for 24`**: This misleading error usually indicates a **corrupt/incomplete NDK install**. Check `%LOCALAPPDATA%\Android\Sdk\ndk\27.1.12297006\meta\platforms.json` — if it doesn't exist or the folder is small (<1 GB), reinstall the NDK:

  ```sh
  %LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat --install "ndk;27.1.12297006"
  ```

  Then run `npm run android` again.

- **`ANDROID_HOME` pointing to wrong location**: Ensure it's the SDK root (`Sdk/`), not a subdirectory like `Sdk/platform-tools/`. Or create `mobile/android/local.properties` with the correct path.

- **CMake/prefab parse errors**: Run the clean script to wipe stale caches:
  - **Linux/macOS**: `make android-clean`
  - **Windows**: `powershell -ExecutionPolicy Bypass -File mobile\android-clean.ps1`

- **`ninja: error: mkdir(…): No such file or directory`** (Windows only): This occurs when the C++ native module build path exceeds Windows' 260-character `MAX_PATH` limit. The repo root path is too long when combined with deep `node_modules/` nesting and generated object-file directories.

  **Fix**:
  1. **Enable Windows long-path support** (requires admin):

     ```powershell
     # Run as Administrator
     New-Item -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -Type DWord -Force
     ```

  2. **Replace the SDK's ninja with a long-path-aware version** (v1.12.1+):

     ```powershell
     # Download ninja 1.12.1 from https://github.com/ninja-build/ninja/releases
     # and replace: %LOCALAPPDATA%\Android\Sdk\cmake\3.22.1\bin\ninja.exe
     ```

  3. Clean and rebuild:

     ```sh
     powershell -ExecutionPolicy Bypass -File mobile\android-clean.ps1
     npm run android
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

## Cloud Deployment (AWS)

Run a public game server on a small, secured, cost-optimized AWS instance using the
Infrastructure-as-Code in [`infra/`](infra/) — AWS CDK (Python) + Ansible + Make targets.

- A single **EC2 `t4g.micro`** (Graviton, Amazon Linux 2023) with **Caddy** terminating
  TLS and reverse-proxying to the Node server (`localhost:3000`).
- **Locked down:** only ports 80/443 are public; SSH (22) is restricted to one source IP.
  The SSH key is generated into **AWS Secrets Manager** — never stored in the repo.
- **Stable Elastic IP**, optional **Route53 A-record + Let's Encrypt** certificate.
- **Auto-stops after 4 hours** to keep costs near zero (the game server itself runs
  endlessly while the instance is up). Rough cost **≈ $5–11/month**.

```sh
cp infra/aws.env.example infra/aws.env   # set AWS_REGION + SSH_ALLOWED_IP
export AWS_ACCESS_KEY_ID=...             # AWS creds come from your shell, not the repo
export AWS_SECRET_ACCESS_KEY=...

make aws-prereqs        # one-time: CDK Python env + Ansible
make aws-bootstrap      # one-time per account/region
make aws-up             # deploy infra + configure the server

make ssh                # shell in (key pulled from Secrets Manager)
make aws-start          # restart after the 4h auto-stop
make aws-stop           # stop now
make aws-destroy        # tear it all down
```

See [`infra/README.md`](infra/README.md) for full details, cost breakdown, and how to
enable the friendly domain + Let's Encrypt certificate.

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
| **Domination** | Red vs Blue objective mode: capture and hold three GPS-placed zones (A, B, C) to score points over time. First team to the point limit wins. Includes optional deathstreak power-up rewards for the losing team |
| **Infection** | Asymmetric survival: one random player starts infected and must tag survivors. Non-infected shots are ignored. Survivors win if they survive the timer; infected win if everyone is tagged. Only immunity power-ups spawn (one immunity absorbs a shot and grants a 20-second grace period) |

#### Capture the Flag Details

- **Setup**: Host sets red and blue base locations on the lobby screen using their GPS position (one base per team)
- **Objective**: Carry the enemy flag and touch your own base to capture it
- **Flag mechanics**: Flags are automatically picked up when you enter a 10m radius of the enemy flag, dropped when killed, and auto-returned to base if a teammate steps on them
- **Respawn**: Location-based — walk back to your own base (marked as a 15m circle on the map) to respawn, no timer
- **Scoring**: Each successful capture increments your team's score; the HUD displays a red vs blue capture score bar
- **Map display**: Colored base circles mark each team's base; flag icons change state (🚩 at base/dropped, 🏃 carried)

#### Domination Details

- **Setup**: Host walks to each of the three zone locations (A, B, C) and taps to set them by GPS. A and C are typically team-side zones; B is the contested center zone. Zones can be placed anywhere on the map
- **Objective**: Capture and hold zones to earn points for your team every scoring tick (default 2 seconds). Points per tick = number of fully owned zones
- **Capture mechanics**: Stand inside a zone's 15-metre radius to start capturing. Progress increases at 5% per second per player (20 seconds to fully capture with 1 player; faster with teammates). If both teams are present in a zone, it is **contested** and progress is frozen. An enemy zone must first be **neutralized** (pushed back to neutral) before it can be captured for your team
- **Scoring**: Each fully owned zone adds 1 point to your team per scoring tick. Configurable scoring tick interval (default 2 s) and point limit (default 1000)
- **Win condition**: First team to reach the point limit wins. If the timer runs out first, the team with the highest score wins
- **Respawn**: Standard timer-based respawn (configurable, default 10 s). Head to a friendly zone after respawning
- **Deathstreak** (optional): When enabled, a player who is killed N times in a row (configurable, default 3) and whose team is behind will receive a random power-up on respawn (health pack, shield, radar, or fast reload). Can be toggled and tuned by the host in the lobby
- **Map display**: Each zone appears as a colored circle (red / blue / grey for neutral) with the zone letter (A / B / C), a progress bar, and a ⚡ indicator when contested
- **HUD bar**: Shows `RED <score> [A][B][C] BLUE <score>` — zone tiles are colored by owner and show capture-progress fill

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
| **Fast Reload** | 🔋 | When reloading, instantly refill player's magazine without any delay for 2 minutes |
| **Health Pack** | 🩹 | Restores the player's health to full HP |
| **Shield** | 🛡️ | Halves inflicted damage for 2 minutes. After respawning each player also receives a shield for 20 seconds |
| **Stealth** | 👻 | Hides player from enemy maps for 2 minutes |
| **Radar** | 📡 | Reveals **every** living enemy on your map for 1 minute (even stealthed ones) |
| **Airstrike** | 🚀 | Held until player calls it in: arm it, tap a spot on the map, and after a short warning everyone in the blast radius is killed. All players see an **INCOMING AIRSTRIKE** alert with a countdown and must clear the zone |
| **Apache Support** | 🚁 | Held until player calls it in: arm it, tap a spot on the map to place a 25-metre support zone. All enemy players inside take 10 HP damage every 2 seconds for 1 minute. All players see an **APACHE ZONE ACTIVE** countdown warning |

> Airstrikes and Apache zones respect the friendly-fire setting — with it off, teammates (and the caller) are spared from damage.

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
| Power button | Cycle through SEMI → BURST → AUTO → PLASMA |
| On-screen button | Tap the mode badge in the HUD to cycle (same as power button) |

The current mode is displayed as a colored badge in the bottom-left HUD (`SEMI`, `BURST`, `AUTO`, or `PLASMA`). Each mode has different firing behavior and damage characteristics.

### BLE Gun Pairing

1. Power on the Goliath Recoil gun (hold trigger until it buzzes).
2. On the **Setup** screen, tap **Connect gun** and select your gun (`SRG-…`) from the browser's Bluetooth picker.
3. If you forget to pair on Setup, a **Connect gun** button is also available in the in-game HUD.
4. Once a game starts the server assigns your gun a slot ID, and your gun is configured with the weapon profile automatically.

**Requirements**: Chrome or Edge on Android, over HTTPS. iOS is not supported.

**Mid-game gun disconnection (Android app)**: If the gun's BLE link drops during a match, a centered **⚠ GUN DISCONNECTED** warning appears and the app automatically retries the connection (reconnecting to the same gun, falling back to a scan). A **Reconnect** button on the warning lets the player retry manually. On reconnect the gun's weapon slot is re-armed automatically, so play continues without rejoining.

### Host Controls

- **Force Start**: skips the ready-up wait and starts immediately (host only, in lobby)
- **End Game**: opens the score overlay (⊞ button) to reveal the **End Game** button — ends the match and returns everyone to the end screen

### WiFi Drop Management

When a player's WiFi drops, the client automatically reconnects with exponential backoff (1s → 2s → 4s … 15s max). While reconnecting, a spinner overlay appears but gameplay continues in the background — the server holds the player's session for **90 seconds**, preserving their **team assignment, health, ammo, held power-ups (airstrikes/apaches), active buffs (shield/stealth/radar), and all stats (kills/deaths)**.

On reconnect success, the player is restored to the game instantly, maintaining the same team and game state as if the disconnect never happened. If reconnection fails after exhausting retries, they fall back to re-registering as a new player. BLE state is unaffected by the disconnect.

---

## Project Structure

```text
MeCoil/
├── server/           # Node.js game server and game modes
├── client/           # Vite + Svelte web client
├── mobile/           # React Native Android app (client only)
│   ├── src/          # React Native screens and components
│   └── android/      # Android-specific build config (Gradle)
├── shared/           # Shared protocol constants
├── docs/             # Hardware protocol documentation
├── certs/            # HTTPS certificates (gitignored)
├── Makefile          # Linux/macOS task runner
├── biome.json        # Biome linter and formatter configuration
├── package.json      # Root package dependencies
├── package-lock.json # Dependency lock file
├── README.md         # This file
└── releasenotes.md   # Version history and changelog
```

---

## Configuration

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
| `deployApache` | `{ lat, lng }` | Call in a held Apache support zone at a map point |

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
| `apacheActive` | `{ id, lat, lng, radius, endsAt, by }` | An Apache support zone is deployed — enemies inside take periodic damage until `endsAt` |
| `apacheExpired` | `{ id }` | An Apache support zone expired and is no longer active |
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
5. If a native mobile app exists, also add the mode to `mobile/src/screens/LobbyScreen.tsx` (add the `<option>`). The mobile app is a pure client and shares the root `shared/messages.js`, so no separate copy needs to be kept in sync.

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
