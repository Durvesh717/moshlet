import * as SecureStore from "expo-secure-store";
import * as SystemUI from "expo-system-ui";
import { Uniwind } from "uniwind";

/** The themes in global.css. Base is Uniwind's "dark" (the app has no light theme). */
export const THEMES = [
  { id: "dark", label: "Base", note: "Purple on near-black" },
  { id: "catppuccin", label: "Catppuccin", note: "Mocha, with mauve" },
  { id: "gruvbox", label: "Gruvbox", note: "Dark, with orange" },
  { id: "kanagawa", label: "Kanagawa", note: "Wave, with crystal blue" },
  { id: "mono", label: "Black & White", note: "Pure black, white and grays" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const KEY = "corral.theme";

const isTheme = (v: string | null): v is ThemeId => THEMES.some((t) => t.id === v);

function apply(id: ThemeId): void {
  Uniwind.setTheme(id);
  // The window behind the app, seen during transitions and while the keyboard moves.
  const ground = Uniwind.getCSSVariable("--color-background");
  if (typeof ground === "string") void SystemUI.setBackgroundColorAsync(ground);
}

/** Applies the saved theme, or Base, before the first screen draws. */
export async function loadTheme(): Promise<void> {
  const saved = await SecureStore.getItemAsync(KEY).catch(() => null);
  apply(isTheme(saved) ? saved : "dark");
}

export function setTheme(id: ThemeId): void {
  apply(id);
  void SecureStore.setItemAsync(KEY, id);
}
