.PHONY: install dev dev-server dev-client build start test gen-certs phone-test lint fmt \
        mobile-prereqs mobile-install apk-debug apk-release android-run android-emulator create-avd android-clean

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
	sudo apt install -y libpulse0
	sudo apt install -y unzip
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
	@if [ ! -f $(CMDLINE_TOOLS_ZIP) ]; then \
		echo "Downloading SDK command-line tools..."; \
		wget -nc $(CMDLINE_TOOLS_URL); \
	else \
		echo "File already exists, skipping download."; \
	fi
	@if [ ! -f "$$HOME/Android/Sdk/cmdline-tools/latest/bin/sdkmanager" ]; then \
		echo "Installing Android SDK command-line tools..."; \
		mkdir -p "$$HOME/Android/Sdk/cmdline-tools"; \
		unzip -q $(CMDLINE_TOOLS_ZIP) -d "$$HOME/Android/Sdk/cmdline-tools/"; \
		mv "$$HOME/Android/Sdk/cmdline-tools/cmdline-tools" "$$HOME/Android/Sdk/cmdline-tools/latest"; \
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
	@echo "In Android Studio: SDK Manager → SDK Tools → Android SDK Command-line Tools → Apply.""
	@echo "Then re-run: make create-avd"
	android-studio

install-android-avd:
	@SDKMANAGER="$$HOME/Android/Sdk/cmdline-tools/latest/bin/sdkmanager"; \
	AVDMANAGER="$$HOME/Android/Sdk/cmdline-tools/latest/bin/avdmanager"; \
	if [ ! -f "$$AVDMANAGER" ]; then \
		echo "WARNING: avdmanager not found; skipping AVD creation."; \
		echo "In Android Studio: SDK Manager → SDK Tools → Android SDK Command-line Tools → Apply."; \
		echo "Then re-run: make create-avd"; \
	elif [ ! -d "$$HOME/.android/avd/Pixel_6_API_36.avd" ]; then \
		echo "Installing system image (system-images;android-36;google_apis;x86_64)..."; \
		yes | "$$SDKMANAGER" "system-images;android-36;google_apis;x86_64" && \
		echo "Creating AVD Pixel_6_API_36..." && \
		echo "no" | "$$AVDMANAGER" create avd \
			--name Pixel_6_API_36 \
			--package "system-images;android-36;google_apis;x86_64" \
			--device "pixel_6" && \
		echo "AVD Pixel_6_API_36 created."; \
	else \
		echo "AVD Pixel_6_API_36 already exists, skipping."; \
	fi
	@echo "Granting /dev/kvm access to current user (requires sudo)..."; \
	sudo adduser $$USER kvm 2>/dev/null || true; \
	sudo chmod 666 /dev/kvm 2>/dev/null || echo "WARNING: could not chmod /dev/kvm (may not exist yet)"; \
	echo "KVM access granted. You may need to log out and back in for group changes to take effect."

# Create the default AVD (Pixel_6_API_36).  Requires cmdline-tools to be installed.
# If avdmanager is missing, open Android Studio → SDK Manager → SDK Tools →
# Android SDK Command-line Tools → Apply, then re-run this target.
create-avd:
	@SDKMANAGER="$$HOME/Android/Sdk/cmdline-tools/latest/bin/sdkmanager"; \
	AVDMANAGER="$$HOME/Android/Sdk/cmdline-tools/latest/bin/avdmanager"; \
	if [ ! -f "$$AVDMANAGER" ]; then \
		echo "ERROR: avdmanager not found at $$AVDMANAGER"; \
		echo "Install via Android Studio → SDK Manager → SDK Tools → Android SDK Command-line Tools."; \
		exit 1; \
	fi; \
	if [ ! -d "$$HOME/.android/avd/Pixel_6_API_36.avd" ]; then \
		echo "Installing system image (system-images;android-36;google_apis;x86_64)..."; \
		yes | "$$SDKMANAGER" "system-images;android-36;google_apis;x86_64" && \
		echo "Creating AVD Pixel_6_API_36..." && \
		echo "no" | "$$AVDMANAGER" create avd \
			--name Pixel_6_API_36 \
			--package "system-images;android-36;google_apis;x86_64" \
			--device "pixel_6" && \
		echo "AVD Pixel_6_API_36 created."; \
	else \
		echo "AVD Pixel_6_API_36 already exists, skipping."; \
	fi
	
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
# Usage:  make android-emulator AVD=Pixel_6_API_36
android-emulator:
	@if [ -z "$(AVD)" ]; then \
		echo "Available AVDs:"; \
		"$$ANDROID_HOME/emulator/emulator" -list-avds; \
		echo ""; \
		echo "Re-run as: make android-emulator AVD=<name>"; \
	else \
		"$$ANDROID_HOME/emulator/emulator" -avd $(AVD) & \
	fi

# Clean Android build cache and perform clean Gradle build.
# Use when hitting stale CMake cache errors (e.g. CXX1214 minSdkVersion mismatch) or other Gradle failures.
# Linux/macOS equivalent of mobile/android-clean.ps1.
android-clean:
	@NDK_VERSION="27.1.12297006"; \
	NDK_DIR="$$ANDROID_HOME/ndk/$$NDK_VERSION"; \
	if [ -d "$$NDK_DIR" ]; then \
		if [ ! -f "$$NDK_DIR/meta/platforms.json" ]; then \
			echo "WARNING: NDK $$NDK_VERSION looks incomplete (missing meta/platforms.json)."; \
			echo "This causes CXX5101 / CXX1214 errors. Re-download via sdkmanager:"; \
			echo "  sdkmanager \"ndk;$$NDK_VERSION\""; \
		else \
			echo "NDK $$NDK_VERSION looks complete."; \
		fi; \
	else \
		echo "WARNING: NDK $$NDK_VERSION not found at $$NDK_DIR."; \
	fi; \
	echo "Deleting CMake cache (.cxx)..."; \
	CXX_DIR="mobile/android/app/.cxx"; \
	if [ -d "$$CXX_DIR" ]; then \
		rm -rf "$$CXX_DIR"; \
		echo "  Deleted $$CXX_DIR"; \
	else \
		echo "  Already clean."; \
	fi; \
	echo "Running gradlew clean..."; \
	cd mobile/android && ./gradlew clean; \
	if [ $$? -ne 0 ]; then \
		echo "ERROR: gradlew clean failed. Check output above."; \
		exit 1; \
	fi; \
	echo "Done. You can now run: npm run android"

include Makefile-mac.mk
