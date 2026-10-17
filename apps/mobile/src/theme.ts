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

/**
 * Terminal fonts for Skia, regular and bold, to choose from in Settings. Whatever the font, Adwaita
 * Mono draws the symbols it lacks (⏵ ⏸ ✻ ℹ ...) and JetBrains Mono the icons: the others are
 * Nerd Fonts builds with their icons taken out (assets/fonts/README.md).
 */
export const TERMINAL_FONTS = {
  "JetBrains Mono": [require("../assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf"), require("../assets/fonts/JetBrainsMonoNerdFontMono-Bold.ttf")],
  "Fira Code": [require("../assets/fonts/FiraCodeNerdFontMono-Regular.ttf"), require("../assets/fonts/FiraCodeNerdFontMono-Bold.ttf")],
  "Caskaydia Cove": [require("../assets/fonts/CaskaydiaCoveNerdFontMono-Regular.ttf"), require("../assets/fonts/CaskaydiaCoveNerdFontMono-Bold.ttf")],
  "Geist Mono": [require("../assets/fonts/GeistMonoNerdFontMono-Regular.otf"), require("../assets/fonts/GeistMonoNerdFontMono-Bold.otf")],
  Hack: [require("../assets/fonts/HackNerdFontMono-Regular.ttf"), require("../assets/fonts/HackNerdFontMono-Bold.ttf")],
  "Ubuntu Mono": [require("../assets/fonts/UbuntuMonoNerdFontMono-Regular.ttf"), require("../assets/fonts/UbuntuMonoNerdFontMono-Bold.ttf")],
  "Adwaita Mono": [require("../assets/fonts/AdwaitaMono-Regular.ttf"), require("../assets/fonts/AdwaitaMono-Bold.ttf")],
};

export type TerminalFont = keyof typeof TERMINAL_FONTS;

export const isTerminalFont = (v: string | null): v is TerminalFont => v !== null && v in TERMINAL_FONTS;

/** The terminal font size range, in points (pinching and Settings both keep to it). */
export const FONT_SIZE = { min: 8, max: 22, default: 12 };
