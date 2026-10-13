const { getDefaultConfig } = require('metro-config');

// Plain Metro config. Deliberately no Node core polyfills: a transitive
// `require('events')` from the browser distribution fails exactly as it would
// in a stock React Native / Expo app.
module.exports = getDefaultConfig(__dirname);
