# ── macOS targets ─────────────────────────────────────────────────────────────
# Included by the root Makefile. Requires CMDLINE_TOOLS_BUILD defined there.

.PHONY: init-mac install-prereqs-mac mobile-prereqs-mac install-android-studio-mac create-avd-mac

SHELL_RC_MAC     := $(HOME)/.zshrc
ANDROID_HOME_MAC := $(HOME)/Library/Android/sdk

# Detect AVD ABI: arm64-v8a on Apple Silicon, x86_64 on Intel
UNAME_M := $(shell uname -m)
ifeq ($(UNAME_M),arm64)
  AVD_ABI := arm64-v8a
else
  AVD_ABI := x86_64
endif

CMDLINE_TOOLS_ZIP_MAC := commandlinetools-mac-$(CMDLINE_TOOLS_BUILD)_latest.zip
CMDLINE_TOOLS_URL_MAC := https://dl.google.com/android/repository/$(CMDLINE_TOOLS_ZIP_MAC)

# Mac equivalent of init: install prereqs, npm deps, and certs
init-mac: install-prereqs-mac install gen-certs

# Install Node.js and openssl via Homebrew
install-prereqs-mac:
	brew update
	brew install node
	brew install openssl

# Install JDK 17 via Homebrew (required by Android toolchain)
mobile-prereqs-mac:
	brew install openjdk@17
	@echo ""
	@echo "Next: run make install-android-studio-mac, complete the wizard, then make create-avd-mac."

# Install Android Studio via Homebrew Cask and set up SDK command-line tools
install-android-studio-mac:
	brew install --cask android-studio
	@if [ ! -f "$(ANDROID_HOME_MAC)/cmdline-tools/latest/bin/sdkmanager" ]; then \
		echo "Downloading SDK command-line tools for macOS..."; \
		if [ ! -f $(CMDLINE_TOOLS_ZIP_MAC) ]; then \
			curl -O $(CMDLINE_TOOLS_URL_MAC); \
		fi; \
		mkdir -p "$(ANDROID_HOME_MAC)/cmdline-tools"; \
		unzip -q $(CMDLINE_TOOLS_ZIP_MAC) -d "$(ANDROID_HOME_MAC)/cmdline-tools/"; \
		mv "$(ANDROID_HOME_MAC)/cmdline-tools/cmdline-tools" "$(ANDROID_HOME_MAC)/cmdline-tools/latest"; \
		yes | "$(ANDROID_HOME_MAC)/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null 2>&1 || true; \
		echo "Command-line tools installed."; \
	else \
		echo "Command-line tools already installed, skipping."; \
	fi
	@if ! grep -q "# ANDROID SDK START" $(SHELL_RC_MAC) 2>/dev/null; then \
		echo "" >> $(SHELL_RC_MAC); \
		echo "# ANDROID SDK START" >> $(SHELL_RC_MAC); \
		echo "export ANDROID_HOME=\$$HOME/Library/Android/sdk" >> $(SHELL_RC_MAC); \
		echo "export PATH=\$$PATH:\$$ANDROID_HOME/emulator:\$$ANDROID_HOME/platform-tools:\$$ANDROID_HOME/cmdline-tools/latest/bin" >> $(SHELL_RC_MAC); \
		echo "# ANDROID SDK END" >> $(SHELL_RC_MAC); \
	else \
		echo "Android SDK environment variables already set in $(SHELL_RC_MAC), skipping."; \
	fi
	@echo "Android env set in $(SHELL_RC_MAC)."
	@echo "Run: source $(SHELL_RC_MAC)"
	@echo "Then: make create-avd-mac"

# Create the default AVD on macOS (Pixel_6_API_36).
# Auto-selects arm64-v8a on Apple Silicon, x86_64 on Intel.
create-avd-mac:
	@SDKMANAGER="$(ANDROID_HOME_MAC)/cmdline-tools/latest/bin/sdkmanager"; \
	AVDMANAGER="$(ANDROID_HOME_MAC)/cmdline-tools/latest/bin/avdmanager"; \
	if [ ! -f "$$AVDMANAGER" ]; then \
		echo "ERROR: avdmanager not found at $$AVDMANAGER"; \
		echo "Install via Android Studio → SDK Manager → SDK Tools → Android SDK Command-line Tools."; \
		exit 1; \
	fi; \
	if [ ! -d "$$HOME/.android/avd/Pixel_6_API_36.avd" ]; then \
		echo "Installing system image (system-images;android-36;google_apis;$(AVD_ABI))..."; \
		yes | "$$SDKMANAGER" "system-images;android-36;google_apis;$(AVD_ABI)" && \
		echo "Creating AVD Pixel_6_API_36..." && \
		echo "no" | "$$AVDMANAGER" create avd \
			--name Pixel_6_API_36 \
			--package "system-images;android-36;google_apis;$(AVD_ABI)" \
			--device "pixel_6" && \
		echo "AVD Pixel_6_API_36 created."; \
	else \
		echo "AVD Pixel_6_API_36 already exists, skipping."; \
	fi
