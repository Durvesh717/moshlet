import { blankCell, BLANK, cell, DEFAULT, PLAIN, type Cell, type Style } from "./style.ts";

const NBSP = " ";

/**
 * The client's copy of the remote screen. Received states are never mutated: applying a diff
 * always works on a copy(), so older states stay valid as reference points for later diffs and
 * the UI can read the latest one freely.
 */
export class Screen {
  cols: number;
  rows: number;
  lines: Cell[][];
  wrapped: boolean[];

  cursorX = 0;
  cursorY = 0;
  wrapPending = false;
  cursorVisible = true;
  style: Style = PLAIN;
  scrollTop = 0;
  scrollBottom: number;
  savedCursor: { x: number; y: number; style: Style } | null = null;

  title = "";
  bellCount = 0;
  clipboard: string | null = null;
  reverseVideo = false;
  bracketedPaste = false;
  mouseMode = 0;
  mouseEncoding = 0;
  focusEvents = false;

  /**
   * Lay out an emoji-presentation sequence (a character + VS16) two columns wide, as herdr and
   * modern terminals do. Off for mosh frames: mosh-server positions cells by glibc's widths and
   * its diffs assume them. On for laying out a plain text stream (herdr's history reads).
   */
  emojiWide = false;

  constructor(cols: number, rows: number) {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.lines = Array.from({ length: this.rows }, () => blankLine(this.cols, DEFAULT));
    this.wrapped = new Array<boolean>(this.rows).fill(false);
    this.scrollBottom = this.rows - 1;
  }

  cell(x: number, y: number): Cell {
    return this.lines[y][x];
  }

  line(y: number): readonly Cell[] {
    return this.lines[y];
  }

  /** Plain text of a row, wide-glyph halves collapsed, trailing blanks trimmed. */
  rowText(y: number): string {
    let s = "";
    for (const c of this.lines[y]) if (c.width !== 0) s += c.text === "" ? " " : c.text;
    return s.trimEnd();
  }

  text(): string {
    const out: string[] = [];
    for (let y = 0; y < this.rows; y++) out.push(this.rowText(y));
    return out.join("\n");
  }

  copy(): Screen {
    const s = new Screen(this.cols, this.rows);
    s.lines = this.lines.map((l) => l.slice());
    s.wrapped = this.wrapped.slice();
    s.cursorX = this.cursorX;
    s.cursorY = this.cursorY;
    s.wrapPending = this.wrapPending;
    s.cursorVisible = this.cursorVisible;
    s.style = this.style;
    s.scrollTop = this.scrollTop;
    s.scrollBottom = this.scrollBottom;
    s.savedCursor = this.savedCursor;
    s.title = this.title;
    s.bellCount = this.bellCount;
    s.clipboard = this.clipboard;
    s.reverseVideo = this.reverseVideo;
    s.bracketedPaste = this.bracketedPaste;
    s.mouseMode = this.mouseMode;
    s.mouseEncoding = this.mouseEncoding;
    s.focusEvents = this.focusEvents;
    s.emojiWide = this.emojiWide;
    return s;
  }

  /** Server-driven resize. Every resize diff is followed by a full repaint, so content is kept only loosely. */
  resize(newCols: number, newRows: number): void {
    const c = Math.max(1, newCols);
    const r = Math.max(1, newRows);
    if (c === this.cols && r === this.rows) return;
    this.lines = Array.from({ length: r }, (_, y) =>
      y < this.rows ? Array.from({ length: c }, (_, x) => (x < this.cols ? this.lines[y][x] : BLANK)) : blankLine(c, DEFAULT),
    );
    this.wrapped = Array.from({ length: r }, (_, y) => y < this.rows && this.wrapped[y]);
    this.cols = c;
    this.rows = r;
    this.cursorX = clamp(this.cursorX, 0, c - 1);
    this.cursorY = clamp(this.cursorY, 0, r - 1);
    this.wrapPending = false;
    this.scrollTop = 0;
    this.scrollBottom = r - 1;
  }

  // ---- primitives used by the interpreter

  put(text: string, width: 1 | 2): void {
    if (this.wrapPending) {
      this.wrapped[this.cursorY] = true;
      this.cursorX = 0;
      this.index();
      this.wrapPending = false;
    }
    if (width === 2 && this.cursorX === this.cols - 1) {
      // A wide glyph never straddles the edge: blank the last column and wrap first.
      this.clearHalfOf(this.cursorX, this.cursorY);
      this.lines[this.cursorY][this.cursorX] = blankCell(this.style.bg);
      this.wrapped[this.cursorY] = true;
      this.cursorX = 0;
      this.index();
    }
    const row = this.lines[this.cursorY];
    this.clearHalfOf(this.cursorX, this.cursorY);
    if (width === 2) this.clearHalfOf(this.cursorX + 1, this.cursorY);
    row[this.cursorX] = cell(text, this.style, width);
    if (width === 2) row[this.cursorX + 1] = cell("", this.style, 0);
    if (this.cursorX + width >= this.cols) {
      this.cursorX = this.cols - 1;
      this.wrapPending = true;
    } else {
      this.cursorX += width;
    }
  }

