#!/usr/bin/env bash
# Set up a local MeCoil environment: the Node server, the Svelte web client,
# HTTPS certs for phones, and optionally the Android app.
#
#   scripts/setup.sh             server + web client + HTTPS certs
#   scripts/setup.sh --android   also JDK 17, Android SDK/NDK and mobile/ deps
#   scripts/setup.sh --lint      also install uv (used by `make lint` for Markdown)
#   scripts/setup.sh --prereqs   only install system tools (what `make install-prereqs` runs);
#                                skips npm install and cert generation
#   scripts/setup.sh --avd       only create the Pixel_6_API_36 emulator (run --android first)
#   scripts/setup.sh --android-env  only add ANDROID_HOME to your shell rc file
#
# Supports Ubuntu/Debian (apt) and macOS (Homebrew). Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."

MIN_NODE_MAJOR=22                # mobile/ needs Node >= 22.11; the server alone needs 20
ANDROID_CMDLINE_BUILD=13114758   # from https://developer.android.com/studio#command-line-tools-only
NDK_VERSION=27.1.12297006        # must match mobile/android/build.gradle
AVD_NAME=Pixel_6_API_36

WITH_ANDROID=0
WITH_LINT=0
PREREQS_ONLY=0
ONLY_AVD=0
ONLY_ANDROID_ENV=0
for arg in "$@"; do
  case "$arg" in
    --android) WITH_ANDROID=1 ;;
    --lint) WITH_LINT=1 ;;
    --prereqs) PREREQS_ONLY=1 ;;
    --avd) ONLY_AVD=1 ;;
    --android-env) ONLY_ANDROID_ENV=1 ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
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
    sudo apt-get install -y make curl ca-certificates openssl libssl-dev
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

setup_android() {
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

  if [ "$PREREQS_ONLY" = 0 ]; then
    log "Installing mobile/ dependencies"
    npm install --prefix mobile
  fi
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

ensure_apt_index
ensure_node

if [ "$PREREQS_ONLY" = 0 ]; then
  log "Installing server and web client dependencies"
  npm install
  npm install --prefix client
fi

ensure_mkcert
if [ "$PREREQS_ONLY" = 0 ]; then
  setup_certs
fi

if [ "$WITH_LINT" = 1 ]; then
  ensure_uv
fi

if [ "$WITH_ANDROID" = 1 ]; then
  setup_android
fi

if [ "$PREREQS_ONLY" = 1 ]; then
  log "Prerequisites installed. Restart the terminal for all changes to take effect"
  exit 0
fi

log "Setup complete"
echo "Start the server and web client with:  make dev   (or npm run dev)"
echo "Then open https://localhost:5173 in Chrome."
if [ "$WITH_ANDROID" = 1 ]; then
  echo "Open a new shell (or run: source $SHELL_RC), then: make android-run"
fi
echo "Phones also need the mkcert root CA; see the 'Playing From a Phone' section of the README."
