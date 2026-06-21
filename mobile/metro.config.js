const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const config = {
  // Watch the repo root so Metro picks up live edits to shared/
  watchFolders: [repoRoot],
  resolver: {
    // Source files use the TypeScript ESM convention of importing with a
    // `.js` extension that actually points at a `.ts`/`.tsx` file. Metro
    // doesn't rewrite the extension, so strip it from relative imports and
    // let Metro re-resolve against the real source extensions.
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
        return context.resolveRequest(
          context,
          moduleName.replace(/\.js$/, ''),
          platform,
        );
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
