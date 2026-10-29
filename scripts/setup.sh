#!/usr/bin/env bash
# Set up a local MeCoil environment: the Node server, the Svelte web client,
# HTTPS certs for phones, and optionally the Android app.
#
# System tools (Node.js, mkcert, uv, Docker, ...) are not installed here; set up
# your machine with https://github.com/rengelen85/dev-setup first.
#
#   scripts/setup.sh                server + web client + HTTPS certs
#   scripts/setup.sh --android      also JDK 17, Android SDK/NDK and mobile/ deps
#   scripts/setup.sh --android-sdk  only JDK 17 and the Android SDK/NDK (what `make mobile-prereqs` runs)
#   scripts/setup.sh --avd          only create the Pixel_6_API_36 emulator (run --android first)
#   scripts/setup.sh --android-env  only add ANDROID_HOME to your shell rc file
#
# Supports Ubuntu/Debian (apt) and macOS (Homebrew). Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."

MIN_NODE_MAJOR=22                # mobile/ needs Node >= 22.11; the server alone needs 20
ANDROID_CMDLINE_BUILD=13114758   # from https://developer.android.com/studio#command-line-tools-only
NDK_VERSION=27.1.12297006        # must match mobile/android/build.gradle
AVD_NAME=Pixel_6_API_36
DEV_SETUP_URL=https://github.com/rengelen85/dev-setup

WITH_ANDROID=0
ONLY_ANDROID_SDK=0
ONLY_AVD=0
ONLY_ANDROID_ENV=0
for arg in "$@"; do
  case "$arg" in
    --android) WITH_ANDROID=1 ;;
    --android-sdk) ONLY_ANDROID_SDK=1 ;;
    --avd) ONLY_AVD=1 ;;
    --android-env) ONLY_ANDROID_ENV=1 ;;
    -h | --help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

case "$(uname -s)" in
  Darwin)
    PKG=brew
    SDK_DIR="$HOME/Library/Android/sdk"
    SHELL_RC="$HOME/.zshrc"
    CMDLINE_ZIP="commandlinetools-mac-${ANDROID_CMDLINE_BUILD}_latest.zip"
    have brew || { echo "Homebrew is required: https://brew.sh" >&2; exit 1; }
    ;;
  Linux)
    PKG=apt
    SDK_DIR="$HOME/Android/Sdk"
    SHELL_RC="$HOME/.bashrc"
    CMDLINE_ZIP="commandlinetools-linux-${ANDROID_CMDLINE_BUILD}_latest.zip"
    have apt-get || { echo "Only apt-based Linux (Ubuntu/Debian) is supported." >&2; exit 1; }
    ;;
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

lan_ip() {
  if [ "$PKG" = brew ]; then
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

# Homebrew's JDK is keg-only, so it is not on PATH; sdkmanager and avdmanager need it.
export_java_home() {
  if [ "$PKG" = brew ]; then
    JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
    export JAVA_HOME
  fi
}

accept_android_licenses() {
  yes | "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
}

write_android_env() {
  if grep -q "# ANDROID SDK START" "$SHELL_RC" 2>/dev/null; then
    log "Android SDK variables already set in $SHELL_RC, skipping"
    return
  fi

  log "Adding Android SDK variables to $SHELL_RC"
  local java_line=""
  if [ "$PKG" = brew ]; then
    export_java_home
    java_line="export JAVA_HOME=\"$JAVA_HOME\""
  fi
  cat >>"$SHELL_RC" <<EOF

# ANDROID SDK START
export ANDROID_HOME="$SDK_DIR"
export PATH="\$PATH:\$ANDROID_HOME/emulator:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/cmdline-tools/latest/bin"
$java_line
# ANDROID SDK END
EOF
}

setup_android_sdk() {
  log "Installing JDK 17 and Android build dependencies"
  if [ "$PKG" = brew ]; then
    brew install openjdk@17
  else
    sudo apt-get install -y openjdk-17-jdk libpulse0 unzip
  fi
  export_java_home

  local sdkmanager="$SDK_DIR/cmdline-tools/latest/bin/sdkmanager"
  if [ ! -x "$sdkmanager" ]; then
    log "Installing Android SDK command-line tools into $SDK_DIR"
    local tmp
    tmp="$(mktemp -d)"
    curl -fL -o "$tmp/tools.zip" "https://dl.google.com/android/repository/$CMDLINE_ZIP"
    mkdir -p "$SDK_DIR/cmdline-tools"
    unzip -q "$tmp/tools.zip" -d "$SDK_DIR/cmdline-tools"
    rm -rf "$SDK_DIR/cmdline-tools/latest"
    mv "$SDK_DIR/cmdline-tools/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
    rm -rf "$tmp"
  fi

  log "Accepting SDK licenses and installing platform tools, API 36, NDK and CMake"
  accept_android_licenses
  "$sdkmanager" --install \
    "platform-tools" "emulator" "platforms;android-36" \
    "ndk;$NDK_VERSION" "cmake;3.22.1"

  write_android_env
}

setup_avd() {
  local bin="$SDK_DIR/cmdline-tools/latest/bin"
  if [ ! -x "$bin/avdmanager" ]; then
    echo "avdmanager not found in $bin. Run scripts/setup.sh --android first." >&2
    exit 1
  fi
  export_java_home

  if [ -d "$HOME/.android/avd/$AVD_NAME.avd" ]; then
    log "AVD $AVD_NAME already exists, skipping"
  else
    local abi=x86_64
    case "$(uname -m)" in arm64 | aarch64) abi=arm64-v8a ;; esac
    local image="system-images;android-36;google_apis;$abi"
    log "Creating AVD $AVD_NAME ($image)"
    accept_android_licenses
    "$bin/sdkmanager" --install "$image"
    echo no | "$bin/avdmanager" create avd --name "$AVD_NAME" --package "$image" --device pixel_6
  fi

  if [ "$PKG" = apt ]; then
    log "Granting /dev/kvm access to $USER (requires sudo)"
    sudo adduser "$USER" kvm 2>/dev/null || true
    sudo chmod 666 /dev/kvm 2>/dev/null || echo "WARNING: could not chmod /dev/kvm (may not exist yet)"
    echo "You may need to log out and back in for the kvm group change to take effect."
  fi
}

if [ "$ONLY_AVD" = 1 ]; then
  setup_avd
  exit 0
fi
if [ "$ONLY_ANDROID_ENV" = 1 ]; then
  write_android_env
  exit 0
fi
if [ "$ONLY_ANDROID_SDK" = 1 ]; then
  setup_android_sdk
  log "Android SDK installed. Open a new shell (or run: source $SHELL_RC) for ANDROID_HOME to take effect"
  exit 0
fi

require_tools

log "Installing server and web client dependencies"
npm install
npm install --prefix client

setup_certs

if [ "$WITH_ANDROID" = 1 ]; then
  setup_android_sdk
  log "Installing mobile/ dependencies"
  npm install --prefix mobile
fi

log "Setup complete"
echo "Start the server and web client with:  make dev   (or npm run dev)"
echo "Then open https://localhost:5173 in Chrome."
if [ "$WITH_ANDROID" = 1 ]; then
  echo "Open a new shell (or run: source $SHELL_RC), then: make android-run"
fi
echo "Phones also need the mkcert root CA; see the 'Playing From a Phone' section of the README."
