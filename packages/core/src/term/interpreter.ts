import { base64Decode, utf8Decode } from "../bytes.ts";
import { charWidth } from "./charWidth.ts";
import type { Screen } from "./screen.ts";
import { Attr, DEFAULT, rgb, style } from "./style.ts";

const GROUND = 0;
const ESC = 1;
const ESC_CHARSET = 2;
const CSI = 3;
const OSC = 4;
const OSC_ESC = 5;
const MAX_OSC = 1 << 20;
/** Parameters kept per CSI sequence, and sub-parameters per parameter (xterm keeps 30); more are ignored. */
const MAX_PARAMS = 32;

/**
 * Applies a byte stream of terminal output to a Screen.
 *
 * mosh-server sends screen diffs as a compact, conservative subset of xterm: CUP/CR/LF/BS
 * moves, SGR, ECH/EL/ED, scroll regions, a few DEC modes and OSC titles/clipboard. This handles
 * that subset exactly, plus the rest of the everyday VT100 vocabulary so stray sequences can't
 * derail the parser. Each diff is complete, so a fresh interpreter is used per diff.
 */
export class Interpreter {
  private state = GROUND;
  private params: number[][] = [];
  private current = -1;
  private subparams: number[] = [];
  private privateMarker = "";
  private intermediate = "";
  private osc: number[] = [];
  private utfNeed = 0;
  private utfCp = 0;

  private readonly screen: Screen;

  constructor(screen: Screen) {
    this.screen = screen;
  }

  static apply(screen: Screen, bytes: Uint8Array): void {
    new Interpreter(screen).feed(bytes);
  }

