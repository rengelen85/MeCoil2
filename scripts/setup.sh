#!/usr/bin/env bash
# Set up a local MeCoil environment: the Node server, the Svelte web client,
# HTTPS certs for phones, and optionally the Android app.
#
#   scripts/setup.sh             server + web client + HTTPS certs
#   scripts/setup.sh --android   also JDK 17, Android SDK/NDK and mobile/ deps
#   scripts/setup.sh --lint      also install uv (used by `make lint` for Markdown)
#
# Supports Ubuntu/Debian (apt) and macOS (Homebrew). Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."

MIN_NODE_MAJOR=22                # mobile/ needs Node >= 22.11; the server alone needs 20
ANDROID_CMDLINE_BUILD=13114758   # from https://developer.android.com/studio#command-line-tools-only
NDK_VERSION=27.1.12297006        # must match mobile/android/build.gradle

WITH_ANDROID=0
WITH_LINT=0
for arg in "$@"; do
  case "$arg" in
    --android) WITH_ANDROID=1 ;;
    --lint) WITH_LINT=1 ;;
    -h | --help) sed -n '2,8p' "$0"; exit 0 ;;
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

ensure_apt_index() {
  if [ "$PKG" = apt ]; then
    log "Refreshing apt package index and installing base tools"
    sudo apt-get update
    # make is needed for the Makefile targets (make dev, make lint, ...)
    sudo apt-get install -y make curl ca-certificates
  fi
}

ensure_node() {
  if have node && [ "$(node_major)" -ge "$MIN_NODE_MAJOR" ]; then
    log "Node $(node -v) and npm $(npm -v) found"
    return
  fi

  log "Installing Node.js $MIN_NODE_MAJOR"
  if [ "$PKG" = brew ]; then
    brew install node || brew upgrade node
  else
    sudo apt-get install -y curl ca-certificates
    curl -fsSL "https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x" | sudo -E bash -
    sudo apt-get install -y nodejs
  fi

  if ! have node || [ "$(node_major)" -lt "$MIN_NODE_MAJOR" ]; then
    echo "Node $MIN_NODE_MAJOR+ is still not on PATH. Open a new shell and re-run this script." >&2
    exit 1
  fi
}

ensure_mkcert() {
  if have mkcert; then
    log "mkcert found"
    return
  fi

  log "Installing mkcert"
  if [ "$PKG" = brew ]; then
    brew install mkcert
  else
    sudo apt-get install -y mkcert libnss3-tools
  fi
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

ensure_uv() {
  if have uv; then
    log "uv found"
    return
  fi
  log "Installing uv (for make lint / make fmt)"
  curl -LsSf https://astral.sh/uv/install.sh | sh
}

setup_android() {
  log "Installing JDK 17 and Android build dependencies"
  if [ "$PKG" = brew ]; then
    brew install openjdk@17
  else
    sudo apt-get install -y openjdk-17-jdk libpulse0 unzip
  fi

  local java_line=""
  if [ "$PKG" = brew ]; then
    JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
    export JAVA_HOME
    java_line="export JAVA_HOME=\"$JAVA_HOME\""
  fi

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
  yes | "$sdkmanager" --licenses >/dev/null 2>&1 || true
  "$sdkmanager" --install \
    "platform-tools" "emulator" "platforms;android-36" \
    "ndk;$NDK_VERSION" "cmake;3.22.1"

  if ! grep -q "# ANDROID SDK START" "$SHELL_RC" 2>/dev/null; then
    log "Adding Android SDK variables to $SHELL_RC"
    cat >>"$SHELL_RC" <<EOF

# ANDROID SDK START
export ANDROID_HOME="$SDK_DIR"
export PATH="\$PATH:\$ANDROID_HOME/emulator:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/cmdline-tools/latest/bin"
$java_line
# ANDROID SDK END
EOF
  else
    log "Android SDK variables already set in $SHELL_RC, skipping"
  fi

  log "Installing mobile/ dependencies"
  npm install --prefix mobile
}

ensure_apt_index
ensure_node

log "Installing server and web client dependencies"
npm install
npm install --prefix client

ensure_mkcert
setup_certs

if [ "$WITH_LINT" = 1 ]; then
  ensure_uv
fi

if [ "$WITH_ANDROID" = 1 ]; then
  setup_android
fi

log "Setup complete"
echo "Start the server and web client with:  make dev   (or npm run dev)"
echo "Then open https://localhost:5173 in Chrome."
if [ "$WITH_ANDROID" = 1 ]; then
  echo "Open a new shell (or run: source $SHELL_RC), then: make android-run"
fi
echo "Phones also need the mkcert root CA; see the 'Playing From a Phone' section of the README."
