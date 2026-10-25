.PHONY: install-android-studio android-emulator create-avd android-clean

ANDROID_STUDIO_VERSION = 2026.1.1.9
ANDROID_STUDIO_TAR = android-studio-quail1-patch1-linux.tar.gz
ANDROID_STUDIO_URL = https://edgedl.me.gvt1.com/android/studio/ide-zips/$(ANDROID_STUDIO_VERSION)/$(ANDROID_STUDIO_TAR)
INSTALL_DIR = /opt/android-studio

# Install the Android Studio IDE (optional). The SDK, NDK and ANDROID_HOME setup come from scripts/setup.sh.
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
	scripts/setup.sh --prereqs --android
	@echo "Android Studio installed! Start it with: android-studio"
	@echo "Then create an emulator with: make create-avd"

# Create the default AVD (Pixel_6_API_36). Requires make mobile-prereqs first.
create-avd:
	scripts/setup.sh --avd

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
