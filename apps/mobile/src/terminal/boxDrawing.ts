import { Skia, type SkCanvas, type SkPaint } from "@shopify/react-native-skia";

/**
 * Draws box-drawing and block characters geometrically so lines join across cells regardless of
 * the font's line height. Returns false for anything it doesn't handle (the font draws those).
 */
const L = 1;
const R = 2;
const U = 4;
const D = 8;
const HEAVY = 0x100;
const DOUBLE = 0x200;

// code point -> arms | heavy | double
const LINES = new Map<number, number>([
  [0x2500, L | R], [0x2501, L | R | HEAVY], [0x2502, U | D], [0x2503, U | D | HEAVY],
  [0x250c, R | D], [0x250f, R | D | HEAVY], [0x2510, L | D], [0x2513, L | D | HEAVY],
  [0x2514, R | U], [0x2517, R | U | HEAVY], [0x2518, L | U], [0x251b, L | U | HEAVY],
  [0x251c, U | D | R], [0x2523, U | D | R | HEAVY], [0x2524, U | D | L], [0x252b, U | D | L | HEAVY],
  [0x252c, L | R | D], [0x2533, L | R | D | HEAVY], [0x2534, L | R | U], [0x253b, L | R | U | HEAVY],
  [0x253c, L | R | U | D], [0x254b, L | R | U | D | HEAVY],
  [0x2550, L | R | DOUBLE], [0x2551, U | D | DOUBLE], [0x2554, R | D | DOUBLE], [0x2557, L | D | DOUBLE],
  [0x255a, R | U | DOUBLE], [0x255d, L | U | DOUBLE], [0x2560, U | D | R | DOUBLE], [0x2563, U | D | L | DOUBLE],
  [0x2566, L | R | D | DOUBLE], [0x2569, L | R | U | DOUBLE], [0x256c, L | R | U | D | DOUBLE],
  [0x2574, L], [0x2575, U], [0x2576, R], [0x2577, D],
  [0x2578, L | HEAVY], [0x2579, U | HEAVY], [0x257a, R | HEAVY], [0x257b, D | HEAVY],
]);

export const isBoxChar = (cp: number): boolean => cp >= 0x2500 && cp <= 0x259f;

export function drawBox(canvas: SkCanvas, cp: number, x: number, y: number, w: number, h: number, paint: SkPaint, thin: number, snap: (v: number) => number): boolean {
  const fill = (l: number, t: number, r: number, b: number) => canvas.drawRect(Skia.XYWHRect(snap(l), snap(t), snap(r) - snap(l), snap(b) - snap(t)), paint);
  const spec = LINES.get(cp);
  if (spec !== undefined) {
    const t = spec & HEAVY ? thin * 2 : thin;
    const cx = x + w / 2;
    const cy = y + h / 2;
    for (const o of spec & DOUBLE ? [-thin * 1.5, thin * 1.5] : [0]) {
      if (spec & L) fill(x, cy + o - t / 2, cx + t / 2, cy + o + t / 2);
      if (spec & R) fill(cx - t / 2, cy + o - t / 2, x + w, cy + o + t / 2);
      if (spec & U) fill(cx + o - t / 2, y, cx + o + t / 2, cy + t / 2);
      if (spec & D) fill(cx + o - t / 2, cy - t / 2, cx + o + t / 2, y + h);
    }
    return true;
  }
  if (cp >= 0x256d && cp <= 0x2570) {
    drawRounded(canvas, cp, x, y, w, h, paint, thin);
    return true;
  }
  if (cp === 0x2588) fill(x, y, x + w, y + h);
  else if (cp === 0x2580) fill(x, y, x + w, y + h / 2);
  else if (cp === 0x2584) fill(x, y + h / 2, x + w, y + h);
  else if (cp === 0x258c) fill(x, y, x + w / 2, y + h);
  else if (cp === 0x2590) fill(x + w / 2, y, x + w, y + h);
  else if (cp >= 0x2581 && cp <= 0x2587) fill(x, y + h - (h * (cp - 0x2580)) / 8, x + w, y + h);
  else if (cp >= 0x2589 && cp <= 0x258f) fill(x, y, x + (w * (0x2590 - cp)) / 8, y + h);
  else if (cp >= 0x2591 && cp <= 0x2593) {
    const a = paint.getAlphaf();
    paint.setAlphaf((a * (cp - 0x2590)) / 4);
    fill(x, y, x + w, y + h);
    paint.setAlphaf(a);
  } else return false;
  return true;
}

function drawRounded(canvas: SkCanvas, cp: number, x: number, y: number, w: number, h: number, fillPaint: SkPaint, thin: number): void {
  const paint = fillPaint.copy();
  paint.setStyle(1); // stroke
  paint.setStrokeWidth(thin);
  paint.setAntiAlias(true);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) / 2;
  const path = Skia.Path.Make();
  if (cp === 0x256d) {
    // ╭ right + down
    path.moveTo(x + w, cy).lineTo(cx + r, cy).quadTo(cx, cy, cx, cy + r).lineTo(cx, y + h);
  } else if (cp === 0x256e) {
    // ╮ left + down
    path.moveTo(x, cy).lineTo(cx - r, cy).quadTo(cx, cy, cx, cy + r).lineTo(cx, y + h);
  } else if (cp === 0x256f) {
    // ╯ left + up
    path.moveTo(x, cy).lineTo(cx - r, cy).quadTo(cx, cy, cx, cy - r).lineTo(cx, y);
  } else {
    // ╰ right + up
    path.moveTo(x + w, cy).lineTo(cx + r, cy).quadTo(cx, cy, cx, cy - r).lineTo(cx, y);
  }
  canvas.drawPath(path, paint);
}
