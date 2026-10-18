import { describe, expect, it } from "vitest";
import { utf8Encode } from "../src/bytes.ts";
import { Interpreter } from "../src/term/interpreter.ts";
import { Screen } from "../src/term/screen.ts";
import { Attr, has, PLAIN, rgb } from "../src/term/style.ts";

function screen(cols: number, rows: number, ...chunks: string[]): Screen {
  const s = new Screen(cols, rows);
  for (const c of chunks) Interpreter.apply(s, utf8Encode(c));
  return s;
}
const apply = (s: Screen, text: string) => Interpreter.apply(s, utf8Encode(text));

describe("Interpreter", () => {
  it("prints and positions", () => {
    const s = screen(10, 3, "hi\r\nthere", "\x1b[3;5HX");
    expect([s.rowText(0), s.rowText(1), s.rowText(2)]).toEqual(["hi", "there", "    X"]);
    expect([s.cursorX, s.cursorY]).toEqual([5, 2]);
  });

  it("defers wrap like xterm", () => {
    const s = screen(5, 3, "abcde");
    expect([s.cursorX, s.cursorY]).toEqual([4, 0]);
    apply(s, "f");
    expect([s.rowText(0), s.rowText(1)]).toEqual(["abcde", "f"]);
    expect(s.wrapped[0]).toBe(true);
    expect(screen(5, 3, "abcde\r\nx").rowText(1)).toBe("x");
  });

  it("parses SGR colors including truecolor", () => {
    const s = screen(10, 1, "\x1b[0;1;38;2;10;20;30;48;5;200mA\x1b[0;31mB\x1b[0mC");
    const a = s.cell(0, 0).style;
    expect(has(a, Attr.BOLD)).toBe(true);
    expect(a.fg).toBe(rgb(10, 20, 30));
    expect(a.bg).toBe(200);
    expect(s.cell(1, 0).style.fg).toBe(1);
    expect(s.cell(2, 0).style).toBe(PLAIN);
  });

  it("scrolls regions with line feeds the way mosh diffs do", () => {
    const s = screen(4, 4, "a\r\nb\r\nc\r\nd");
    apply(s, "\x1b[1;3r\x1b[3;1H\n\x1b[r");
    expect([0, 1, 2, 3].map((y) => s.rowText(y))).toEqual(["b", "c", "", "d"]);
  });

  it("erases characters and lines", () => {
    const s = screen(8, 1, "abcdefgh", "\x1b[1;3H\x1b[3X");
    expect(s.rowText(0)).toBe("ab   fgh");
    apply(s, "\x1b[1;7H\x1b[K");
    expect(s.rowText(0)).toBe("ab   f");
  });

  it("gives wide glyphs two cells", () => {
    const s = screen(6, 1, "a中b");
    expect(s.cell(1, 0).width).toBe(2);
    expect(s.cell(2, 0).width).toBe(0);
    expect(s.cell(3, 0).text).toBe("b");
    expect(s.cursorX).toBe(4);
  });

  it("tracks modes, mouse reporting and the title", () => {
    const s = screen(5, 1, "\x1b[?25l\x1b[?2004h\x1b[?1003h\x1b[?1006h\x1b]0;hello\x07");
    expect(s.cursorVisible).toBe(false);
    expect(s.bracketedPaste).toBe(true);
    expect([s.mouseMode, s.mouseEncoding]).toEqual([1003, 1006]);
    expect(s.title).toBe("hello");
  });

  it("keeps copies independent", () => {
    const a = screen(5, 1, "abc");
    const b = a.copy();
    apply(b, "\rxyz");
    expect([a.rowText(0), b.rowText(0)]).toEqual(["abc", "xyz"]);
  });

  it("attaches VS16 to its character and, in emojiWide mode, gives it two columns", () => {
    const narrow = screen(10, 1, "⚠️ x");
    expect(narrow.cell(0, 0).text).toBe("⚠️");
    expect(narrow.cell(0, 0).width).toBe(1);
    expect(narrow.cell(2, 0).text).toBe("x");
    const wide = new Screen(10, 1);
    wide.emojiWide = true;
    apply(wide, "⚠️ x");
    expect(wide.cell(0, 0).width).toBe(2);
    expect(wide.cell(1, 0).width).toBe(0);
    expect(wide.cell(3, 0).text).toBe("x");
  });
});

describe("limits on what a pane can make the terminal keep", () => {
  it("keeps real clusters whole but drops combining marks past a cluster's limit", () => {
    const accented = "e\u0301\u0323\u0308";
    expect(screen(10, 2, accented).cell(0, 0).text).toBe(accented);
    expect(screen(10, 2, "❤\ufe0f").cell(0, 0).text).toBe("❤\ufe0f");
    const zalgo = screen(10, 2, "a" + "\u0301".repeat(500));
    expect(zalgo.cell(0, 0).text.length).toBeLessThanOrEqual(32);
    expect(zalgo.cell(0, 0).text.startsWith("a\u0301")).toBe(true);
  });

  it("applies an SGR with too many parameters as far as it keeps them", () => {
    const s = screen(10, 2, `\x1b[1${";0".repeat(5000)};4mx`);
    expect(s.cell(0, 0).text).toBe("x");
    const t = screen(10, 2, "\x1b[1;4mx");
    expect(has(t.cell(0, 0).style, Attr.UNDERLINE)).toBe(true);
  });

  it("styles stay correct after the style table starts again", () => {
    const s = new Screen(4, 1);
    for (let i = 0; i < 25_000; i++) apply(s, `\x1b[38;2;${i & 255};${(i >> 8) & 255};7m\r.`);
    apply(s, "\x1b[0;1;38;2;1;2;3m\rx");
    expect(s.cell(0, 0).style).toMatchObject({ fg: rgb(1, 2, 3), flags: Attr.BOLD });
  });
});
