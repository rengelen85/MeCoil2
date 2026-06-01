const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const config = {
  // Watch the repo root so Metro picks up live edits to shared/
  watchFolders: [repoRoot],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
