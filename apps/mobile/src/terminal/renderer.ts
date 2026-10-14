import { Attr, has, isBlank, type Cell, type Screen, type Style } from "@corral/core";
import {
  Skia,
  type SkCanvas,
  type SkFont,
  type SkParagraph,
  type SkPicture,
  type SkTypeface,
  type SkTypefaceFontProvider,
} from "@shopify/react-native-skia";
import { drawBox, isBoxChar } from "./boxDrawing";
import { CURSOR, DEFAULT_BG, DEFAULT_FG, resolveColor } from "./palette";

export interface TerminalFonts {
  regular: SkTypeface;
  bold: SkTypeface;
  /** For the symbols JetBrains Mono lacks (⏵ ⏸ ✻ ℹ ...). */
  symRegular: SkTypeface;
  symBold: SkTypeface;
  /** Both families, for paragraphs (emoji and anything else falls back to the system fonts). */
  provider: SkTypefaceFontProvider | null;
}

export interface Frame {
  screen: Screen;
  /** Rows above the live screen, oldest first (History mode). */
  history: readonly (readonly Cell[])[];
  /** Distance scrolled up from the live screen, in points. */
  scrollPx: number;
  width: number;
  height: number;
  focused: boolean;
}

const VS16 = "️";
const GLYPH_MAIN = 0;
const GLYPH_SYM = 1;
const GLYPH_PARAGRAPH = 2;

/**
 * Draws a terminal grid with Skia into a picture. ASCII runs go out in one call; other cells
 * are drawn one by one, with box characters drawn geometrically and glyphs from fallback fonts
 * shrunk to fit and centered in their cells.
 */
export class Renderer {
  private readonly fonts: TerminalFonts;
  private readonly pixelRatio: number;
  fontSize = 12;
  cellW = 1;
  cellH = 1;
  private baseline = 0;
  private thin = 1;
  private main!: SkFont;
  private mainBold!: SkFont;
  private sym!: SkFont;
  private symBold!: SkFont;
  private readonly paint = Skia.Paint();
  private readonly fill = Skia.Paint();
  private readonly colors = new Map<number, Float32Array>();
  private readonly glyphKind = new Map<string, number>();
  private readonly paragraphs = new Map<string, SkParagraph>();
  private readonly scaled = new Map<string, SkFont>();
  private backdrop = DEFAULT_BG;

  constructor(fonts: TerminalFonts, fontSize: number, pixelRatio: number) {
    this.fonts = fonts;
    this.pixelRatio = pixelRatio;
    this.paint.setAntiAlias(true);
    this.fill.setAntiAlias(false);
    this.setFontSize(fontSize);
  }

  setFontSize(size: number): void {
    this.fontSize = size;
    this.main = Skia.Font(this.fonts.regular, size);
    this.mainBold = Skia.Font(this.fonts.bold, size);
    this.sym = Skia.Font(this.fonts.symRegular, size);
    this.symBold = Skia.Font(this.fonts.symBold, size);
    for (const f of [this.main, this.mainBold, this.sym, this.symBold]) f.setSubpixel(true);
    this.cellW = this.main.measureText("M").width;
    const m = this.main.getMetrics();
    const glyphH = m.descent - m.ascent;
    this.cellH = Math.ceil(glyphH * 1.18 * this.pixelRatio) / this.pixelRatio;
    this.baseline = (this.cellH - glyphH) / 2 - m.ascent;
    this.thin = Math.max(1 / this.pixelRatio, 0.9);
    this.paragraphs.clear();
    this.scaled.clear();
  }

  grid(width: number, height: number): { cols: number; rows: number } {
    return { cols: Math.max(10, Math.floor(width / this.cellW)), rows: Math.max(4, Math.floor(height / this.cellH)) };
  }

