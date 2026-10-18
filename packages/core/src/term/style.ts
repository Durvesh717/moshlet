/**
 * Colors: DEFAULT, a palette index 0..255, or TRUECOLOR | 0xRRGGBB.
 * Styles are interned, so cells with the same style share one object and `a.style === b.style`
 * is a cheap check. A pane cycling through truecolors would grow the table without end, so past
 * MAX_STYLES it starts again; two equal styles can then be two objects, which costs only a redraw.
 */
export const DEFAULT = -1;
export const TRUECOLOR = 0x1000000;

export const Attr = {
  BOLD: 1,
  ITALIC: 2,
  UNDERLINE: 4,
  BLINK: 8,
  INVERSE: 16,
  INVISIBLE: 32,
  FAINT: 64,
  STRIKE: 128,
} as const;

export interface Style {
  readonly fg: number;
  readonly bg: number;
  readonly flags: number;
}

const MAX_STYLES = 10_000;
const styles = new Map<string, Style>();

export function style(fg: number, bg: number, flags: number): Style {
  const key = `${fg},${bg},${flags}`;
  let s = styles.get(key);
  if (!s) {
    if (styles.size >= MAX_STYLES) styles.clear();
    s = Object.freeze({ fg, bg, flags });
    styles.set(key, s);
  }
  return s;
}

export const PLAIN: Style = style(DEFAULT, DEFAULT, 0);

export const rgb = (r: number, g: number, b: number): number => TRUECOLOR | (r << 16) | (g << 8) | b;

export const has = (s: Style, flag: number): boolean => (s.flags & flag) !== 0;

/**
 * One grid cell. `width` is 1 for normal, 2 for the left half of a wide glyph, and 0 for the
 * right half (which renderers skip).
 */
export interface Cell {
  readonly text: string;
  readonly style: Style;
  readonly width: 0 | 1 | 2;
}

export const BLANK: Cell = Object.freeze({ text: "", style: PLAIN, width: 1 });

const blanks = new Map<number, Cell>();

export function blankCell(bg: number): Cell {
  if (bg === DEFAULT) return BLANK;
  let c = blanks.get(bg);
  if (!c) {
    if (blanks.size >= MAX_STYLES) blanks.clear();
    c = Object.freeze({ text: "", style: style(DEFAULT, bg, 0), width: 1 });
    blanks.set(bg, c);
  }
  return c;
}

export const isBlank = (c: Cell): boolean => c.text === "" || c.text === " ";

export const cell = (text: string, s: Style, width: 0 | 1 | 2): Cell => ({ text, style: s, width });
