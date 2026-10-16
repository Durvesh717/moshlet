const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const config = getDefaultConfig(__dirname);

// Uniwind wraps last. "dark" is Moshlet Cobalt; the others are registered here.
module.exports = withUniwindConfig(config, {
  cssEntryFile: "./src/global.css",
  dtsFile: "./src/uniwind-types.d.ts",
  extraThemes: ["glacier", "daylight", "catppuccin", "gruvbox", "kanagawa", "mono"],
});
