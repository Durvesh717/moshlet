import { DEFAULT, TRUECOLOR } from "@corral/core";

/** A purple-tinted ANSI palette tuned for the near-black terminal ground. Colors are 0xAARRGGBB. */
export const DEFAULT_FG = 0xffe6e1f0;
export const DEFAULT_BG = 0xff08060c;
export const CURSOR = 0xffa78bfa;

const ANSI16 = [
  // Color 0 sits just above the ground so "explicit black" backgrounds don't show as gray blocks.
  0xff120e19, 0xfff07a8a, 0xff5dd3a8, 0xfff2b84b, 0xff8b9cfa, 0xffc084fc, 0xff67d3e0, 0xffd9d3e6,
  0xff5a5070, 0xffff9aa8, 0xff8be3c2, 0xfff7cf7a, 0xffa9b6ff, 0xffd6a6ff, 0xff93e4ee, 0xfff5f2fa,
];

const argb = (r: number, g: number, b: number) => (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;

const TABLE: number[] = Array.from({ length: 256 }, (_, i) => {
  if (i < 16) return ANSI16[i];
  if (i < 232) {
    const n = i - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    return argb(levels[Math.floor(n / 36)], levels[Math.floor(n / 6) % 6], levels[n % 6]);
  }
  const v = 8 + 10 * (i - 232);
  return argb(v, v, v);
});

export function resolveColor(color: number, fallback: number): number {
  if (color === DEFAULT) return fallback;
  if (color >= TRUECOLOR) return (0xff000000 | (color & 0xffffff)) >>> 0;
  if (color >= 0 && color <= 255) return TABLE[color];
  return fallback;
}
