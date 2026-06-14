.PHONY: install dev dev-server dev-client build start test gen-certs phone-test lint fmt \
        mobile-prereqs mobile-install apk-debug apk-release android-run android-emulator

SHELL_RC := $(HOME)/.bashrc

# Install all dependencies and generate certs
init: install-prereqs install gen-certs
	sudo chown -R $$USER:$$USER .

# Install Node.js (Ubuntu/Debian) & mkcert
install-prereqs:
	sudo apt update
	sudo apt install nodejs
	sudo apt install npm
	sudo apt install openssl libssl-dev -y

# Check installed Node.js version
check-prereqs:
	@node -v
	@npm -v
	@openssl version -a

# First-time setup: install all dependencies
install:
	npm install
	npm install --prefix client

uninstall:
	npm uninstall
	npm uninstall --prefix client
	sudo rm -rf client/node_modules node_modules package-lock.json

# Run server + Vite client together (requires concurrently)
dev:
	npm run dev

# Server only (auto-detects HTTPS if certs/ exists).
# --watch-path=certs means the server auto-restarts when gen-certs creates cert files.
dev-server:
	node --watch --watch-path=certs server/index.js

# Vite client only
dev-client:
	npm run dev --prefix client

# Build the Svelte client for production
build:
	npm run build --prefix client

# Run production server (requires certs — see gen-certs)
start:
	node server/index.js

# Run unit tests (Node's built-in test runner; no extra deps)
test:
	npm test

# Generate self-signed HTTPS certs via openssl
gen-certs:
	mkdir -p certs
	openssl req -x509 -nodes -days 365 \
        -newkey rsa:2048 \
        -keyout certs/key.pem \
        -out certs/cert.pem \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,DNS:mecoil.local"

# Lint all JS/TS/Svelte sources (Biome)
lint:
	uv run --with rumdl \
	rumdl check --disable MD013
	npx biome format .
	npx biome check .

# Auto-format all JS/TS/Svelte sources (Biome primary).
# Svelte fallback: npx prettier --write "client/src/**/*.svelte"
fmt:
	uv run --with rumdl \
	rumdl check --fix --disable MD013
	npx biome format --write .
	npx biome check --write .

# Build + start HTTPS server for real-phone testing (Web Bluetooth requires HTTPS).
# After running, open the Network URL shown in the terminal on your phone.
# Phones need the mkcert root CA installed once — see mkcert docs.
phone-test: gen-certs build
	node server/index.js

# ── Android / Mobile ──────────────────────────────────────────────────────────

# Install Android build prerequisites on Ubuntu/Debian (JDK only).
# After this, install Android Studio via make install-android-studio, complete the wizard, and create an AVD.
mobile-prereqs:
	sudo apt update
	sudo apt install -y openjdk-17-jdk
	@echo ""
	@echo "Next: install Android Studio, complete the wizard, and create an AVD."

ANDROID_STUDIO_VERSION = 2026.1.1.9
ANDROID_STUDIO_TAR = android-studio-quail1-patch1-linux.tar.gz
ANDROID_STUDIO_URL = https://edgedl.me.gvt1.com/android/studio/ide-zips/$(ANDROID_STUDIO_VERSION)/$(ANDROID_STUDIO_TAR)
INSTALL_DIR = /opt/android-studio

# Build number from https://developer.android.com/studio#command-line-tools-only
CMDLINE_TOOLS_BUILD = 13114758
CMDLINE_TOOLS_ZIP   = commandlinetools-linux-$(CMDLINE_TOOLS_BUILD)_latest.zip
CMDLINE_TOOLS_URL   = https://dl.google.com/android/repository/$(CMDLINE_TOOLS_ZIP)

install-android-studio:
	@if [ ! -f $(ANDROID_STUDIO_TAR) ]; then \
		echo "Downloading Android Studio..."; \
		wget -nc $(ANDROID_STUDIO_URL); \
	else \
		echo "File already exists, skipping download."; \
	fi
	sudo mkdir -p $(INSTALL_DIR)
	sudo tar -xzf $(ANDROID_STUDIO_TAR) -C /opt/
	sudo mv /opt/android-studio $(INSTALL_DIR) || true
	@echo "Creating symlink..."
	sudo ln -sf $(INSTALL_DIR)/bin/studio.sh /usr/local/bin/android-studio
	@echo "Android Studio installed!"
	@if [ ! -d "$$HOME/Android/Sdk/cmdline-tools/latest" ]; then \
		echo "Installing Android SDK command-line tools..."; \
		wget -nc $(CMDLINE_TOOLS_URL); \
		mkdir -p "$$HOME/Android/Sdk/cmdline-tools"; \
		unzip -q $(CMDLINE_TOOLS_ZIP) -d "$$HOME/Android/Sdk/cmdline-tools/"; \
		mv "$$HOME/Android/Sdk/cmdline-tools/cmdline-tools" "$$HOME/Android/Sdk/cmdline-tools/latest"; \
		rm -f $(CMDLINE_TOOLS_ZIP); \
		yes | "$$HOME/Android/Sdk/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null 2>&1 || true; \
		echo "Command-line tools installed."; \
	else \
		echo "Command-line tools already installed, skipping."; \
	fi
	@if ! grep -q "# ANDROID SDK START" $(SHELL_RC); then \
		echo "" >> $(SHELL_RC); \
		echo "# ANDROID SDK START" >> $(SHELL_RC); \
		echo "export ANDROID_HOME=\$$HOME/Android/Sdk" >> $(SHELL_RC); \
		echo "export PATH=\$$PATH:\$$ANDROID_HOME/emulator:\$$ANDROID_HOME/platform-tools:\$$ANDROID_HOME/cmdline-tools/latest/bin" >> $(SHELL_RC); \
		echo "# ANDROID SDK END" >> $(SHELL_RC); \
	else \
		echo "Android SDK environment variables already set in $(SHELL_RC), skipping."; \
	fi
	@echo "Android env ensured in $(SHELL_RC)"
	@echo "Run this to apply changes now:"
	@echo "source ~/.bashrc"
	android-studio

# Install mobile app dependencies
mobile-install:
	npm install --prefix mobile

# Build a debug APK.
# Output: mobile/android/app/build/outputs/apk/debug/app-debug.apk
apk-debug: mobile-install
	cd mobile/android && ./gradlew assembleDebug
	@echo "APK ready: mobile/android/app/build/outputs/apk/debug/app-debug.apk"

# Build a release APK (signed with the debug keystore — replace for distribution).
# Output: mobile/android/app/build/outputs/apk/release/app-release.apk
apk-release: mobile-install
	cd mobile/android && ./gradlew assembleRelease
	@echo "APK ready: mobile/android/app/build/outputs/apk/release/app-release.apk"

# Build and run on a connected device or running emulator (also starts Metro).
android-run: mobile-install
	cd mobile && npm run android

# Start an Android emulator.  Lists available AVDs when AVD= is not set.
# Usage:  make android-emulator AVD=Pixel_9_API_35
android-emulator:
	@if [ -z "$(AVD)" ]; then \
		echo "Available AVDs:"; \
		"$$ANDROID_HOME/emulator/emulator" -list-avds; \
		echo ""; \
		echo "Re-run as: make android-emulator AVD=<name>"; \
	else \
		"$$ANDROID_HOME/emulator/emulator" -avd $(AVD) & \
	fi
