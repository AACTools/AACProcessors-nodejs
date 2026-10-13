// Emulates the transform a real React Native / Expo app uses. `babel-preset-expo`
// is a superset of `@react-native/babel-preset` and includes the export-namespace
// plugin the library's ESM output relies on.
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