  render(f: Frame): SkPicture {
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, f.width, f.height));
    this.draw(canvas, f);
    return rec.finishRecordingAsPicture();
  }

  private draw(canvas: SkCanvas, f: Frame): void {
    const s = f.screen;
    canvas.drawColor(this.color(DEFAULT_BG));
    const reverse = s.reverseVideo;
    this.backdrop = this.findBackdrop(s, reverse);
    const ox = (f.width - s.cols * this.cellW) / 2;
    const drawCols = Math.min(s.cols, Math.ceil(f.width / this.cellW) + 1);

    // Rows are numbered history first, then the live screen; scrolling moves the window up.
    const h = f.history.length;
    const topRow = h - f.scrollPx / this.cellH;
    const first = Math.floor(topRow);
    const shift = (first - topRow) * this.cellH;
    for (let i = 0; i <= Math.ceil(f.height / this.cellH); i++) {
      const v = first + i;
      const top = shift + i * this.cellH;
      if (top >= f.height) break;
      if (v < 0) continue;
      if (v < h) this.drawRow(canvas, f.history[v], top, ox, drawCols, false);
      else if (v - h < s.rows) this.drawRow(canvas, s.lines[v - h], top, ox, drawCols, reverse);
    }

    const cy = shift + (h + s.cursorY - first) * this.cellH;
    if (s.cursorVisible && s.cursorX < drawCols && s.cursorY < s.rows && cy > -this.cellH && cy < f.height) {
      const cx = ox + s.cursorX * this.cellW;
      this.fill.setColor(this.color(CURSOR));
      if (f.focused) {
        canvas.drawRect(Skia.XYWHRect(cx, cy, this.cellW, this.cellH), this.fill);
        const cell = s.lines[s.cursorY][s.cursorX];
        if (!isBlank(cell) && cell.width !== 0 && cell.text.length === 1 && cell.text.charCodeAt(0) < 0x7f) {
          this.paint.setColor(this.color(DEFAULT_BG));
          canvas.drawText(cell.text, cx, cy + this.baseline, this.paint, has(cell.style, Attr.BOLD) ? this.mainBold : this.main);
        }
      } else {
        canvas.drawRect(Skia.XYWHRect(cx, cy + this.cellH - this.thin * 2, this.cellW, this.thin * 2), this.fill);
      }
    }
  }

  /**
   * herdr paints its own pane background (theme `panel_bg`) as an explicit color into every
   * cell. When one explicit background covers most of the screen we treat it as the backdrop and
   * draw the app's ground instead, so the phone keeps its theme while real highlights keep theirs.
   */
  private findBackdrop(s: Screen, reverse: boolean): number {
    const counts = new Map<number, number>();
    let best = DEFAULT_BG;
    let bestCount = 0;
    for (let y = 0; y < s.rows; y++) {
      for (const c of s.lines[y]) {
        const bg = this.rawBackground(c.style, reverse);
        const n = (counts.get(bg) ?? 0) + 1;
        counts.set(bg, n);
        if (n > bestCount) {
          bestCount = n;
          best = bg;
        }
      }
    }
    return bestCount * 2 > s.rows * s.cols ? best : DEFAULT_BG;
  }

  private drawRow(canvas: SkCanvas, line: readonly Cell[], top: number, ox: number, maxCols: number, reverse: boolean): void {
    const n = Math.min(maxCols, line.length);
    const cw = this.cellW;
    // Backgrounds first, merged into runs. The cell after a one-column emoji takes the emoji's style.
    let x = 0;
    while (x < n) {
      const bg = this.background(styleAt(line, x), reverse);
      let end = x + 1;
      while (end < n && this.background(styleAt(line, end), reverse) === bg) end++;
      if (bg !== DEFAULT_BG) {
        this.fill.setColor(this.color(bg));
        canvas.drawRect(Skia.XYWHRect(this.snap(ox + x * cw), top, this.snap(ox + end * cw) - this.snap(ox + x * cw), this.cellH), this.fill);
      }
      x = end;
    }
    // Then text: plain ASCII runs in one call, everything else per cell.
    x = 0;
    while (x < n) {
      const cell = line[x];
      if (cell.width === 0 || isBlank(cell) || has(cell.style, Attr.INVISIBLE)) {
        x++;
        continue;
      }
      const text = cell.text;
      const cp = text.codePointAt(0)!;
      if (text.length === 1 && cp < 0x7f) {
        let run = "";
        let end = x;
        while (end < n) {
          const c = line[end];
          if (c.width !== 1 || c.style !== cell.style) break;
          const t = c.text;
          if (t === "") run += " ";
          else if (t.length === 1 && t.charCodeAt(0) >= 0x20 && t.charCodeAt(0) < 0x7f) run += t;
          else break;
          end++;
        }
        this.drawText(canvas, run, ox + x * cw, top, cell.style, reverse, (end - x) * cw, this.mainFor(cell.style));
        x = end;
        continue;
      }
      if (isBoxChar(cp) && text.length === 1) {
        this.fill.setColor(this.color(this.foreground(cell.style, reverse)));
        if (drawBox(canvas, cp, ox + x * cw, top, cw, this.cellH, this.fill, this.thin, (v) => this.snap(v))) {
          x++;
          continue;
        }
      }
      // A character + VS16 that mosh laid out one column wide: herdr draws it two columns wide
      // and never writes the second column, so whatever mosh holds there is a leftover.
      const span = cell.width === 2 || (isNarrowEmoji(cell) && x + 1 < n) ? 2 : 1;
      this.drawGlyph(canvas, text, ox + x * cw, top, cell.style, reverse, span * cw);
      x += span;
    }
  }

  private drawGlyph(canvas: SkCanvas, text: string, x: number, top: number, style: Style, reverse: boolean, width: number): void {
    const kind = this.kindOf(text);
    if (kind === GLYPH_PARAGRAPH) {
      this.drawParagraph(canvas, text, x, top, style, reverse, width);
      return;
    }
    const bold = has(style, Attr.BOLD);
    const font = kind === GLYPH_MAIN ? (bold ? this.mainBold : this.main) : bold ? this.symBold : this.sym;
    const w = font.measureText(text).width;
    if (Math.abs(w - width) < 0.5) {
      this.drawText(canvas, text, x, top, style, reverse, width, font);
      return;
    }
    // Fallback glyphs don't share the grid's advance: shrink anything too wide, center everything.
    const fit = w > width ? this.scaledFont(kind, bold, (this.fontSize * width) / w) : font;
    const fw = Math.min(w, width);
    const m = fit.getMetrics();
    const y = top + (this.cellH - (m.descent - m.ascent)) / 2 - m.ascent;
    this.drawText(canvas, text, x + (width - fw) / 2, top, style, reverse, width, fit, y);
  }

  /** Emoji and anything neither font has: a paragraph, so the system fonts fill in; scaled to its cells. */
  private drawParagraph(canvas: SkCanvas, text: string, x: number, top: number, style: Style, reverse: boolean, width: number): void {
    const fg = this.foreground(style, reverse);
    const key = `${text}|${fg}|${has(style, Attr.BOLD) ? 1 : 0}`;
    let p = this.paragraphs.get(key);
    if (!p) {
      const builder = Skia.ParagraphBuilder.Make({}, this.fonts.provider ?? undefined);
      builder.pushStyle({
        color: this.color(fg),
        fontSize: this.fontSize,
        fontFamilies: ["JetBrains Mono", "Adwaita Mono"],
        fontStyle: { weight: has(style, Attr.BOLD) ? 700 : 400 },
      });
      builder.addText(text);
      p = builder.build();
      p.layout(1000);
      if (this.paragraphs.size > 400) this.paragraphs.clear();
      this.paragraphs.set(key, p);
    }
    const w = p.getLongestLine();
    const ph = p.getHeight();
    const scale = Math.min(1, w > 0 ? width / w : 1, ph > 0 ? this.cellH / ph : 1);
    canvas.save();
    canvas.translate(x + (width - w * scale) / 2, top + (this.cellH - ph * scale) / 2);
    canvas.scale(scale, scale);
    p.paint(canvas, 0, 0);
    canvas.restore();
  }

  private kindOf(text: string): number {
    let k = this.glyphKind.get(text);
    if (k !== undefined) return k;
    const cps = [...text].length;
    if (text.includes(VS16) || cps > 1) k = GLYPH_PARAGRAPH;
    else if (!this.main.getGlyphIDs(text).includes(0)) k = GLYPH_MAIN;
    else if (!this.sym.getGlyphIDs(text).includes(0)) k = GLYPH_SYM;
    else k = GLYPH_PARAGRAPH;
    this.glyphKind.set(text, k);
    return k;
  }

  private scaledFont(kind: number, bold: boolean, size: number): SkFont {
    const rounded = Math.max(4, Math.round(size * 4) / 4);
    const key = `${kind}|${bold}|${rounded}`;
    let f = this.scaled.get(key);
    if (!f) {
      const face = kind === GLYPH_MAIN ? (bold ? this.fonts.bold : this.fonts.regular) : bold ? this.fonts.symBold : this.fonts.symRegular;
      f = Skia.Font(face, rounded);
      this.scaled.set(key, f);
    }
    return f;
  }

  private drawText(canvas: SkCanvas, text: string, x: number, top: number, style: Style, reverse: boolean, width: number, font: SkFont, y = top + this.baseline): void {
    let fg = this.foreground(style, reverse);
    if (has(style, Attr.FAINT)) fg = ((fg & 0x00ffffff) | (0x99 << 24)) >>> 0;
    this.paint.setColor(this.color(fg));
    if (has(style, Attr.ITALIC)) {
      canvas.save();
      canvas.skew(-0.2, 0);
      canvas.drawText(text, x + 0.2 * y, y, this.paint, font);
      canvas.restore();
    } else {
      canvas.drawText(text, x, y, this.paint, font);
    }
    if (has(style, Attr.UNDERLINE)) {
      this.fill.setColor(this.color(fg));
      canvas.drawRect(Skia.XYWHRect(x, top + this.baseline + this.thin * 2, width, this.thin), this.fill);
    }
    if (has(style, Attr.STRIKE)) {
      this.fill.setColor(this.color(fg));
      canvas.drawRect(Skia.XYWHRect(x, top + this.cellH / 2 - this.thin / 2, width, this.thin), this.fill);
    }
  }

  private mainFor(style: Style): SkFont {
    return has(style, Attr.BOLD) ? this.mainBold : this.main;
  }

  private foreground(style: Style, reverse: boolean): number {
    const inverse = has(style, Attr.INVERSE) !== reverse;
    const fg = inverse ? resolveColor(style.bg, DEFAULT_BG) : resolveColor(style.fg, DEFAULT_FG);
    // Glyphs drawn in the backdrop color (e.g. powerline caps) blend into our ground too.
    return fg === this.backdrop ? DEFAULT_BG : fg;
  }

  private background(style: Style, reverse: boolean): number {
    const bg = this.rawBackground(style, reverse);
    return bg === this.backdrop ? DEFAULT_BG : bg;
  }

  private rawBackground(style: Style, reverse: boolean): number {
    const inverse = has(style, Attr.INVERSE) !== reverse;
    return inverse ? resolveColor(style.fg, DEFAULT_FG) : resolveColor(style.bg, DEFAULT_BG);
  }

  private color(argb: number): Float32Array {
    let c = this.colors.get(argb);
    if (!c) {
      c = Float32Array.of(((argb >>> 16) & 0xff) / 255, ((argb >>> 8) & 0xff) / 255, (argb & 0xff) / 255, ((argb >>> 24) & 0xff) / 255);
      this.colors.set(argb, c);
    }
    return c;
  }

  private snap(v: number): number {
    return Math.round(v * this.pixelRatio) / this.pixelRatio;
  }
}

const isNarrowEmoji = (c: Cell): boolean => c.width === 1 && c.text.length > 1 && c.text.endsWith(VS16);

const styleAt = (line: readonly Cell[], x: number): Style => (x > 0 && isNarrowEmoji(line[x - 1]) ? line[x - 1].style : line[x].style);