  /** Attach a zero-width character (combining mark, ZWJ, variation selector) to the previous cell. */
  combine(text: string): void {
    let x = this.wrapPending ? this.cursorX : this.cursorX - 1;
    const y = this.cursorY;
    if (x < 0) {
      this.put(NBSP + text, 1);
      return;
    }
    if (this.lines[y][x].width === 0 && x > 0) x--;
    const prev = this.lines[y][x];
    this.lines[y][x] = cell((prev.text === "" ? NBSP : prev.text) + text, prev.style, prev.width);
    if (this.emojiWide && text === "️" && prev.width === 1 && x + 1 < this.cols) {
      this.lines[y][x] = cell(this.lines[y][x].text, prev.style, 2);
      this.clearHalfOf(x + 1, y);
      this.lines[y][x + 1] = cell("", prev.style, 0);
      if (x + 2 >= this.cols) {
        this.cursorX = this.cols - 1;
        this.wrapPending = true;
      } else {
        this.cursorX = x + 2;
        this.wrapPending = false;
      }
    }
  }

  private clearHalfOf(x: number, y: number): void {
    if (x < 0 || x >= this.cols) return;
    const row = this.lines[y];
    const c = row[x];
    if (c.width === 2 && x + 1 < this.cols) row[x + 1] = blankCell(c.style.bg);
    if (c.width === 0 && x > 0) row[x - 1] = blankCell(row[x - 1].style.bg);
  }

  index(): void {
    if (this.cursorY === this.scrollBottom) this.scrollUp(1);
    else if (this.cursorY < this.rows - 1) this.cursorY++;
  }

  reverseIndex(): void {
    if (this.cursorY === this.scrollTop) this.scrollDown(1);
    else if (this.cursorY > 0) this.cursorY--;
  }

  scrollUp(n: number): void {
    const count = clamp(n, 0, this.scrollBottom - this.scrollTop + 1);
    for (let y = this.scrollTop; y <= this.scrollBottom; y++) {
      const src = y + count;
      if (src <= this.scrollBottom) {
        this.lines[y] = this.lines[src];
        this.wrapped[y] = this.wrapped[src];
      } else {
        this.lines[y] = blankLine(this.cols, this.style.bg);
        this.wrapped[y] = false;
      }
    }
  }

  scrollDown(n: number): void {
    const count = clamp(n, 0, this.scrollBottom - this.scrollTop + 1);
    for (let y = this.scrollBottom; y >= this.scrollTop; y--) {
      const src = y - count;
      if (src >= this.scrollTop) {
        this.lines[y] = this.lines[src];
        this.wrapped[y] = this.wrapped[src];
      } else {
        this.lines[y] = blankLine(this.cols, this.style.bg);
        this.wrapped[y] = false;
      }
    }
  }

  moveTo(x: number, y: number): void {
    this.cursorX = clamp(x, 0, this.cols - 1);
    this.cursorY = clamp(y, 0, this.rows - 1);
    this.wrapPending = false;
  }

  eraseCells(y: number, from: number, toExclusive: number): void {
    const row = this.lines[y];
    const a = clamp(from, 0, this.cols);
    const b = clamp(toExclusive, 0, this.cols);
    if (a >= b) return;
    this.clearHalfOf(a, y);
    this.clearHalfOf(b - 1, y);
    const blank = blankCell(this.style.bg);
    for (let x = a; x < b; x++) row[x] = blank;
  }

  eraseLine(y: number): void {
    this.lines[y] = blankLine(this.cols, this.style.bg);
    this.wrapped[y] = false;
  }

  insertLines(n: number): void {
    if (this.cursorY < this.scrollTop || this.cursorY > this.scrollBottom) return;
    const saved = this.scrollTop;
    this.scrollTop = this.cursorY;
    this.scrollDown(n);
    this.scrollTop = saved;
  }

  deleteLines(n: number): void {
    if (this.cursorY < this.scrollTop || this.cursorY > this.scrollBottom) return;
    const saved = this.scrollTop;
    this.scrollTop = this.cursorY;
    this.scrollUp(n);
    this.scrollTop = saved;
  }

  insertCells(n: number): void {
    const row = this.lines[this.cursorY];
    const count = clamp(n, 0, this.cols - this.cursorX);
    for (let x = this.cols - 1; x >= this.cursorX + count; x--) row[x] = row[x - count];
    for (let x = this.cursorX; x < this.cursorX + count; x++) row[x] = blankCell(this.style.bg);
  }

  deleteCells(n: number): void {
    const row = this.lines[this.cursorY];
    const count = clamp(n, 0, this.cols - this.cursorX);
    for (let x = this.cursorX; x < this.cols; x++) row[x] = x + count < this.cols ? row[x + count] : blankCell(this.style.bg);
  }

  reset(): void {
    this.lines = Array.from({ length: this.rows }, () => blankLine(this.cols, DEFAULT));
    this.wrapped = new Array<boolean>(this.rows).fill(false);
    this.cursorX = 0;
    this.cursorY = 0;
    this.wrapPending = false;
    this.style = PLAIN;
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.cursorVisible = true;
    this.reverseVideo = false;
    this.bracketedPaste = false;
    this.mouseMode = 0;
    this.mouseEncoding = 0;
    this.focusEvents = false;
  }
}

function blankLine(width: number, bg: number): Cell[] {
  return new Array<Cell>(width).fill(blankCell(bg));
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
