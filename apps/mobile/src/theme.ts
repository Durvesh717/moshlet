/*
 * Fonts. Colors live in global.css, one set per theme; the classes and useColors read them.
 */

/** Loaded by name; global.css refers to the same names (each weight is its own family on a phone). */
export const FONT_FILES = {
  "Geist-Regular": require("../assets/fonts/Geist-Regular.ttf"),
  "Geist-Medium": require("../assets/fonts/Geist-Medium.ttf"),
  "Geist-SemiBold": require("../assets/fonts/Geist-SemiBold.ttf"),
  "Geist-Bold": require("../assets/fonts/Geist-Bold.ttf"),
  "JetBrainsMonoNerdFontMono-Regular": require("../assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf"),
  "JetBrainsMonoNerdFontMono-Bold": require("../assets/fonts/JetBrainsMonoNerdFontMono-Bold.ttf"),
};

/** Terminal fonts for Skia: JetBrains Mono first, Adwaita Mono for the symbols it lacks (⏵ ⏸ ✻ ℹ ...). */
export const TERMINAL_FONTS = {
  "JetBrains Mono": [require("../assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf"), require("../assets/fonts/JetBrainsMonoNerdFontMono-Bold.ttf")],
  "Adwaita Mono": [require("../assets/fonts/AdwaitaMono-Regular.ttf"), require("../assets/fonts/AdwaitaMono-Bold.ttf")],
};
