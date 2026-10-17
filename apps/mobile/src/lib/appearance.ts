import * as SecureStore from "expo-secure-store";
import * as SystemUI from "expo-system-ui";
import { Uniwind } from "uniwind";
import { FONT_SIZE, isTerminalFont, type TerminalFont } from "../theme";
import { useApp } from "./store";

/** The themes in global.css. Moshlet Cobalt is Uniwind's "dark", the default. Only Daylight is light. */
export const THEMES = [
  { id: "dark", label: "Moshlet Cobalt", note: "Graphite, with vivid cobalt", light: false },
  { id: "glacier", label: "Moshlet Glacier", note: "Cool slate, with ice blue", light: false },
  { id: "daylight", label: "Moshlet Daylight", note: "Light, around a dark terminal", light: true },
  { id: "catppuccin", label: "Catppuccin", note: "Mocha, with mauve", light: false },
  { id: "gruvbox", label: "Gruvbox", note: "Dark, with orange", light: false },
  { id: "kanagawa", label: "Kanagawa", note: "Wave, with crystal blue", light: false },
  { id: "mono", label: "Black & White", note: "Pure black, white and grays", light: false },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/** Whether the theme is light, so the status bar draws dark icons over it. */
export const isLight = (id: string): boolean => THEMES.some((t) => t.id === id && t.light);

const KEY = "moshlet.theme";
const FONT_KEY = "moshlet.termFont";
const SIZE_KEY = "moshlet.fontSize";

const isTheme = (v: string | null): v is ThemeId => THEMES.some((t) => t.id === v);

function apply(id: ThemeId): void {
  Uniwind.setTheme(id);
  // The window behind the app, seen during transitions and while the keyboard moves.
  const ground = Uniwind.getCSSVariable("--color-background");
  if (typeof ground === "string") void SystemUI.setBackgroundColorAsync(ground);
}

const read = (key: string) => SecureStore.getItemAsync(key).catch(() => null);

/** Applies the saved theme (or Moshlet Cobalt), terminal font and size before the first screen draws. */
export async function loadAppearance(): Promise<void> {
  const [theme, font, size] = await Promise.all([read(KEY), read(FONT_KEY), read(SIZE_KEY)]);
  apply(isTheme(theme) ? theme : "dark");
  if (isTerminalFont(font)) useApp.setState({ termFont: font });
  const n = Number(size);
  if (size && n >= FONT_SIZE.min && n <= FONT_SIZE.max) useApp.setState({ fontSize: n });
}

export function setTheme(id: ThemeId): void {
  apply(id);
  void SecureStore.setItemAsync(KEY, id);
}

export function setTerminalFont(font: TerminalFont): void {
  useApp.setState({ termFont: font });
  void SecureStore.setItemAsync(FONT_KEY, font);
}

/** From pinching or Settings: kept to the range, in half points. */
export function setFontSize(size: number): void {
  const n = Math.round(Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, size)) * 2) / 2;
  useApp.setState({ fontSize: n });
  void SecureStore.setItemAsync(SIZE_KEY, String(n));
}
