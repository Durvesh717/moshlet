import type { Screen } from "./screen.ts";

/** Each row's text without trailing blanks: enough to recognise a row after it has moved. */
export const rowTexts = (s: Screen): string[] =>
  s.lines.map((line) => {
    let t = "";
    for (const c of line) if (c.width !== 0) t += c.text || " ";
    return t.trimEnd();
  });

/**
 * How many rows the content moved down between two frames of the same screen (negative: up),
 * judged by non-blank rows that reappear shifted. Only shifts in [min, max] are tried; 0 when
 * none explains the new frame better than standing still. `expect` breaks ties between shifts
 * that fit equally well (repeated rows such as borders match more than one).
 */
export function rowsMoved(prev: readonly string[], next: readonly string[], min: number, max: number, expect: number): number {
  let still = 0;
  let best = 0;
  let bestMatches = 0;
  for (let k = min; k <= max; k++) {
    let matches = 0;
    let comparable = 0;
    for (let i = Math.max(0, -k); i < prev.length && i + k < next.length; i++) {
      if (prev[i] === "") continue;
      comparable++;
      if (next[i + k] === prev[i]) matches++;
    }
    if (k === 0) still = matches;
    // Most of the rows still in view must reappear, not a stray one that happens to repeat.
    if (k === 0 || matches < 2 || matches * 10 < comparable * 6) continue;
    if (matches > bestMatches || (matches === bestMatches && Math.abs(k - expect) < Math.abs(best - expect))) {
      best = k;
      bestMatches = matches;
    }
  }
  return bestMatches > still ? best : 0;
}

/**
 * Rows at the top and bottom that stayed put while the rest moved `k` rows: the header, input box
 * or status line an app keeps around the part it scrolls. Blank rows at the inner edge of either
 * block are left to the moving part, since a blank row looks the same moved or not.
 */
export function fixedRows(prev: readonly string[], next: readonly string[], k: number): { top: number; bottom: number } {
  const n = Math.min(prev.length, next.length);
  const stayed = (y: number) => next[y] === prev[y] && !(y - k >= 0 && y - k < n && prev[y - k] === next[y]);
  let top = 0;
  for (let y = 0; y < n && stayed(y); y++) if (next[y] !== "") top = y + 1;
  let bottom = 0;
  for (let y = n - 1; y >= top && stayed(y); y--) if (next[y] !== "") bottom = n - y;
  return { top, bottom };
}
