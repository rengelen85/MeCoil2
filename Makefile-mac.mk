# ── macOS targets ─────────────────────────────────────────────────────────────
# Included by the root Makefile. All installers live in scripts/setup.sh.

.PHONY: init-mac install-prereqs-mac mobile-prereqs-mac install-android-studio-mac create-avd-mac

# Mac equivalent of init: install prereqs, npm deps, and certs
init-mac: install-prereqs-mac install gen-certs

# Install Node.js, openssl, mkcert and uv via Homebrew (same script as install-prereqs)
install-prereqs-mac: install-prereqs

# Install JDK 17, Android SDK, NDK and CMake via Homebrew (same script as mobile-prereqs)
mobile-prereqs-mac: mobile-prereqs

# Install Android Studio via Homebrew Cask (optional); the SDK comes from scripts/setup.sh
install-android-studio-mac:
	brew install --cask android-studio
	scripts/setup.sh --prereqs --android
	@echo "Then: make create-avd-mac"

# Create the default AVD on macOS (Pixel_6_API_36); the script picks arm64-v8a or x86_64
create-avd-mac: create-avd
