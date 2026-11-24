import type { Cell } from "./style.ts";

/** A cell in a run of rows: history rows first, then the live screen. */
export interface Point {
  row: number;
  col: number;
}

/** Rows to copy from, and which of them run on into the next row (a soft wrap, not a newline). */
export interface TextRows {
  rows: readonly (readonly Cell[])[];
  wrapped: readonly boolean[];
}

/** The two points in reading order. */
export const ordered = (a: Point, b: Point): [Point, Point] => (b.row < a.row || (b.row === a.row && b.col < a.col) ? [b, a] : [a, b]);
/** The column of the glyph covering `col`: the right half of a wide glyph belongs to its left half. */
function glyphCol(row: readonly Cell[], col: number): number {
  const c = Math.min(Math.max(col, 0), row.length - 1);
  return c > 0 && row[c].width === 0 ? c - 1 : c;
}

/**
 * The text from `a` to `b`, both cells included, in either order. Soft-wrapped rows join without
 * a newline; a row's trailing blanks are dropped unless it wraps.
 */
export function selectionText(t: TextRows, a: Point, b: Point): string {
  const [start, end] = ordered(a, b);
  let out = "";
  for (let r = Math.max(0, start.row); r <= Math.min(end.row, t.rows.length - 1); r++) {
    const row = t.rows[r];
    if (row.length === 0) {
      if (r < end.row && !t.wrapped[r]) out += "\n";
      continue;
    }
    const from = r === start.row ? glyphCol(row, start.col) : 0;
    const to = r === end.row ? Math.min(end.col, row.length - 1) : row.length - 1;
    let line = "";
    for (let x = from; x <= to; x++) if (row[x].width !== 0) line += row[x].text || " ";
    const wraps = t.wrapped[r] && to === row.length - 1;
    out += wraps ? line : line.trimEnd();
    if (r < end.row && !wraps) out += "\n";
  }
  return out;
}

/** Characters that end a word: spaces, brackets, quotes and separators, so paths and URLs select whole. */
const BREAKS = new Set([..." \t()[]{}<>'\"`,;|│"]);
const isWord = (c: Cell): boolean => c.text !== "" && !BREAKS.has(c.text);

/** The columns of the word under `col` (just that cell when it is a space or separator). */
export function wordAt(row: readonly Cell[], col: number): [number, number] {
  if (row.length === 0) return [0, 0];
  const c = glyphCol(row, col);
  if (!isWord(row[c])) return [c, c + (row[c].width === 2 ? 1 : 0)];
  let from = c;
  while (from > 0 && (row[from - 1].width === 0 ? from > 1 && isWord(row[from - 2]) : isWord(row[from - 1]))) from--;
  let to = c;
  while (to + 1 < row.length && (row[to + 1].width === 0 || isWord(row[to + 1]))) to++;
  return [from, to];
}
