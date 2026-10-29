#!/usr/bin/env bash
# Set up a local MeCoil environment: the Node server, the Svelte web client,
# HTTPS certs for phones, and optionally the Android app.
#
# System tools (Node.js, mkcert, uv, Docker, JDK, Android SDK, ...) are not
# installed here; set up your machine with https://github.com/rengelen85/dev-setup first.
#
#   scripts/setup.sh                server + web client + HTTPS certs
#   scripts/setup.sh --android      also the pinned Android SDK packages (API 36, NDK, CMake) and mobile/ deps
#   scripts/setup.sh --android-sdk  only the pinned Android SDK packages (what `make mobile-prereqs` runs)
#   scripts/setup.sh --avd          only create the Pixel_6_API_36 emulator
#
# Supports Linux and macOS. Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."

MIN_NODE_MAJOR=22                # mobile/ needs Node >= 22.11; the server alone needs 20
NDK_VERSION=27.1.12297006        # must match mobile/android/build.gradle
AVD_NAME=Pixel_6_API_36
DEV_SETUP_URL=https://github.com/rengelen85/dev-setup

WITH_ANDROID=0
ONLY_ANDROID_SDK=0
ONLY_AVD=0
for arg in "$@"; do
  case "$arg" in
    --android) WITH_ANDROID=1 ;;
    --android-sdk) ONLY_ANDROID_SDK=1 ;;
    --avd) ONLY_AVD=1 ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

case "$(uname -s)" in
  Darwin | Linux) ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

node_major() { node -p 'process.versions.node.split(".")[0]'; }

require_tools() {
  local missing=()
  if ! have node || [ "$(node_major)" -lt "$MIN_NODE_MAJOR" ]; then
    missing+=("Node.js >= $MIN_NODE_MAJOR")
  fi
  have mkcert || missing+=("mkcert")
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "Missing: ${missing[*]}" >&2
    echo "Set up your machine with $DEV_SETUP_URL, open a new shell and re-run this script." >&2
    exit 1
  fi
  log "Node $(node -v), npm $(npm -v) and mkcert found"
}

# Prints the sdkmanager/avdmanager directory, or exits when the SDK is missing.
android_bin() {
  local bin="${ANDROID_HOME:-}/cmdline-tools/latest/bin"
  if [ -z "${ANDROID_HOME:-}" ] || [ ! -x "$bin/sdkmanager" ]; then
    echo "Android SDK not found (ANDROID_HOME is not set or has no sdkmanager)." >&2
    echo "Install it with $DEV_SETUP_URL (./install.sh android), open a new shell and re-run this script." >&2
    exit 1
  fi
  echo "$bin"
}

lan_ip() {
  if [ "$(uname -s)" = Darwin ]; then
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
  else
    hostname -I 2>/dev/null | awk '{print $1}' || true
  fi
}

setup_certs() {
  if [ -f certs/cert.pem ] && [ -f certs/key.pem ]; then
    log "HTTPS certs already exist in certs/, skipping"
    return
  fi

  # Adds the mkcert root CA to this machine's trust stores (may ask for sudo).
  log "Generating HTTPS certs"
  mkcert -install
  mkdir -p certs
  local ip
  ip="$(lan_ip)"
  mkcert -cert-file certs/cert.pem -key-file certs/key.pem \
    localhost 127.0.0.1 mecoil.local ${ip:+"$ip"}
}

accept_android_licenses() {
  yes | "$1/sdkmanager" --licenses >/dev/null 2>&1 || true
}

install_android_packages() {
  local bin
  bin="$(android_bin)"
  log "Installing Android API 36, NDK $NDK_VERSION and CMake"
  accept_android_licenses "$bin"
  "$bin/sdkmanager" --install "platforms;android-36" "ndk;$NDK_VERSION" "cmake;3.22.1"
}

setup_avd() {
  local bin
  bin="$(android_bin)"

  if [ -d "$HOME/.android/avd/$AVD_NAME.avd" ]; then
    log "AVD $AVD_NAME already exists, skipping"
    return
  fi

  local abi=x86_64
  case "$(uname -m)" in arm64 | aarch64) abi=arm64-v8a ;; esac
  local image="system-images;android-36;google_apis;$abi"
  log "Creating AVD $AVD_NAME ($image)"
  accept_android_licenses "$bin"
  "$bin/sdkmanager" --install "$image"
  echo no | "$bin/avdmanager" create avd --name "$AVD_NAME" --package "$image" --device pixel_6
}

if [ "$ONLY_AVD" = 1 ]; then
  setup_avd
  exit 0
fi
if [ "$ONLY_ANDROID_SDK" = 1 ]; then
  install_android_packages
  exit 0
fi

require_tools
# Check before the npm installs so a missing SDK fails fast.
if [ "$WITH_ANDROID" = 1 ]; then
  android_bin >/dev/null
fi

log "Installing server and web client dependencies"
npm install
npm install --prefix client

setup_certs

if [ "$WITH_ANDROID" = 1 ]; then
  install_android_packages
  log "Installing mobile/ dependencies"
  npm install --prefix mobile
fi

log "Setup complete"
echo "Start the server and web client with:  make dev   (or npm run dev)"
echo "Then open https://localhost:5173 in Chrome."
if [ "$WITH_ANDROID" = 1 ]; then
  echo "Create an emulator with make create-avd, or connect a device, then: make android-run"
fi
echo "Phones also need the mkcert root CA; see the 'Playing From a Phone' section of the README."
