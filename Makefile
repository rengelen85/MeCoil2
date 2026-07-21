.PHONY: install dev dev-server dev-client build start test gen-certs phone-test lint fmt \
        mobile-prereqs mobile-install apk-debug apk-release android-run android-run-adb

SHELL := /bin/bash
SHELL_RC := $(HOME)/.bashrc

# Install all dependencies and generate certs
init: install-prereqs install gen-certs
	sudo chown -R $$USER:$$USER .

# Install Node.js (Ubuntu/Debian) & openssl
install-prereqs:
	sudo apt update
	sudo apt install nodejs -y
	sudo apt install npm -y
	sudo apt install openssl libssl-dev -y
	curl -LsSf https://astral.sh/uv/install.sh | sh
	@echo "Please restart the terminal for all changes to take effect"

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

# Lint all JS/TS/Svelte sources (Biome) + Docker/Caddy configs (see Makefile-docker.mk)
lint:
	uv run --with rumdl \
	rumdl check --disable MD013
	npx biome format .
	npx biome check .
	$(MAKE) lint-configs

# Auto-format all JS/TS/Svelte sources (Biome primary).
# Svelte fallback: npx prettier --write "client/src/**/*.svelte"
fmt:
	uv run --with rumdl \
	rumdl check --fix --disable MD013
	npx biome format --write .
	npx biome check --write .
	$(MAKE) fmt-configs

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
	sudo apt install -y libpulse0
	sudo apt install -y unzip
	@echo ""
	@echo "Next: install Android Studio, complete the wizard. Make sure to include (Tools > SDK Manager > SDK Tools) Android SDK Command-line Tools, Android SDK Build-Tools, NDK (Side by Side) and CMake."
	@echo "Then: Create an AVD or connect a physical android device in Android Studio Device Manager and run `make android-run`."

android-env-vars:
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


# Install mobile app dependencies
mobile-install:
	npm install --prefix mobile

# Build a debug APK.
# Output: mobile/android/app/build/outputs/apk/debug/app-debug.apk
apk-debug-build: mobile-install
	cd mobile/android && ./gradlew assembleDebug
	@echo "APK ready: mobile/android/app/build/outputs/apk/debug/app-debug.apk"

# Install the debug APK on a connected device or running emulator.
apk-debug-install:
	adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
	echo "Debug APK installed on device/emulator."

apk-debug: apk-debug-build apk-debug-install

# Build a release APK (signed with the debug keystore — replace for distribution).
# Output: mobile/android/app/build/outputs/apk/release/app-release.apk
apk-release-build: mobile-install
	cd mobile/android && ./gradlew assembleRelease
	@echo "APK ready: mobile/android/app/build/outputs/apk/release/app-release.apk"

# Install the release APK on a connected device or running emulator.
apk-release-install:
	adb install -r mobile/android/app/build/outputs/apk/release/app-release.apk
	@echo "Release APK installed on device/emulator."

apk-release: apk-release-build apk-release-install

# Build and run on a connected device or running emulator (also starts Metro).
android-run: mobile-install android-env-vars
	adb reverse tcp:8081 tcp:8081
	cd mobile && npm run android

# If android-run (react-native run-android) fails to launch the app, use this instead.
# Builds a fresh debug APK (apk-debug → gradlew assembleDebug), installs it, launches
# the activity, then starts Metro. Requires a running emulator or connected device.
android-run-adb: apk-debug
	adb reverse tcp:8081 tcp:8081
	adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
	adb shell am start -n com.mecoilmobile/.MainActivity
	npm --prefix mobile start

include Makefile-mac.mk
include Makefile-android.mk
include Makefile-docker.mk
