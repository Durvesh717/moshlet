import { DEFAULT, TRUECOLOR } from "@moshlet/core";

/** A terminal's colors as 0xAARRGGBB: the 16 ANSI colors come from the theme, the rest of the 256 are standard. */
export interface Palette {
  fg: number;
  bg: number;
  cursor: number;
  /** All 256 indexed colors. */
  table: readonly number[];
}

const argb = (r: number, g: number, b: number) => (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;

/** "#rrggbb" (or "#rrggbbaa", alpha ignored) as 0xffRRGGBB; gray if it can't be read. */
export function hexColor(hex: string | undefined): number {
  const m = /^#?([0-9a-f]{6})/i.exec(hex ?? "");
  return m ? (0xff000000 | parseInt(m[1], 16)) >>> 0 : 0xff808080;
}

export function makePalette(fg: number, bg: number, cursor: number, ansi16: readonly number[]): Palette {
  const table = Array.from({ length: 256 }, (_, i) => {
    if (i < 16) return ansi16[i] ?? fg;
    if (i < 232) {
      const n = i - 16;
      const levels = [0, 95, 135, 175, 215, 255];
      return argb(levels[Math.floor(n / 36)], levels[Math.floor(n / 6) % 6], levels[n % 6]);
    }
    const v = 8 + 10 * (i - 232);
    return argb(v, v, v);
  });
  return { fg, bg, cursor, table };
}

export function resolveColor(p: Palette, color: number, fallback: number): number {
  if (color === DEFAULT) return fallback;
  if (color >= TRUECOLOR) return (0xff000000 | (color & 0xffffff)) >>> 0;
  if (color >= 0 && color <= 255) return p.table[color];
  return fallback;
}
