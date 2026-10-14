/** Design tokens: near-black with a violet tint, one purple accent. */
export const C = {
  ground: "#0D0A12",
  drawer: "#120E19",
  surface: "#15111C",
  surface2: "#1D1727",
  line: "#2A2238",
  line2: "#3A2F52",
  text: "#EEEAF6",
  muted: "#A69DBA",
  faint: "#8A809E",
  idle: "#6E6683",
  accent: "#A78BFA",
  accentStrong: "#6D3FE0",
  accentTint: "rgba(167,139,250,0.12)",
  blocked: "#F2B84B",
  blockedBg: "#3A2A0E",
  done: "#5DD3A8",
  doneBg: "#10261E",
  danger: "#F3A6B4",
  dangerBg: "#1A0F15",
  dangerLine: "#4A2230",
  terminal: "#08060C",
  terminalLine: "#221B2E",
  scrim: "rgba(5,3,9,0.72)",
} as const;

export const F = {
  regular: "Geist-Regular",
  medium: "Geist-Medium",
  semibold: "Geist-SemiBold",
  bold: "Geist-Bold",
  mono: "JetBrainsMonoNerdFontMono-Regular",
  monoBold: "JetBrainsMonoNerdFontMono-Bold",
} as const;

export const FONT_FILES = {
  [F.regular]: require("../assets/fonts/Geist-Regular.ttf"),
  [F.medium]: require("../assets/fonts/Geist-Medium.ttf"),
  [F.semibold]: require("../assets/fonts/Geist-SemiBold.ttf"),
  [F.bold]: require("../assets/fonts/Geist-Bold.ttf"),
  [F.mono]: require("../assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf"),
  [F.monoBold]: require("../assets/fonts/JetBrainsMonoNerdFontMono-Bold.ttf"),
};

/** Terminal fonts for Skia: JetBrains Mono first, Adwaita Mono for the symbols it lacks (⏵ ⏸ ✻ ℹ ...). */
export const TERMINAL_FONTS = {
  "JetBrains Mono": [require("../assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf"), require("../assets/fonts/JetBrainsMonoNerdFontMono-Bold.ttf")],
  "Adwaita Mono": [require("../assets/fonts/AdwaitaMono-Regular.ttf"), require("../assets/fonts/AdwaitaMono-Bold.ttf")],
};

export const R = { sm: 8, md: 10, lg: 14, xl: 20, pill: 999 } as const;
