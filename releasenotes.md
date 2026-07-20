# Release Notes

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
