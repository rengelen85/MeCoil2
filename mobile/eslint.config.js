const reactNativeConfig = require('@react-native/eslint-config/flat');

// Filter out the Flow (ft-flow) config entry — this project uses TypeScript, not Flow,
// and eslint-plugin-ft-flow is not compatible with ESLint 9.
module.exports = reactNativeConfig.filter(
  entry => !entry?.plugins?.['ft-flow'],
);
