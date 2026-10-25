# Release Notes
## [0.6.4] — 2026-10-25

### Fixed

- **Android app closing on a zombie bite**: AR zombie survival crashed the Android app the first time a zombie bit, because the app was missing the `VIBRATE` permission. The permission is now declared and the bite vibration can no longer crash the game. Web client unaffected (it doesn't need the permission)

## [0.6.3] — 2026-10-25

### Added

- **Connect your gun for AR practice & zombies**: The Android app had no way to connect a gun outside a multiplayer lobby, so the gun couldn't be used in the AR modes. The Setup screen now has a **Connect gun** button (as on web), and the AR intro screen has one in both the web and Android clients

## [0.6.2] — 2026-10-25

### Fixed

- **Muzzle LED flash when shooting**: The gun's muzzle LED now flashes on every shot in semi, burst and auto mode, in both the web and Android clients. The flash mode and its two parameters were written to the gun with their nibbles swapped (the protocol packs the first 4-bit field in the low nibble), so the setting landed on the power LED instead of the muzzle LED. Plasma's glow only seemed to work because of that

## [0.6.1] — 2026-10-25

### Changed

- **Painted zombies in AR zombie survival**: Walkers, runners and brutes are now shaded, generated zombie figures (torn clothes, glowing eyes, wounds) instead of emoji, in both the web and Android clients. They shamble with a two-frame walk cycle, lean the other way at random so a wave doesn't move in lockstep, and the legend on the intro screen shows them too. Near zombies get a red glow and frozen ones a blue glow and hold their pose. The sprites are drawn by `scripts/gen-zombies.mjs`

## [0.6.0] — 2026-10-25

### Added

- **AR zombie survival (single player)**: A second AR practice mode in both the web and Android clients. Pick **🧟 Zombies** on the AR intro screen and waves of zombies walk in towards you through the camera view. Shoot them before they bite; each bite costs a life, and the game lasts until you run out. Every wave brings more and faster zombies, first from in front and later from all sides. Walkers (100 pts), fast zig-zagging runners (150 pts, from wave 2) and 4-hit brutes (400 pts, from wave 3). Headshots do double damage and +50% points, clearing a wave earns a bonus, and edge arrows turn red when a zombie gets close. Easy / Normal / Hard change speed, wave size, lives (5 / 3 / 2) and hit-box size; best scores are kept per difficulty
- **AR power-ups**: During a zombie wave, shootable power-ups float in the air: ❤️ Medkit (+1 life), 💣 Bomb (kills every zombie up) and ❄️ Freeze (zombies stop for 5 seconds)
- New synthesized sounds for a zombie bite and collecting a power-up; on Android (and supporting browsers) a bite also vibrates the phone

### Changed

- The AR entry button on the Setup and Room screens is now **🎯 AR practice & 🧟 zombies**

## [0.5.1] — 2026-10-25

### Added

- **AR target practice difficulty**: Choose **Easy**, **Normal** or **Hard** on the intro screen (web and Android). Easy has bigger, longer-lived, slower targets and fewer at once; Hard has smaller, faster-fading, faster-moving targets and more at once. Point values are unchanged. Best scores are kept per round length and difficulty
- **AR target practice round length**: The intro screen of AR target practice (web and Android) now lets you pick the round length: 30, 60, 90, 120 or 180 seconds. Best scores are kept separately per round length

### Changed

- **AR target practice starts in semi-auto**: A connected gun now begins practice in SEMI instead of AUTO; you can still cycle modes during the round

## [0.5.0] — 2026-10-25

### Added

- **AR target practice (single player)**: A new offline mode in both the web and Android clients, opened from the Setup or Room screen with **🎯 AR target practice**. The rear camera shows the world around you and targets float in it, held in place by the phone's motion sensors. Put the crosshair on a target and pull the trigger. A round lasts 60 seconds: red targets are worth 100 points, moving orange targets 150, and fast-fading gold targets 300. Consecutive hits build a streak bonus of up to double points, and a charged plasma shot hits every target in a wider cone. Off-screen targets are marked with edge arrows, and the results screen shows hits, accuracy, best streak and your local best score
- **No server needed**: Everything (targets, hit detection, scoring, the best score) runs on the phone. With a paired gun, shots are read from its ammo counter; without one, on-screen **FIRE** / **RELOAD** buttons (and `T` / `R` on the web) take over. Fast reload is always on, so reloads refill the magazine instantly. Without motion sensors (e.g. a desktop browser) you aim by dragging
- **Android**: Camera permission plus a small native rotation-vector sensor module (`ArOrientation`) that also keeps the screen on during practice. Adds `react-native-vision-camera` (with `react-native-nitro-modules` / `react-native-nitro-image`), so run `cd mobile && npm install` and rebuild the APK

---

## [0.4.3] — 2026-07-22

### Added

- **Heartbeat / dead-socket watchdog**: Both web and Android clients now detect a WiFi drop immediately (even when the OS doesn't fire a WebSocket `close` event), via a 5-second PING heartbeat and a 12-second stale timeout — no more lingering half-open sockets
- **Manual rejoin button**: Once auto-reconnect exhausts its retries, players see "Connection lost" with a **🔄 Rejoin game** button instead of being dumped to setup — because the session is held for the whole round, tapping it restores all stats and power-ups
- **Whole-round session hold**: The server now keeps a dropped player's session alive for the entire game (not just 90 seconds), so any reconnect during play — automatic or manual — instantly restores team, health, ammo, held airstrikes/apaches, active buffs, and K/D stats
- **App-kill recovery (Android)**: The Android app now persists the player ID across restarts; reconnecting after a full app kill resumes the in-progress session instead of joining as a new player (falls back to fresh registration only once the session truly expires)
- **Live session takeover on REJOIN (server)**: A rejoin now restores the session by room membership rather than requiring the server to have already seen the old socket close, so a reconnect that races ahead of the server noticing the drop takes the session over live (and closes the lingering ghost socket) instead of being rejected
- **Server-side heartbeat sweep**: The server now pings every client every 30 seconds and terminates any that stopped responding, reaping ghost connections left behind by a silent network switch when the player never returns

### Changed

- **WiFi Drop Management (README)**: Clarified the new heartbeat-based detection and whole-round session hold, explaining the manual rejoin flow

### Fixed

- **WiFi AP switch on Android**: Phone switching access points mid-game no longer creates a new player; auto-reconnect now detects the dead socket within seconds and restores the session transparently
- **WiFi↔cellular switch creating a duplicate player**: Switching between WiFi and 5G mid-game left the old TCP connection lingering open on the server (no FIN arrives), so `REJOIN` found no pending session and fell back to a fresh registration — spawning a new/extra player with the same name and losing team, health, held power-ups, buffs and K/D. The rejoin path now takes over the still-active session live, keeping everything intact (server-only fix — no app rebuild needed)

---

## [0.4.2] — 2026-07-22

### Fixed

- **EC2 Docker bootstrap**: The Graviton (arm64) bring-up now installs the Docker **buildx** plugin. Amazon Linux 2023's `docker` package ships no (or too old a) buildx, but `docker compose --build` requires buildx >= 0.17.0, so a fresh box failed to build the image. Both the manual [BOOTSTRAP.md](infra/docker/BOOTSTRAP.md) walk-through and the unattended [ec2-user-data.sh](infra/docker/ec2-user-data.sh) script now fetch the latest buildx release binary into the CLI plugins directory

---

## [0.4.1] — 2026-07-21

### Added

- **Docker deployment**: Multi-stage, multi-arch (amd64 / arm64) image that builds the Svelte client and serves it together with the WebSocket game server from a single Node process on port 3000. Assets live in [infra/docker/](infra/docker/) (`Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example`)
- **Automatic HTTPS via Caddy**: `docker compose` runs the app behind Caddy, which provisions and renews TLS certificates automatically (Let's Encrypt for a real domain, internal CA for `localhost` smoke tests) — required for Web Bluetooth and Geolocation on phones. WebSocket (`/ws`) upgrades pass through transparently
- **Docker make targets** (`Makefile-docker.mk`): `make docker-build`, `make docker-test` (build + health-check smoke test), `make docker-up`, `make docker-down`, plus `make docker-prereqs` and `make config-tools` to install Docker and the config lint/format tools
- **Config lint & format**: The Dockerfile (hadolint), Caddyfile (`caddy validate` / `caddy fmt`), and compose file (Prettier) are now wired into `make lint` and `make fmt`; missing tools degrade to a warning so a plain lint still works
- **Cloud deployment guides**: [infra/docker/README.md](infra/docker/README.md) covers self-hosting on a Synology NAS or ARM EC2 (Graviton), multi-arch build details, and why App Runner / ECS Express Mode were avoided; [infra/docker/BOOTSTRAP.md](infra/docker/BOOTSTRAP.md) is a step-by-step EC2 Graviton bring-up (including a DuckDNS dynamic-DNS updater) with an [ec2-user-data.sh](infra/docker/ec2-user-data.sh) unattended-boot script
- **Docker section in README**: Quick-start instructions for building and running the containerized stack

### Changed

- **`.gitignore`**: Ignore local env and infra secrets (`.env`, `infra/aws.env`, `infra/.ssh/`, `*.pem`, CDK/Ansible artifacts); only the `.env.example` is committed

---

## [0.4.0] — 2026-07-20

### Added

- **Heading compass in Android**: New `Compass` component shows live device heading in the in-game HUD, bottom-right above the health bar
- **Power-up countdown badges in Android**: Shield, stealth, and fast-reload status now render as labeled badges with a live `M:SS` countdown (mirrors the web AmmoBar) instead of static icons
- **APK install make targets**: `apk-debug-install` / `apk-release-install` install an already-built APK via `adb` without rebuilding; `apk-debug` / `apk-release` now run build + install together

### Changed

- **Android map rotation**: Reworked to rotate the whole map view via a GPU-composited, native-driven transform instead of the MapLibre camera bearing, eliminating the lag/stutter from restarting a camera animation on every compass tick. Adds a fading heading cone on the player marker (web parity)
- **Faster multiplayer sync**: Server game-state and position broadcast interval reduced from 500 ms to 200 ms for smoother movement and state updates

### Fixed

- **Fast reload on Android**: The fast-reload power-up now actually skips the reload delay and instantly refills the clip, instead of running the normal reload timer

---

## [0.3.0] — 2026-06-22

### Added

- **Full game customization in Android lobby**: Host can now configure all game options (mode, time limit, respawns, power-ups, team sizes, zone settings) directly from the Android app lobby screen
- **Map previews in Android lobby**: Game host sees a live map preview of the play area, CTF bases, and domination zones while configuring a game
- **OpenStreetMap in Android app**: Replaced Google Maps with key-free OpenStreetMap raster tiles — no API key required, consistent with the web client
- **MapShapes component**: New shared helper for rendering metre-radius circles, polygons, and lines on the MapLibre map
- **BLE gun status overlay in Android**: In-game BLE connection status indicator with error details displayed as an overlay in InGameScreen
- **ScoreBoard component for Android**: Live scoreboard ported from web client to the Android app
- **Recoil weapon logic for Android**: Full `recoilweapon.ts` module ported — fire modes, ammo tracking, reload state
- **MeCoil app icon**: Custom MeCoil logo applied to the Android app launcher icon (all densities)
- **Logo asset and generator**: `mobile/assets/logo.png` and `mobile/scripts/gen_logo.py` for reproducible icon generation
- **Android Makefile**: Extracted Android-specific `make` targets into a separate `Makefile-android.mk` to keep the root Makefile clean

### Changed

- **Android server architecture**: The Android app no longer runs its own embedded Node.js server. It now connects to the same shared web server, simplifying the codebase and removing ~2 400 lines of duplicated server code
- **Android BLE**: Significantly overhauled — improved scanning, connection state machine, per-device deduplication, reconnect logic, and error recovery
- **Smoother map rotation on Android**: GameMap now interpolates compass heading for fluid map turning instead of snapping
- **Android network layer**: Synced with web client — full message handling, ammo/respawn/powerup events, kill feed, and round-state updates
- **Android geo utilities**: Extended `geo.ts` with GeoJSON helpers (circle features, polygon bounds) aligned with web client
- **Visual refresh for Android setup and lobby screens**: Updated layouts, typography, and colour scheme including MeCoil branding on the start screen
- **Visual refresh for Android in-game screen**: Improved HUD layout and map controls
- **Visual refresh for room selection screen**: Cleaner room list card styling

### Fixed

- **BLE connection on Android**: Added missing Bluetooth permission declarations to `AndroidManifest.xml` that were preventing connections on some devices

### Removed

- **Embedded Node.js server for Android**: Removed `mobile/nodejs-assets/nodejs-project/` (GameManager, Player, PowerupManager, RoomManager, BaseMode, FFA, TeamDeathmatch) — the shared web server is used instead
- **`nodejs-mobile-react-native` dependency**: No longer needed now that the Android app connects to the external server

---

## [0.2.0] — 2026-06-20

### Added

- **Domination game mode**: New competitive game type with zone control and cumulative scoring
- **Dark mode map**: Toggle between light and dark map themes
- **Apache Support power-up**: New power-up type joining the existing arsenal
- **Player team display in HUD**: Shows teammate/enemy status in the HUD bar
- **Android APK build automation**: Streamlined APK generation and testing pipeline
- **macOS make targets**: Development setup targets for Android builds on macOS
- **Windows long-path documentation**: Guide for native Android builds on Windows with long-path support
- **Android Studio setup guides**: Installation instructions for Ubuntu and other Linux distributions

### Changed

- **BLE gun connectivity**: Enhanced auto-reconnect logic with improved resilience
- **Game rejoin handling**: Better support for rejoining after temporary disconnects, especially in Domination mode
- **Map controls**: Improved toggle button placement and default map type selection
- **Game timer layout**: Centered timer display for better visual consistency
- **Domination configuration**: Refined zone defaults and scoring parameters

### Fixed

- **Gun slot assignment**: Fixed client-side assumption of gun slot 0 before server assignment
- **Airstrike freezes**: Resolved game freeze issues triggered by airstrike power-up
- **Domination zone radius**: Corrected zone boundary calculations
- **Domination end screen**: Fixed display of final scores on game end
- **Linting issues**: Various code quality improvements

---

## [0.1.0] — 2026-06-10

MeCoil's first stable release — a complete open-source replacement for the discontinued Goliath Recoil vendor app.

### Features

- **Web-based server**: Self-hosted on any machine (laptop, desktop, Raspberry Pi) over local WiFi
- **No app required**: Players connect via browser (Chrome/Edge) on phones
- **BLE gun support**: Full wireless gun integration on Android (iOS unsupported at browser level)
- **Keyboard simulator**: Play without a physical gun — use `T` (fire), `R` (reload), `H` (hit)
- **Four game modes**:
  - **Free for All (FFA)**: Every player for themselves
  - **Team Deathmatch (TDM)**: Red vs Blue with auto-balanced teams
  - **Capture the Flag (CTF)**: Two-team objectives with location-based respawning
  - **Infection**: Asymmetric survival (one infected vs. many survivors)
- **GPS-based gameplay**: Real-world positioning with OpenStreetMap
- **Compass integration**: On-device compass for map rotation
- **Power-up system**: Six power-ups spawning periodically (Fast Reload, Health Pack, Shield, Stealth, Radar, Airstrike)
- **Synthesized sound effects**: No external audio assets — reload, killed, respawn, airstrike alert
- **WiFi resilience**: Auto-reconnect with exponential backoff and 30-second session preservation
- **Host controls**: Force start, end game, per-team base setup (CTF), game configuration
- **HTTPS auto-detection**: Automatic local cert generation (via mkcert) required for BLE and GPS on phones
- **Fire modes**: Semi, Burst, Auto, Plasma selectable via power button or on-screen HUD
- **Kill feed & scoring**: Real-time per-player and team score tracking
- **Live map**: Player positions, teammate/enemy distinction, power-up locations, base circles (CTF), stealth indicators

### Mobile (React Native)

- **In-progress native app** for true P2P: one phone hosts the server, others join over WiFi/hotspot
- **Same game modes and power-ups** as web version
- **On-device Node.js server** via `nodejs-mobile-react-native`
- Android support; iOS planned

### Known Limitations

- **iOS browsers**: Web Bluetooth not supported; keyboard simulator only
- **GPS accuracy**: Depends on device hardware and open-sky visibility; indoor play limited
- **BLE range**: Guns and phones ~10m max
- **Offline maps**: Requires local tile server or pre-cached OpenStreetMap tiles

### Documentation

Hardware protocol references included in `docs/`:

- BLE service/characteristic layout (ID, Telemetry, Control, Config)
- IR packet format and encoding
- Weapon configuration guide

---

## [Unreleased]

### Added

<!-- New features go here -->

### Changed

<!-- Updates to existing features go here -->

### Fixed

<!-- Bug fixes go here -->

### Deprecated

<!-- Deprecations go here -->

### Removed

<!-- Removed features go here -->

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR** version for incompatible API/protocol changes
- **MINOR** version for new features (backwards compatible)
- **PATCH** version for bug fixes (backwards compatible)

Date format: `[X.Y.Z] — YYYY-MM-DD`
