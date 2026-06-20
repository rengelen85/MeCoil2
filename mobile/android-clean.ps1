# Cleans the Android build for MeCoil mobile.
# Run this when hitting stale CMake cache errors (e.g. CXX1214 minSdkVersion mismatch)
# or other Gradle build failures that a normal rebuild won't fix.
#
# Usage: from the repo root or mobile/ directory:
#   powershell -ExecutionPolicy Bypass -File mobile\android-clean.ps1

$androidDir = "$PSScriptRoot\android"

# --- NDK health check ---------------------------------------------------------
# A corrupt / incomplete NDK download (e.g. an empty 0 MB folder with only
# source.properties) is a notorious cause of misleading CMake errors:
#   [CXX5101] NDK folder ... does not contain 'platforms'
#   [CXX1214] User has minSdkVersion 22 but library was built for 24 [hermestooling]
# When CMake can't read the NDK's platform metadata, prefab defaults the app's
# API level to a low fallback (22) and rejects libraries built for 24+. The
# minSdk number is a red herring -- the real problem is the broken NDK.
# Fix: re-download it with:
#   $env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat --install "ndk;<version>"
$ndkVersion = "27.1.12297006"  # keep in sync with android/build.gradle ndkVersion
$ndkDir = "$env:LOCALAPPDATA\Android\Sdk\ndk\$ndkVersion"
if (Test-Path $ndkDir) {
    if (-not (Test-Path "$ndkDir\meta\platforms.json")) {
        Write-Warning "NDK $ndkVersion looks incomplete (missing meta\platforms.json)."
        Write-Warning "This causes CXX5101 / CXX1214 'minSdkVersion 22' errors. Re-download it:"
        Write-Warning "  sdkmanager.bat --install `"ndk;$ndkVersion`""
    } else {
        Write-Host "NDK $ndkVersion looks complete."
    }
} else {
    Write-Warning "NDK $ndkVersion not found at $ndkDir. Install it via sdkmanager."
}

Write-Host "Deleting CMake cache (.cxx)..."
$cxxDir = "$androidDir\app\.cxx"
if (Test-Path $cxxDir) {
    Remove-Item -Recurse -Force $cxxDir
    Write-Host "  Deleted $cxxDir"
} else {
    Write-Host "  Already clean."
}

Write-Host "Running gradlew clean..."
Push-Location $androidDir
try {
    & .\gradlew.bat clean
    if ($LASTEXITCODE -ne 0) {
        Write-Error "gradlew clean failed (exit $LASTEXITCODE). Check output above."
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}

Write-Host "Done. You can now run: npm run android"