  feed(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) this.step(bytes[i]);
  }

  private step(b: number): void {
    switch (this.state) {
      case GROUND:
        this.ground(b);
        break;
      case ESC:
        this.esc(b);
        break;
      case ESC_CHARSET:
        this.state = GROUND;
        break;
      case CSI:
        this.csi(b);
        break;
      case OSC:
        if (b === 0x07) this.finishOsc();
        else if (b === 0x1b) this.state = OSC_ESC;
        else if (this.osc.length < MAX_OSC) this.osc.push(b);
        break;
      case OSC_ESC:
        if (b === 0x5c) {
          this.finishOsc();
        } else {
          this.osc = [];
          this.state = ESC;
          this.esc(b);
        }
        break;
    }
  }

  private ground(b: number): void {
    if (this.utfNeed > 0) {
      if ((b & 0xc0) === 0x80) {
        this.utfCp = (this.utfCp << 6) | (b & 0x3f);
        if (--this.utfNeed === 0) this.print(this.utfCp);
        return;
      }
      this.utfNeed = 0;
      this.print(0xfffd);
    }
    if (b === 0x1b) this.state = ESC;
    else if (b < 0x20 || b === 0x7f) this.control(b);
    else if (b < 0x80) this.print(b);
    else if ((b & 0xe0) === 0xc0) {
      this.utfNeed = 1;
      this.utfCp = b & 0x1f;
    } else if ((b & 0xf0) === 0xe0) {
      this.utfNeed = 2;
      this.utfCp = b & 0x0f;
    } else if ((b & 0xf8) === 0xf0) {
      this.utfNeed = 3;
      this.utfCp = b & 0x07;
    } else this.print(0xfffd);
  }

  private control(b: number): void {
    const s = this.screen;
    switch (b) {
      case 0x07:
        s.bellCount++;
        break;
      case 0x08:
        if (s.cursorX > 0) s.moveTo(s.cursorX - 1, s.cursorY);
        else s.wrapPending = false;
        break;
      case 0x09:
        s.moveTo((Math.floor(s.cursorX / 8) + 1) * 8, s.cursorY);
        break;
      case 0x0a:
      case 0x0b:
      case 0x0c:
        s.wrapPending = false;
        s.index();
        break;
      case 0x0d:
        s.moveTo(0, s.cursorY);
        break;
    }
  }

  private print(cp: number): void {
    const width = charWidth(cp);
    const text = String.fromCodePoint(cp);
    if (width === 0) {
      if (cp >= 0x20) this.screen.combine(text);
    } else {
      this.screen.put(text, width);
    }
  }

  private esc(b: number): void {
    const s = this.screen;
    this.state = GROUND;
    switch (String.fromCharCode(b)) {
      case "[":
        this.params = [];
        this.subparams = [];
        this.current = -1;
        this.privateMarker = "";
        this.intermediate = "";
        this.state = CSI;
        break;
      case "]":
        this.osc = [];
        this.state = OSC;
        break;
      case "7":
        s.savedCursor = { x: s.cursorX, y: s.cursorY, style: s.style };
        break;
      case "8":
        this.restoreCursor();
        break;
      case "D":
        s.wrapPending = false;
        s.index();
        break;
      case "E":
        s.moveTo(0, s.cursorY);
        s.index();
        break;
      case "M":
        s.wrapPending = false;
        s.reverseIndex();
        break;
      case "c":
        s.reset();
        break;
      case "(": case ")": case "*": case "+": case "-": case ".": case "/": case "#": case "%":
        this.state = ESC_CHARSET;
        break;
    }
  }

  private csi(b: number): void {
    if (b >= 0x30 && b <= 0x39) this.current = (this.current < 0 ? 0 : this.current) * 10 + (b - 0x30);
    else if (b === 0x3a) {
      if (this.subparams.length < MAX_PARAMS) this.subparams.push(this.current);
      this.current = -1;
    } else if (b === 0x3b) this.endParam();
    else if (b >= 0x3c && b <= 0x3f) this.privateMarker = String.fromCharCode(b);
    else if (b >= 0x20 && b <= 0x2f) this.intermediate = String.fromCharCode(b);
    else if (b >= 0x40 && b <= 0x7e) {
      this.endParam();
      this.state = GROUND;
      this.dispatchCsi(String.fromCharCode(b));
    } else if (b === 0x1b) this.state = ESC;
    else if (b < 0x20) this.control(b);
  }

  private endParam(): void {
    if (this.subparams.length < MAX_PARAMS) this.subparams.push(this.current);
    if (this.params.length < MAX_PARAMS) this.params.push(this.subparams);
    this.subparams = [];
    this.current = -1;
  }

  private p(i: number, def: number): number {
    const v = this.params[i]?.[0] ?? -1;
    return v <= 0 ? def : v;
  }

  private raw0(): number {
    return Math.max(0, this.params[0]?.[0] ?? 0);
  }

  private dispatchCsi(final: string): void {
    const s = this.screen;
    if (this.privateMarker === "?") {
      if (final === "h" || final === "l") for (const g of this.params) this.setMode(g[0] ?? -1, final === "h");
      return;
    }
    if (this.privateMarker !== "" || this.intermediate !== "") return; // DA, cursor style, etc.
    switch (final) {
      case "@": s.insertCells(this.p(0, 1)); break;
      case "A": s.moveTo(s.cursorX, Math.max(s.cursorY - this.p(0, 1), s.cursorY >= s.scrollTop ? s.scrollTop : 0)); break;
      case "B": case "e": s.moveTo(s.cursorX, Math.min(s.cursorY + this.p(0, 1), s.cursorY <= s.scrollBottom ? s.scrollBottom : s.rows - 1)); break;
      case "C": case "a": s.moveTo(s.cursorX + this.p(0, 1), s.cursorY); break;
      case "D": s.moveTo(s.cursorX - this.p(0, 1), s.cursorY); break;
      case "E": s.moveTo(0, s.cursorY + this.p(0, 1)); break;
      case "F": s.moveTo(0, s.cursorY - this.p(0, 1)); break;
      case "G": case "`": s.moveTo(this.p(0, 1) - 1, s.cursorY); break;
      case "H": case "f": s.moveTo(this.p(1, 1) - 1, this.p(0, 1) - 1); break;
      case "d": s.moveTo(s.cursorX, this.p(0, 1) - 1); break;
      case "J": this.eraseDisplay(this.raw0()); break;
      case "K": this.eraseLine(this.raw0()); break;
      case "L": s.insertLines(this.p(0, 1)); break;
      case "M": s.deleteLines(this.p(0, 1)); break;
      case "P": s.deleteCells(this.p(0, 1)); break;
      case "S": s.scrollUp(this.p(0, 1)); break;
      case "T": s.scrollDown(this.p(0, 1)); break;
      case "X": s.eraseCells(s.cursorY, s.cursorX, s.cursorX + this.p(0, 1)); break;
      case "m": this.sgr(); break;
      case "r": {
        const top = this.p(0, 1) - 1;
        const bottom = this.p(1, s.rows) - 1;
        if (top < bottom && bottom < s.rows) {
          s.scrollTop = top;
          s.scrollBottom = bottom;
        } else {
          s.scrollTop = 0;
          s.scrollBottom = s.rows - 1;
        }
        s.moveTo(0, 0);
        break;
      }
      case "s": s.savedCursor = { x: s.cursorX, y: s.cursorY, style: s.style }; break;
      case "u": this.restoreCursor(); break;
    }
  }

  private restoreCursor(): void {
    const saved = this.screen.savedCursor;
    if (!saved) return;
    this.screen.moveTo(saved.x, saved.y);
    this.screen.style = saved.style;
  }

  private eraseDisplay(mode: number): void {
    const s = this.screen;
    if (mode === 0) {
      s.eraseCells(s.cursorY, s.cursorX, s.cols);
      for (let y = s.cursorY + 1; y < s.rows; y++) s.eraseLine(y);
    } else if (mode === 1) {
      for (let y = 0; y < s.cursorY; y++) s.eraseLine(y);
      s.eraseCells(s.cursorY, 0, s.cursorX + 1);
    } else if (mode === 2 || mode === 3) {
      for (let y = 0; y < s.rows; y++) s.eraseLine(y);
    }
  }

  private eraseLine(mode: number): void {
    const s = this.screen;
    if (mode === 0) s.eraseCells(s.cursorY, s.cursorX, s.cols);
    else if (mode === 1) s.eraseCells(s.cursorY, 0, s.cursorX + 1);
    else if (mode === 2) s.eraseCells(s.cursorY, 0, s.cols);
  }

  private setMode(mode: number, on: boolean): void {
    const s = this.screen;
    if (mode === 5) s.reverseVideo = on;
    else if (mode === 25) s.cursorVisible = on;
    else if (mode >= 1000 && mode <= 1003) s.mouseMode = on ? mode : s.mouseMode === mode ? 0 : s.mouseMode;
    else if (mode === 1004) s.focusEvents = on;
    else if (mode === 1005 || mode === 1006 || mode === 1015) s.mouseEncoding = on ? mode : s.mouseEncoding === mode ? 0 : s.mouseEncoding;
    else if (mode === 2004) s.bracketedPaste = on;
  }

  private sgr(): void {
    const s = this.screen;
    let fg = s.style.fg;
    let bg = s.style.bg;
    let flags = s.style.flags;
    if (this.params.length === 0) this.params.push([0]);
    for (let i = 0; i < this.params.length; i++) {
      const group = this.params[i];
      const code = group[0] < 0 ? 0 : group[0];
      if (code === 0) {
        fg = DEFAULT;
        bg = DEFAULT;
        flags = 0;
      } else if (code === 1) flags |= Attr.BOLD;
      else if (code === 2) flags |= Attr.FAINT;
      else if (code === 3) flags |= Attr.ITALIC;
      else if (code === 4) flags = group.length > 1 && group[1] === 0 ? flags & ~Attr.UNDERLINE : flags | Attr.UNDERLINE;
      else if (code === 5 || code === 6) flags |= Attr.BLINK;
      else if (code === 7) flags |= Attr.INVERSE;
      else if (code === 8) flags |= Attr.INVISIBLE;
      else if (code === 9) flags |= Attr.STRIKE;
      else if (code === 21) flags |= Attr.UNDERLINE;
      else if (code === 22) flags &= ~(Attr.BOLD | Attr.FAINT);
      else if (code === 23) flags &= ~Attr.ITALIC;
      else if (code === 24) flags &= ~Attr.UNDERLINE;
      else if (code === 25) flags &= ~Attr.BLINK;
      else if (code === 27) flags &= ~Attr.INVERSE;
      else if (code === 28) flags &= ~Attr.INVISIBLE;
      else if (code === 29) flags &= ~Attr.STRIKE;
      else if (code >= 30 && code <= 37) fg = code - 30;
      else if (code === 39) fg = DEFAULT;
      else if (code >= 40 && code <= 47) bg = code - 40;
      else if (code === 49) bg = DEFAULT;
      else if (code >= 90 && code <= 97) fg = code - 90 + 8;
      else if (code >= 100 && code <= 107) bg = code - 100 + 8;
      else if (code === 38 || code === 48) {
        const [color, consumed] = this.extendedColor(i);
        if (color !== null) {
          if (code === 38) fg = color;
          else bg = color;
        }
        i += consumed;
      }
    }
    s.style = style(fg, bg, flags);
  }

  /** Parses 38/48 color in either `;5;n` / `;2;r;g;b` or colon sub-parameter form. Returns extra params consumed. */
  private extendedColor(i: number): [number | null, number] {
    const group = this.params[i];
    const byte = (v: number | undefined) => v !== undefined && v >= 0 && v <= 255;
    if (group.length > 1) {
      if (group[1] === 5) return [byte(group[2]) ? group[2] : null, 0];
      if (group[1] === 2) {
        const c = group.length >= 6 ? group.slice(3, 6) : group.slice(2, Math.min(5, group.length));
        return [c.length === 3 && c.every((v) => byte(v)) ? rgb(c[0], c[1], c[2]) : null, 0];
      }
      return [null, 0];
    }
    const at = (k: number) => this.params[i + k]?.[0] ?? -1;
    if (at(1) === 5) return [byte(at(2)) ? at(2) : null, 2];
    if (at(1) === 2) {
      const r = at(2);
      const g = at(3);
      const b = at(4);
      return [byte(r) && byte(g) && byte(b) ? rgb(r, g, b) : null, 4];
    }
    return [null, 0];
  }

  private finishOsc(): void {
    this.state = GROUND;
    const text = utf8Decode(Uint8Array.from(this.osc));
    this.osc = [];
    const semi = text.indexOf(";");
    if (semi < 0) return;
    const body = text.slice(semi + 1);
    switch (text.slice(0, semi)) {
      case "0":
      case "2":
        this.screen.title = body;
        break;
      case "52": {
        const at = body.indexOf(";");
        try {
          this.screen.clipboard = at < 0 ? null : utf8Decode(base64Decode(body.slice(at + 1)));
        } catch {
          this.screen.clipboard = null;
        }
        break;
      }
    }
  }
}
