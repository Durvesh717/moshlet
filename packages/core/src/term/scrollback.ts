import { utf8Encode } from "../bytes.ts";
import { charWidth } from "./charWidth.ts";
import { Interpreter } from "./interpreter.ts";
import { Screen } from "./screen.ts";
import type { Cell } from "./style.ts";

const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b./g;
/** Rows of history kept. Past it the oldest rows scroll off, as in a terminal's scrollback. */
export const MAX_HISTORY_ROWS = 10_000;

/** Lays out herdr's ANSI history lines as terminal rows `cols` wide, so they can sit above the live screen. */
export function layoutScrollback(lines: readonly string[], cols: number): (readonly Cell[])[] {
  if (lines.length === 0 || cols <= 0) return [];
  // Size the scratch screen so it doesn't scroll (which drops the oldest rows): one row per started
  // `cols` of display width, plus slack for wide glyphs wrapping early; at most MAX_HISTORY_ROWS.
  let rows = 0;
  for (const line of lines) rows += Math.max(1, Math.ceil(displayWidth(line.replace(ESCAPES, "")) / cols));
  const screen = new Screen(cols, Math.min(MAX_HISTORY_ROWS, rows + Math.floor(lines.length / 8) + 2));
  screen.emojiWide = true;
  Interpreter.apply(screen, utf8Encode(lines.join("\x1b[0m\r\n")));
  return screen.lines.slice(0, screen.cursorY + 1);
}

/**
 * herdr's "recent" read is the history followed by the visible screen, so the visible read's
 * line count is cut off its end. Callers should read both at the same content revision.
 */
export function historyAbove(recent: string, visible: string): string[] {
  const split = (t: string) => (t === "" ? [] : t.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n"));
  const r = split(recent);
  return r.slice(0, Math.max(0, r.length - split(visible).length));
}

function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    // VS16 widens the emoji before it to two columns (see Screen.emojiWide).
    w += cp === 0xfe0f ? 1 : charWidth(cp);
  }
  return w;
}
